/**
 * Rating and review pipeline against the live emulator suite.
 *
 * Run with the Docker suite up:
 *   pnpm run emulator:up && pnpm run test:emulator
 *
 * These cases drive the *real* Firestore paths — transactions, security rules,
 * and cursor reads — instead of the fakes used by the state suites:
 *
 *   1. a first 5-star submission recomputes the distribution, the average, and
 *      the Bayesian score exactly as `applyRatingMutation` predicts;
 *   2. moving a rating between tiers leaves the total count unchanged;
 *   3. a second reader folds into the same aggregate;
 *   4. a duplicate review is rejected by the transaction while the book and
 *      profile counters increment exactly once;
 *   5. re-rating keeps the denormalised review rating in step;
 *   6. deleting the review releases the slot and decrements both counters;
 *   7. shelf reads page through a cursor and enforce ownership.
 */
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  type Auth
} from 'firebase/auth';
import {
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDoc,
  getFirestore,
  setDoc,
  type Firestore
} from 'firebase/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BOOK_COLLECTION,
  FirestoreShelfGateway,
  SHELF_COLLECTION,
  USER_COLLECTION
} from '$lib/data/shelf-gateway';
import { FirestoreReviewGateway } from '$lib/data/review-gateway';
import { DuplicateReviewError } from '$lib/data/errors';
import { checkEmulatorSuite } from '$lib/firebase/emulator-health';
import { resolveEmulatorConfig, resolveFirebaseWebConfig } from '$lib/firebase/config';
import { applyRatingMutation, calculateBayesianRating } from '$lib/utils/ratings';
import { createShelfRecord } from '$lib/utils/shelf-state-machine';
import type { Book, BookRatingAggregates, Review, UserProfile } from '$lib/types/domain';

const runId = `it${Date.now().toString(36)}`;
const bookId = `${runId}-book`;
const now = new Date().toISOString();

const emulatorEnv = {
  DEV: true,
  PROD: false,
  VITE_FIREBASE_USE_EMULATOR: 'true',
  VITE_FIREBASE_PROJECT_ID: 'bookreview-dev',
  VITE_FIREBASE_EMULATOR_HOST: process.env.VITE_FIREBASE_EMULATOR_HOST ?? '127.0.0.1'
};

const emulatorConfig = resolveEmulatorConfig(emulatorEnv);

interface TestReader {
  email: string;
  password: string;
  displayName: string;
  /** Filled in with the uid the Auth emulator assigns on sign-in. */
  uid: string;
}

const readerOne: TestReader = {
  email: `${runId}-one@example.test`,
  password: 'reader-pass-one',
  displayName: 'Reader One',
  uid: ''
};

const readerTwo: TestReader = {
  email: `${runId}-two@example.test`,
  password: 'reader-pass-two',
  displayName: 'Reader Two',
  uid: ''
};

let app: FirebaseApp;
let auth: Auth;
let db: Firestore;
let shelfGateway: FirestoreShelfGateway;
let reviewGateway: FirestoreReviewGateway;

function emptyBook(): Book {
  return {
    id: bookId,
    isbn13: '9780140187394',
    isbn10: '0140187397',
    title: 'Pipeline Test Edition',
    subtitle: '',
    authors: ['Test Author'],
    publisher: 'Emulator Press',
    publishedDate: '1952-09-19',
    description: 'A synthetic catalog document used by the emulator pipeline suite.',
    pageCount: 601,
    genres: ['Classics'],
    coverUrl: '',
    thumbnailUrl: '',
    language: 'English',
    averageRating: 0,
    bayesianRating: calculateBayesianRating(0, 0),
    ratingsCount: 0,
    reviewsCount: 0,
    ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    createdAt: now,
    updatedAt: now
  };
}

function readerProfile(uid: string, email: string, displayName: string): UserProfile {
  return {
    uid,
    email,
    displayName,
    handle: `${displayName.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 14)}_${uid.slice(-4)}`,
    avatarUrl: '',
    bio: '',
    location: '',
    website: '',
    readingGoal: { year: new Date().getFullYear(), targetBooks: 12, completedBooks: 0 },
    stats: { reviewsCount: 0, ratingsCount: 0, booksReadCount: 0, pagesReadTotal: 0 },
    preferences: {
      allowSpoilersDefault: false,
      isProfilePrivate: false,
      notifyOnLikes: true,
      notifyOnComments: true
    },
    createdAt: now,
    updatedAt: now
  };
}

/** Creates the reader on first use, signs in afterwards, and writes the profile. */
async function signIn(reader: TestReader): Promise<void> {
  await signOut(auth).catch(() => undefined);

  try {
    const credential = await createUserWithEmailAndPassword(auth, reader.email, reader.password);
    reader.uid = credential.user.uid;
    await setDoc(
      doc(db, USER_COLLECTION, reader.uid),
      readerProfile(reader.uid, reader.email, reader.displayName)
    );
  } catch {
    const credential = await signInWithEmailAndPassword(auth, reader.email, reader.password);
    reader.uid = credential.user.uid;
  }
}

async function readAggregates(): Promise<BookRatingAggregates> {
  const snapshot = await getDoc(doc(db, BOOK_COLLECTION, bookId));
  const book = snapshot.data() as Book;
  return {
    ratingDistribution: book.ratingDistribution,
    averageRating: book.averageRating,
    ratingsCount: book.ratingsCount,
    bayesianRating: book.bayesianRating
  };
}

async function readBook(): Promise<Book> {
  const snapshot = await getDoc(doc(db, BOOK_COLLECTION, bookId));
  return snapshot.data() as Book;
}

async function readProfile(uid: string): Promise<UserProfile> {
  const snapshot = await getDoc(doc(db, USER_COLLECTION, uid));
  return snapshot.data() as UserProfile;
}

function ratingRecord(
  uid: string,
  rating: number,
  status: 'read' | 'currently-reading' = 'read'
) {
  return {
    ...createShelfRecord({ userId: uid, book: emptyBook(), status }),
    rating,
    status,
    updatedAt: now
  };
}

function reviewDocument(): Review {
  return {
    id: `${readerTwo.uid}_${bookId}`,
    bookId,
    bookTitle: 'Pipeline Test Edition',
    bookCoverUrl: '',
    userId: readerTwo.uid,
    userDisplayName: 'Reader Two',
    userHandle: `reader_two_${readerTwo.uid.slice(-4)}`,
    userAvatarUrl: '',
    rating: 4,
    title: 'A measured test edition',
    content: 'The emulator returns exactly what the transaction committed, every time.',
    containsSpoilers: false,
    likesCount: 0,
    commentsCount: 0,
    tags: [],
    createdAt: now,
    updatedAt: now
  };
}

beforeAll(async () => {
  const report = await checkEmulatorSuite({ config: emulatorConfig, timeoutMs: 5000 });
  if (!report.ok) {
    throw new Error(`Emulator suite unreachable: ${report.summary}`);
  }

  app = initializeApp(resolveFirebaseWebConfig(emulatorEnv), `${runId}-app`);
  auth = getAuth(app);
  db = getFirestore(app);
  connectAuthEmulator(auth, emulatorConfig.authUrl, { disableWarnings: true });
  connectFirestoreEmulator(db, emulatorConfig.host, emulatorConfig.ports.firestore);

  shelfGateway = new FirestoreShelfGateway({ firestore: db });
  reviewGateway = new FirestoreReviewGateway({ firestore: db });

  // The catalog document is created by an authenticated reader, exactly like the
  // shipped security rules require.
  await signIn(readerOne);
  await setDoc(doc(db, BOOK_COLLECTION, bookId), emptyBook());
});

afterAll(async () => {
  try {
    const shelfRef = doc(db, SHELF_COLLECTION, `${readerOne.uid}_${bookId}`);
    if ((await getDoc(shelfRef)).exists()) await deleteDoc(shelfRef);
    await deleteDoc(doc(db, BOOK_COLLECTION, bookId));
    await signOut(auth);
  } catch {
    // Nothing left to clean up; the emulator is ephemeral by design.
  }
  if (app) await deleteApp(app);
});

describe('rating pipeline on the emulator', () => {
  it('applies a first 5-star submission to the aggregate', async () => {
    const before = await readAggregates();
    expect(before.ratingsCount).toBe(0);

    const result = await shelfGateway.commitRating({
      record: ratingRecord(readerOne.uid, 5),
      previousRating: null,
      newRating: 5
    });

    const expected = applyRatingMutation(before, null, 5);
    const stored = await readAggregates();

    expect(stored.ratingDistribution).toEqual(expected.ratingDistribution);
    expect(stored.ratingDistribution[5]).toBe(1);
    expect(stored.ratingsCount).toBe(1);
    expect(stored.averageRating).toBe(5);
    expect(stored.bayesianRating).toBe(calculateBayesianRating(1, 5));
    expect(stored.bayesianRating).toBeLessThan(5);
    expect(result.aggregates).toEqual(stored);
  });

  it('moves an existing rating between tiers without changing the total', async () => {
    const before = await readAggregates();

    await shelfGateway.commitRating({
      record: ratingRecord(readerOne.uid, 3),
      previousRating: 5,
      newRating: 3
    });

    const stored = await readAggregates();

    expect(stored).toEqual(applyRatingMutation(before, 5, 3));
    expect(stored.ratingsCount).toBe(1);
    expect(stored.ratingDistribution[5]).toBe(0);
    expect(stored.ratingDistribution[3]).toBe(1);
  });

  it('folds a second reader into the same aggregate', async () => {
    await signIn(readerTwo);

    await shelfGateway.commitRating({
      record: ratingRecord(readerTwo.uid, 4),
      previousRating: null,
      newRating: 4
    });

    const stored = await readAggregates();
    expect(stored.ratingsCount).toBe(2);
    expect(stored.ratingDistribution[3]).toBe(1);
    expect(stored.ratingDistribution[4]).toBe(1);
    expect(stored.averageRating).toBe(3.5);
    expect(stored.bayesianRating).toBe(calculateBayesianRating(2, 3.5));
  });

  it('refuses to rate a book that is missing from the catalog', async () => {
    const missingId = `${runId}-missing`;

    await expect(
      shelfGateway.commitRating({
        record: {
          ...ratingRecord(readerTwo.uid, 4),
          id: `${readerTwo.uid}_${missingId}`,
          bookId: missingId
        },
        previousRating: null,
        newRating: 4
      })
    ).rejects.toMatchObject({ code: 'books/not-found' });
  });
});

describe('review pipeline on the emulator', () => {
  it('rejects a duplicate review inside the transaction and counts once', async () => {
    await signIn(readerTwo);

    await reviewGateway.createReview(reviewDocument());

    const book = await readBook();
    const profile = await readProfile(readerTwo.uid);
    expect(book.reviewsCount).toBe(1);
    expect(profile.stats.reviewsCount).toBe(1);

    await expect(reviewGateway.createReview(reviewDocument())).rejects.toBeInstanceOf(
      DuplicateReviewError
    );

    const afterwards = await readBook();
    const profileAfterwards = await readProfile(readerTwo.uid);
    expect(afterwards.reviewsCount).toBe(1);
    expect(profileAfterwards.stats.reviewsCount).toBe(1);
  });

  it('reads the review back through the paginated feed', async () => {
    const page = await reviewGateway.listBookReviews({ bookId, sort: 'newest', pageSize: 10 });

    expect(page.items.map((item) => item.id)).toContain(`${readerTwo.uid}_${bookId}`);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursorId).toBeNull();
  });

  it('keeps the reader rating on the review in step when they re-rate the book', async () => {
    const result = await shelfGateway.commitRating({
      record: ratingRecord(readerTwo.uid, 2),
      previousRating: 4,
      newRating: 2
    });

    expect(result.reviewRatingSynced).toBe(true);
    expect((await reviewGateway.getReview(`${readerTwo.uid}_${bookId}`))?.rating).toBe(2);

    const aggregates = await readAggregates();
    expect(aggregates.ratingDistribution[4]).toBe(0);
    expect(aggregates.ratingDistribution[2]).toBe(1);
  });

  it('decrements both counters when the review is deleted', async () => {
    await reviewGateway.deleteReview(`${readerTwo.uid}_${bookId}`);

    const book = await readBook();
    const profile = await readProfile(readerTwo.uid);
    expect(book.reviewsCount).toBe(0);
    expect(profile.stats.reviewsCount).toBe(0);
    expect(await reviewGateway.getReview(`${readerTwo.uid}_${bookId}`)).toBeNull();

    // Deleting an absent review is a no-op rather than an error.
    await expect(reviewGateway.deleteReview(`${readerTwo.uid}_${bookId}`)).resolves.toBeUndefined();
  });
});

describe('shelf browsing on the emulator', () => {
  it('reads shelves with a cursor and honours the status filter', async () => {
    await signIn(readerOne);
    await shelfGateway.writeShelf(ratingRecord(readerOne.uid, 3, 'currently-reading'));

    const page = await shelfGateway.listShelves({ userId: readerOne.uid, pageSize: 1 });
    expect(page.items.map((item) => item.bookId)).toContain(bookId);
    expect(page.items[0]?.userId).toBe(readerOne.uid);

    const reading = await shelfGateway.listShelves({
      userId: readerOne.uid,
      status: 'currently-reading',
      pageSize: 10
    });
    expect(reading.items.length).toBeGreaterThan(0);
    expect(reading.items.every((item) => item.status === 'currently-reading')).toBe(true);

    const abandoned = await shelfGateway.listShelves({
      userId: readerOne.uid,
      status: 'did-not-finish',
      pageSize: 10
    });
    expect(abandoned.items).toHaveLength(0);

    await shelfGateway.deleteShelf(readerOne.uid, bookId);
    const snapshot = await getDoc(doc(db, SHELF_COLLECTION, `${readerOne.uid}_${bookId}`));
    expect(snapshot.exists()).toBe(false);
  });

  it('reports a rejected write for a shelf row owned by another reader', async () => {
    await signIn(readerOne);

    await expect(shelfGateway.writeShelf(ratingRecord(readerTwo.uid, 4))).rejects.toMatchObject({
      code: 'permission-denied'
    });
  });
});
