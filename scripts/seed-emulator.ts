/**
 * Emulator catalog seeder (Phase 1 data provisioning).
 *
 * Populates the local Docker emulator suite with a dev catalog so later phases
 * can read real Firestore documents instead of in-component fixtures. Every
 * write goes through the Firebase SDK as an authenticated reader, which means
 * the shipped `firestore.rules` are exercised on the way in, and every
 * aggregate is computed with the same pure rating utilities the app uses.
 *
 * Idempotent: re-running overwrites documents (create on first run, owner
 * update afterwards) and reuses existing Auth emulator accounts.
 *
 * Usage: pnpm run emulator:seed
 * Requires Node >= 22.18 (native TypeScript type stripping).
 */
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
  type User
} from 'firebase/auth';
import { connectFirestoreEmulator, doc, getFirestore, setDoc, type Firestore } from 'firebase/firestore';
import {
  DEFAULT_EMULATOR_HOST,
  resolveEmulatorConfig,
  resolveFirebaseWebConfig,
  type FirebaseEnvSource
} from '../src/lib/firebase/config.ts';
import { checkEmulatorSuite } from '../src/lib/firebase/emulator-health.ts';
import {
  applyRatingMutation,
  bayesianFromDistribution,
  distributionAverage,
  totalRatings
} from '../src/lib/utils/ratings.ts';
import {
  createShelfRecord,
  transitionShelfState,
  type ShelfAction
} from '../src/lib/utils/shelf-state-machine.ts';
import {
  isValidIsbn13,
  parseBook,
  parseUserProfile
} from '../src/lib/validation/schemas.ts';
import type {
  Book,
  BookRatingAggregates,
  RatingDistribution,
  ShelfStatus,
  UserProfile
} from '../src/lib/types/domain.ts';

const env: FirebaseEnvSource = {
  DEV: false,
  PROD: true,
  VITE_FIREBASE_USE_EMULATOR: process.env.VITE_FIREBASE_USE_EMULATOR ?? 'true',
  VITE_FIREBASE_EMULATOR_HOST: process.env.VITE_FIREBASE_EMULATOR_HOST ?? DEFAULT_EMULATOR_HOST,
  VITE_FIREBASE_PROJECT_ID: process.env.VITE_FIREBASE_PROJECT_ID ?? 'book-review-community-dev',
  VITE_FIREBASE_API_KEY: process.env.VITE_FIREBASE_API_KEY ?? 'fake-api-key-for-emulator',
  VITE_FIREBASE_AUTH_DOMAIN: process.env.VITE_FIREBASE_AUTH_DOMAIN ?? 'book-review-community-dev.firebaseapp.com',
  VITE_FIREBASE_STORAGE_BUCKET: process.env.VITE_FIREBASE_STORAGE_BUCKET ?? 'book-review-community-dev.appspot.com',
  VITE_FIREBASE_MESSAGING_SENDER_ID: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '1234567890',
  VITE_FIREBASE_APP_ID: process.env.VITE_FIREBASE_APP_ID ?? '1:1234567890:web:abcdef'
};

const emulatorConfig = resolveEmulatorConfig(env);
const webConfig = resolveFirebaseWebConfig(env);
const SEED_PASSWORD = 'emulator-seed-pass-2026';

interface SeedBookDefinition {
  isbn13: string;
  isbn10: string;
  title: string;
  subtitle: string;
  authors: string[];
  publisher: string;
  publishedDate: string;
  pageCount: number;
  genres: string[];
  description: string;
  /** Curated community baseline, expressed as a star histogram. */
  baseline: RatingDistribution;
}

interface SeedReviewDefinition {
  isbn13: string;
  rating: number;
  title: string;
  content: string;
  containsSpoilers: boolean;
}

interface SeedShelfDefinition {
  isbn13: string;
  status: ShelfStatus;
  rating: number;
  progressPages: number;
  privateNotes?: string;
}

interface SeedReaderDefinition {
  email: string;
  displayName: string;
  handle: string;
  bio: string;
  location: string;
  website: string;
  readingGoalTarget: number;
  reviews: SeedReviewDefinition[];
  shelves: SeedShelfDefinition[];
}

const SEED_BOOKS: readonly SeedBookDefinition[] = [
  {
    isbn13: '9780143127741',
    isbn10: '0143127748',
    title: 'East of Eden',
    subtitle: '',
    authors: ['John Steinbeck'],
    publisher: 'Penguin Classics',
    publishedDate: '2002-06-25',
    pageCount: 601,
    genres: ['Classics', 'Fiction', 'Historical Fiction'],
    description:
      'Two Salinas Valley families retrace the Cain and Abel story across three generations, and the word timshel becomes the hinge of the whole novel.',
    baseline: { 1: 41, 2: 88, 3: 310, 4: 1140, 5: 1820 }
  },
  {
    isbn13: '9780743273565',
    isbn10: '0743273567',
    title: 'The Great Gatsby',
    subtitle: '',
    authors: ['F. Scott Fitzgerald'],
    publisher: 'Scribner',
    publishedDate: '2004-09-30',
    pageCount: 180,
    genres: ['Classics', 'Fiction', 'Literary Fiction'],
    description:
      'A bond salesman drifting through Long Island society watches Jay Gatsby chase a green light across the bay, in prose built on parties and aftermaths.',
    baseline: { 1: 92, 2: 150, 3: 620, 4: 1520, 5: 1380 }
  },
  {
    isbn13: '9780061120084',
    isbn10: '0061120081',
    title: 'To Kill a Mockingbird',
    subtitle: '',
    authors: ['Harper Lee'],
    publisher: 'Harper Perennial Modern Classics',
    publishedDate: '2006-05-23',
    pageCount: 336,
    genres: ['Classics', 'Fiction', 'Historical Fiction'],
    description:
      'Scout Finch narrates a small Alabama town through a trial that exposes its fault lines, with Atticus as the moral centre.',
    baseline: { 1: 38, 2: 74, 3: 280, 4: 880, 5: 1640 }
  },
  {
    isbn13: '9780451524935',
    isbn10: '0451524934',
    title: '1984',
    subtitle: '',
    authors: ['George Orwell'],
    publisher: 'Signet Classics',
    publishedDate: '1961-01-01',
    pageCount: 328,
    genres: ['Classics', 'Science Fiction', 'Dystopian'],
    description:
      'Winston Smith files corrections for a regime that rewrites the past, until the smallest private rebellion becomes a crime the state can smell.',
    baseline: { 1: 66, 2: 120, 3: 460, 4: 1250, 5: 1520 }
  },
  {
    isbn13: '9780141439518',
    isbn10: '0141439513',
    title: 'Pride and Prejudice',
    subtitle: '',
    authors: ['Jane Austen'],
    publisher: 'Penguin Classics',
    publishedDate: '2003-01-30',
    pageCount: 480,
    genres: ['Classics', 'Romance', 'Fiction'],
    description:
      'Elizabeth Bennet and Mr Darcy misread each other in drawing rooms and letters, and every correction lands as comedy and judgement at once.',
    baseline: { 1: 30, 2: 62, 3: 340, 4: 1080, 5: 1490 }
  },
  {
    isbn13: '9780441172719',
    isbn10: '0441172717',
    title: 'Dune',
    subtitle: '',
    authors: ['Frank Herbert'],
    publisher: 'Ace',
    publishedDate: '1990-09-01',
    pageCount: 617,
    genres: ['Science Fiction', 'Fantasy', 'Classics'],
    description:
      'On Arrakis, water is wealth and spice is power; the Atreides fall and Paul rises inside an ecology of prophecy, empire, and sand.',
    baseline: { 1: 48, 2: 110, 3: 420, 4: 1180, 5: 1560 }
  },
  {
    isbn13: '9780525559474',
    isbn10: '0525559477',
    title: 'The Midnight Library',
    subtitle: '',
    authors: ['Matt Haig'],
    publisher: 'Viking',
    publishedDate: '2020-09-29',
    pageCount: 304,
    genres: ['Fiction', 'Contemporary', 'Fantasy'],
    description:
      'Between life and death sits a library of the lives Nora Seed could have lived, and each volume costs her something to open.',
    baseline: { 1: 120, 2: 240, 3: 640, 4: 980, 5: 720 }
  },
  {
    isbn13: '9780593318171',
    isbn10: '0593318173',
    title: 'Klara and the Sun',
    subtitle: '',
    authors: ['Kazuo Ishiguro'],
    publisher: 'Knopf',
    publishedDate: '2021-03-02',
    pageCount: 303,
    genres: ['Fiction', 'Science Fiction', 'Literary Fiction'],
    description:
      'An Artificial Friend watches a shop window, then a household, and works out what devotion means when it is manufactured.',
    baseline: { 1: 74, 2: 160, 3: 420, 4: 700, 5: 560 }
  }
];

const SEED_READERS: readonly SeedReaderDefinition[] = [
  {
    email: 'ada.reads@example.com',
    displayName: 'Ada Okonkwo',
    handle: 'ada_reads',
    bio: 'Reads two books a week, annotates in pencil, and keeps a shelf for rereads.',
    location: 'Lisbon',
    website: 'https://example.com/ada',
    readingGoalTarget: 52,
    reviews: [
      {
        isbn13: '9780143127741',
        rating: 5,
        title: 'The word timshel earns every page',
        content:
          'Steinbeck lets a family argument run for six hundred pages and never loses the thread. The Salinas Valley reads like a character with its own moods, and the ending recontextualises everything Cal has been carrying.',
        containsSpoilers: false
      },
      {
        isbn13: '9780441172719',
        rating: 4.5,
        title: 'Politics, ecology, and a lot of sand',
        content:
          'The world-building is the point: water discipline, spice economics, and prophecy all behave like systems rather than set dressing. The middle third sags under its own apparatus, but the payoff is worth it.',
        containsSpoilers: false
      }
    ],
    shelves: [
      { isbn13: '9780143127741', status: 'read', rating: 5, progressPages: 601 },
      { isbn13: '9780441172719', status: 'read', rating: 4.5, progressPages: 617 },
      { isbn13: '9780525559474', status: 'currently-reading', rating: 0, progressPages: 96 },
      { isbn13: '9780061120084', status: 'want-to-read', rating: 0, progressPages: 0 },
      {
        isbn13: '9780593318171',
        status: 'did-not-finish',
        rating: 0,
        progressPages: 84,
        privateNotes: 'Stalled around the fourth window shift; will retry in autumn.'
      }
    ]
  },
  {
    email: 'marco.silva@example.com',
    displayName: 'Marco Silva',
    handle: 'marco_silva',
    bio: 'Twentieth-century fiction, long walks, and a stubborn preference for paperbacks.',
    location: 'Porto',
    website: 'https://example.com/marco',
    readingGoalTarget: 30,
    reviews: [
      {
        isbn13: '9780743273565',
        rating: 4,
        title: 'Short, exact, and quietly devastating',
        content:
          'Every party scene is doing double duty as social history and character study. Nick is a slippery narrator in the best sense, and the last two pages still land like a verdict.',
        containsSpoilers: false
      },
      {
        isbn13: '9780451524935',
        rating: 4.5,
        title: 'Still the sharpest vocabulary for surveillance',
        content:
          'Newspeak, doublethink, and the memory hole have outlived their century. The romance subplot is the weakest hinge, but the appendix on language is genuinely chilling.',
        containsSpoilers: true
      }
    ],
    shelves: [
      { isbn13: '9780743273565', status: 'read', rating: 4, progressPages: 180 },
      { isbn13: '9780451524935', status: 'read', rating: 4.5, progressPages: 328 },
      { isbn13: '9780141439518', status: 'currently-reading', rating: 0, progressPages: 210 },
      { isbn13: '9780525559474', status: 'want-to-read', rating: 0, progressPages: 0 }
    ]
  },
  {
    email: 'yuki.tanaka@example.com',
    displayName: 'Yuki Tanaka',
    handle: 'yuki_reads',
    bio: 'Science fiction, translated fiction, and a notebook of first lines.',
    location: 'Kyoto',
    website: 'https://example.com/yuki',
    readingGoalTarget: 40,
    reviews: [
      {
        isbn13: '9780593318171',
        rating: 5,
        title: 'Devotion observed from the outside',
        content:
          'Ishiguro keeps Klara literal-minded and therefore unbearably perceptive. The sun as a source of hope is handled with such restraint that the final chapters feel earned rather than engineered.',
        containsSpoilers: false
      },
      {
        isbn13: '9780141439518',
        rating: 4.5,
        title: 'Comedy of manners with a scalpel in it',
        content:
          'The dialogue does the work that modern novels hand to interior monologue. Mr Collins remains the funniest sustained joke in English fiction.',
        containsSpoilers: false
      }
    ],
    shelves: [
      { isbn13: '9780593318171', status: 'read', rating: 5, progressPages: 303 },
      { isbn13: '9780141439518', status: 'read', rating: 4.5, progressPages: 480 },
      { isbn13: '9780441172719', status: 'currently-reading', rating: 0, progressPages: 340 },
      { isbn13: '9780743273565', status: 'want-to-read', rating: 0, progressPages: 0 }
    ]
  },
  {
    email: 'priya.raman@example.com',
    displayName: 'Priya Raman',
    handle: 'priya_raman',
    bio: 'Non-fiction by day, contemporary fiction by night, audiobooks on the commute.',
    location: 'Bengaluru',
    website: 'https://example.com/priya',
    readingGoalTarget: 24,
    reviews: [
      {
        isbn13: '9780525559474',
        rating: 3.5,
        title: 'Comforting premise, thin middle',
        content:
          'The library device is a lovely engine for regret, and the early branches are sharp. It repeats its own lesson more often than it needs to, so the last hundred pages coast.',
        containsSpoilers: false
      },
      {
        isbn13: '9780061120084',
        rating: 5,
        title: 'A courtroom seen from a child’s height',
        content:
          'The trick of the narration is that Scout reports what she cannot yet interpret, and the gap between the two is where the whole moral weight of the book lives.',
        containsSpoilers: false
      }
    ],
    shelves: [
      { isbn13: '9780525559474', status: 'read', rating: 3.5, progressPages: 304 },
      { isbn13: '9780061120084', status: 'read', rating: 5, progressPages: 336 },
      { isbn13: '9780593318171', status: 'want-to-read', rating: 0, progressPages: 0 },
      { isbn13: '9780451524935', status: 'currently-reading', rating: 0, progressPages: 128 }
    ]
  }
];

function coverUrl(isbn13: string, size: 'L' | 'M'): string {
  return `https://covers.openlibrary.org/b/isbn/${isbn13}-${size}.jpg`;
}

function buildAggregates(baseline: RatingDistribution): BookRatingAggregates {
  const ratingsCount = totalRatings(baseline);
  const averageRating = distributionAverage(baseline);
  return {
    ratingDistribution: { ...baseline },
    ratingsCount,
    averageRating,
    bayesianRating: bayesianFromDistribution(baseline)
  };
}

function validateFixtures(): void {
  const problems: string[] = [];

  for (const book of SEED_BOOKS) {
    if (!isValidIsbn13(book.isbn13)) {
      problems.push(`${book.title}: ISBN-13 ${book.isbn13} failed its checksum.`);
    }
    if (totalRatings(book.baseline) === 0) {
      problems.push(`${book.title}: baseline histogram is empty.`);
    }
  }

  if (problems.length > 0) {
    throw new Error(`Seed fixtures are invalid:\n- ${problems.join('\n- ')}`);
  }
}

async function ensureReader(auth: Auth, reader: SeedReaderDefinition): Promise<User> {
  try {
    const credential = await createUserWithEmailAndPassword(auth, reader.email, SEED_PASSWORD);
    return credential.user;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'auth/email-already-in-use') {
      const credential = await signInWithEmailAndPassword(auth, reader.email, SEED_PASSWORD);
      return credential.user;
    }
    throw error;
  }
}

function buildProfile(reader: SeedReaderDefinition, uid: string, now: string): UserProfile {
  const reviewsCount = reader.reviews.length;
  const booksReadCount = reader.shelves.filter((shelf) => shelf.status === 'read').length;
  const pagesReadTotal = reader.shelves.reduce((total, shelf) => total + shelf.progressPages, 0);

  return {
    uid,
    email: reader.email,
    displayName: reader.displayName,
    handle: reader.handle,
    avatarUrl: `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(reader.displayName)}`,
    bio: reader.bio,
    location: reader.location,
    website: reader.website,
    readingGoal: {
      year: new Date(now).getUTCFullYear(),
      targetBooks: reader.readingGoalTarget,
      completedBooks: booksReadCount
    },
    stats: {
      reviewsCount,
      ratingsCount: reader.reviews.length,
      booksReadCount,
      pagesReadTotal
    },
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

const app: FirebaseApp = initializeApp(webConfig, `emulator-seed-${Date.now()}`);
const auth: Auth = getAuth(app);
const db: Firestore = getFirestore(app);

// Bind every handle to the local Docker emulator suite before any write happens.
connectAuthEmulator(auth, emulatorConfig.authUrl, { disableWarnings: true });
connectFirestoreEmulator(db, emulatorConfig.host, emulatorConfig.ports.firestore);

async function main(): Promise<void> {
  console.log(`\nSeeding catalog into project "${webConfig.projectId}" on ${emulatorConfig.host}…\n`);

  const suite = await checkEmulatorSuite({ config: emulatorConfig, timeoutMs: 5000 });
  if (!suite.ok) {
    throw new Error(`${suite.summary}`);
  }

  validateFixtures();

  const now = new Date().toISOString();
  const aggregateByIsbn = new Map<string, BookRatingAggregates>();
  const reviewCountByIsbn = new Map<string, number>();

  for (const definition of SEED_BOOKS) {
    aggregateByIsbn.set(definition.isbn13, buildAggregates(definition.baseline));
    reviewCountByIsbn.set(definition.isbn13, 0);
  }

  let shelfWrites = 0;
  let reviewWrites = 0;

  for (const reader of SEED_READERS) {
    const user = await ensureReader(auth, reader);
    const profile = buildProfile(reader, user.uid, now);
    const profileValidation = parseUserProfile(profile);

    if (!profileValidation.success) {
      throw new Error(
        `Seed profile for ${reader.email} failed validation: ${profileValidation.errors.join('; ')}`
      );
    }

    await setDoc(doc(db, 'users', user.uid), profile);
    console.log(`  \u2714 users/${user.uid} — ${reader.displayName} (@${reader.handle})`);

    for (const shelfDefinition of reader.shelves) {
      const bookDefinition = SEED_BOOKS.find((book) => book.isbn13 === shelfDefinition.isbn13);
      if (!bookDefinition) {
        throw new Error(`Shelf fixture references unknown ISBN ${shelfDefinition.isbn13}.`);
      }

      let shelf = createShelfRecord({
        userId: user.uid,
        book: {
          id: bookDefinition.isbn13,
          title: bookDefinition.title,
          authors: bookDefinition.authors,
          coverUrl: coverUrl(bookDefinition.isbn13, 'L'),
          pageCount: bookDefinition.pageCount
        },
        status: shelfDefinition.status,
        rating: shelfDefinition.rating
      });

      if (shelfDefinition.status === 'currently-reading' && shelfDefinition.progressPages > 0) {
        shelf = transitionShelfState(shelf, {
          type: 'UPDATE_PROGRESS',
          pagesRead: shelfDefinition.progressPages
        });
      }

      if (shelfDefinition.status === 'did-not-finish') {
        const action: ShelfAction = shelfDefinition.privateNotes
          ? { type: 'MOVE_TO_DNF', privateNotes: shelfDefinition.privateNotes }
          : { type: 'MOVE_TO_DNF' };
        shelf = transitionShelfState(shelf, action);
      }

      await setDoc(doc(db, 'userShelves', shelf.id), shelf);
      shelfWrites += 1;
    }

    for (const reviewDefinition of reader.reviews) {
      const bookDefinition = SEED_BOOKS.find((book) => book.isbn13 === reviewDefinition.isbn13);
      if (!bookDefinition) {
        throw new Error(`Review fixture references unknown ISBN ${reviewDefinition.isbn13}.`);
      }

      const reviewId = `${user.uid}_${reviewDefinition.isbn13}`;
      await setDoc(doc(db, 'reviews', reviewId), {
        id: reviewId,
        bookId: reviewDefinition.isbn13,
        bookTitle: bookDefinition.title,
        bookCoverUrl: coverUrl(bookDefinition.isbn13, 'M'),
        userId: user.uid,
        userDisplayName: reader.displayName,
        userHandle: reader.handle,
        userAvatarUrl: profile.avatarUrl,
        rating: reviewDefinition.rating,
        title: reviewDefinition.title,
        content: reviewDefinition.content,
        containsSpoilers: reviewDefinition.containsSpoilers,
        likesCount: 0,
        commentsCount: 0,
        tags: [],
        createdAt: now,
        updatedAt: now
      });
      reviewWrites += 1;

      const current = aggregateByIsbn.get(reviewDefinition.isbn13);
      if (!current) {
        throw new Error(`Missing aggregate state for ${reviewDefinition.isbn13}.`);
      }
      aggregateByIsbn.set(
        reviewDefinition.isbn13,
        applyRatingMutation(current, null, reviewDefinition.rating)
      );
      reviewCountByIsbn.set(
        reviewDefinition.isbn13,
        (reviewCountByIsbn.get(reviewDefinition.isbn13) ?? 0) + 1
      );
    }

    await signOut(auth);
  }

  // Catalog writes require an authenticated session, so the seeding reader signs
  // back in before the aggregate documents are written.
  const catalogAuthor = SEED_READERS[0];
  if (!catalogAuthor) {
    throw new Error('At least one seed reader is required to author catalog writes.');
  }
  await signInWithEmailAndPassword(auth, catalogAuthor.email, SEED_PASSWORD);

  for (const definition of SEED_BOOKS) {
    const aggregates = aggregateByIsbn.get(definition.isbn13);
    if (!aggregates) {
      throw new Error(`Missing aggregates for ${definition.isbn13}.`);
    }

    const book: Book = {
      id: definition.isbn13,
      isbn13: definition.isbn13,
      isbn10: definition.isbn10,
      title: definition.title,
      subtitle: definition.subtitle,
      authors: [...definition.authors],
      publisher: definition.publisher,
      publishedDate: definition.publishedDate,
      description: definition.description,
      pageCount: definition.pageCount,
      genres: [...definition.genres],
      coverUrl: coverUrl(definition.isbn13, 'L'),
      thumbnailUrl: coverUrl(definition.isbn13, 'M'),
      language: 'en',
      averageRating: aggregates.averageRating,
      bayesianRating: aggregates.bayesianRating,
      ratingsCount: aggregates.ratingsCount,
      reviewsCount: reviewCountByIsbn.get(definition.isbn13) ?? 0,
      ratingDistribution: aggregates.ratingDistribution,
      createdAt: now,
      updatedAt: now
    };

    const validation = parseBook(book);
    if (!validation.success) {
      throw new Error(`Seed book ${book.isbn13} failed validation: ${validation.errors.join('; ')}`);
    }

    await setDoc(doc(db, 'books', book.id), book);
  }

  await signOut(auth);

  console.log(`  \u2714 books — ${SEED_BOOKS.length} catalog documents`);
  console.log(`  \u2714 userShelves — ${shelfWrites} shelf rows`);
  console.log(`  \u2714 reviews — ${reviewWrites} published reviews`);
  console.log(
    `\nSeed complete: ${SEED_BOOKS.length} books, ${SEED_READERS.length} readers, ${shelfWrites} shelves, ${reviewWrites} reviews.`
  );
  console.log(`Emulator UI: ${emulatorConfig.uiUrl}\n`);
}

try {
  await main();
} catch (error) {
  console.error(`\nSeed failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await deleteApp(app);
}
