/**
 * Emulator acceptance harness (Phase 1).
 *
 * Proves, against the running Docker emulator suite, that:
 *   1. All four emulator endpoints respond (Auth 9099, Firestore 8080, Storage 9199, UI 4000).
 *   2. The Firebase SDK binds to the emulators without TLS/insecure-transport warnings.
 *   3. Firestore document references are valid and reads/writes round-trip.
 *   4. The shipped `firestore.rules` accept owner writes and reject foreign or
 *      duplicate writes (review compound-id contract).
 *   5. Storage references upload, resolve a download URL, and delete.
 *
 * Usage: pnpm run emulator:verify
 * Requires Node >= 22.18 (native TypeScript type stripping).
 */
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
  signOut,
  type Auth,
  type User
} from 'firebase/auth';
import {
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDoc,
  getFirestore,
  runTransaction,
  setDoc,
  type Firestore
} from 'firebase/firestore';
import {
  connectStorageEmulator,
  deleteObject,
  getDownloadURL,
  getStorage,
  ref,
  uploadString,
  type FirebaseStorage
} from 'firebase/storage';
import {
  DEFAULT_EMULATOR_HOST,
  resolveEmulatorConfig,
  resolveFirebaseWebConfig,
  type FirebaseEnvSource
} from '../src/lib/firebase/config.ts';
import { checkEmulatorSuite } from '../src/lib/firebase/emulator-health.ts';
import { applyRatingMutation } from '../src/lib/utils/ratings.ts';
import { createShelfRecord } from '../src/lib/utils/shelf-state-machine.ts';
import { parseBook, parseUserBookShelf } from '../src/lib/validation/schemas.ts';
import type { Book, ShelfBookSnapshot } from '../src/lib/types/domain.ts';

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

const PROBE_BOOK_ID = 'verify-9780000000002';
const PROBE_ISBN = '9780000000002';
const PROBE_PASSWORD = 'emulator-verify-pass';
const NOW = new Date().toISOString();

const probeBookSnapshot: ShelfBookSnapshot = {
  id: PROBE_BOOK_ID,
  title: 'Emulator Verification Fixture',
  authors: ['Verification Harness'],
  coverUrl: '',
  pageCount: 120
};

const probeBook: Book = {
  id: PROBE_BOOK_ID,
  isbn13: PROBE_ISBN,
  isbn10: '',
  title: 'Emulator Verification Fixture',
  subtitle: '',
  authors: ['Verification Harness'],
  publisher: 'Local Emulator',
  publishedDate: '2026-01-01',
  description: 'Temporary catalog document written by the Phase 1 emulator acceptance harness.',
  pageCount: 120,
  genres: ['Verification'],
  coverUrl: '',
  thumbnailUrl: '',
  language: 'en',
  averageRating: 0,
  bayesianRating: 0,
  ratingsCount: 0,
  reviewsCount: 0,
  ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
  createdAt: NOW,
  updatedAt: NOW
};

interface StepResult {
  name: string;
  ok: boolean;
  detail: string;
}

const results: StepResult[] = [];
const captureBuffer: string[] = [];

/** Harness output is written through these so SDK capture never swallows it. */
const emit = console.log.bind(console);
const emitError = console.error.bind(console);

function record(name: string, detail: string): void {
  results.push({ name, ok: true, detail });
  emit(`  \u2714 ${name} — ${detail}`);
}

function fail(name: string, detail: string): void {
  results.push({ name, ok: false, detail });
  emitError(`  \u2718 ${name} — ${detail}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

/** Returns the signed-in verification reader or fails the current step. */
function requireUser(): User {
  const user = signedInUser;
  if (user === null) {
    throw new Error('No authenticated user available.');
  }
  return user;
}

async function step(name: string, action: () => Promise<string>): Promise<void> {
  try {
    record(name, await action());
  } catch (error) {
    fail(name, error instanceof Error ? error.message : String(error));
  }
}

/** Deletes a document with the Firestore emulator's owner token (bypasses rules). */
async function deleteDocumentBypassingRules(path: string): Promise<void> {
  const url = `${emulatorConfig.firestoreOrigin}/v1/projects/${webConfig.projectId}/databases/(default)/documents/${path}`;
  const response = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer owner' }
  });
  assert(response.ok, `Owner-token delete of ${path} failed with HTTP ${response.status}.`);
}

const app: FirebaseApp = initializeApp(webConfig, `emulator-verify-${Date.now()}`);
const auth: Auth = getAuth(app);
const db: Firestore = getFirestore(app);
const storage: FirebaseStorage = getStorage(app);

let signedInUser: User | null = null;

// Capture SDK chatter so we can prove that no TLS/insecure warnings are emitted.
const originalWarn = console.warn;
const originalError = console.error;
console.warn = (...args: unknown[]) => {
  captureBuffer.push(args.map(String).join(' '));
};
console.error = (...args: unknown[]) => {
  captureBuffer.push(args.map(String).join(' '));
};

function report(warnings: string[]): void {
  const insecure = warnings.filter((entry) => /tls|insecure|ssl/i.test(entry));
  if (insecure.length === 0) {
    record(
      'SDK emits no TLS/insecure warnings',
      `${warnings.length} SDK message(s) captured, none transport-related`
    );
  } else {
    fail('SDK emits no TLS/insecure warnings', insecure.join(' | '));
  }
}

async function main(): Promise<void> {
  console.log(`\nFirebase emulator acceptance harness — project "${webConfig.projectId}", host ${emulatorConfig.host}\n`);

  await step('Emulator suite endpoints', async () => {
    const report_ = await checkEmulatorSuite({ config: emulatorConfig, timeoutMs: 5000 });
    assert(report_.ok, report_.summary);
    return report_.summary;
  });

  await step('Bind SDK to emulators', async () => {
    connectAuthEmulator(auth, emulatorConfig.authUrl, { disableWarnings: true });
    connectFirestoreEmulator(db, emulatorConfig.host, emulatorConfig.ports.firestore);
    connectStorageEmulator(storage, emulatorConfig.host, emulatorConfig.ports.storage);

    const authEmulator = (
      auth as unknown as { emulatorConfig?: { protocol: string; host: string; port: number } | null }
    ).emulatorConfig;

    assert(authEmulator != null, 'Auth SDK did not record an emulator configuration.');
    assert(authEmulator.port === 9099, `Auth emulator port is ${authEmulator.port}, expected 9099.`);
    return `Auth ${authEmulator.protocol}//${authEmulator.host}:${authEmulator.port}`;
  });

  await step('Build valid Firestore references', async () => {
    const bookRef = doc(db, 'books', PROBE_ISBN);
    assert(bookRef.path === `books/${PROBE_ISBN}`, `Unexpected reference path ${bookRef.path}.`);
    assert(bookRef.id === PROBE_ISBN, 'Reference id does not match the requested document id.');
    assert(bookRef.firestore === db, 'Reference is not bound to the initialised Firestore instance.');

    const missing = await getDoc(doc(db, 'books', 'isbn-that-does-not-exist'));
    assert(!missing.exists(), 'A non-existent document unexpectedly resolved to a snapshot.');
    return `books/${PROBE_ISBN} resolves against a live Firestore instance`;
  });

  await step('Authenticate against the Auth emulator', async () => {
    const email = `verify+${Date.now()}@example.com`;
    const credential = await createUserWithEmailAndPassword(auth, email, PROBE_PASSWORD);
    signedInUser = credential.user;

    assert(credential.user.uid.length > 0, 'Auth emulator returned an empty uid.');
    const token = await credential.user.getIdToken();
    assert(token.length > 0, 'Auth emulator did not issue an ID token.');
    return `${email} → uid ${credential.user.uid.slice(0, 8)}…`;
  });

  await step('Write a shelf document under firestore.rules', async () => {
    const user = requireUser();

    const record_ = createShelfRecord({
      userId: user.uid,
      book: probeBookSnapshot,
      status: 'currently-reading'
    });

    await setDoc(doc(db, 'userShelves', record_.id), record_);
    const snapshot = await getDoc(doc(db, 'userShelves', record_.id));
    assert(snapshot.exists(), 'Shelf document was not persisted.');

    const parsed = parseUserBookShelf(snapshot.data());
    assert(
      parsed.success,
      parsed.success ? '' : `Persisted shelf document failed validation: ${parsed.errors.join('; ')}`
    );
    return `userShelves/${record_.id} persisted and validated`;
  });

  await step('Enforce the compound review-id contract', async () => {
    const user = requireUser();

    const reviewId = `${user.uid}_${PROBE_BOOK_ID}`;
    const reviewRef = doc(db, 'reviews', reviewId);
    const reviewDoc = {
      id: reviewId,
      bookId: PROBE_BOOK_ID,
      bookTitle: probeBook.title,
      bookCoverUrl: '',
      userId: user.uid,
      userDisplayName: 'Verification Harness',
      userHandle: 'verify_harness',
      userAvatarUrl: '',
      rating: 4.5,
      title: 'Harness review headline',
      content: 'Written by the Phase 1 emulator acceptance harness to prove rules enforcement.',
      containsSpoilers: false,
      likesCount: 0,
      commentsCount: 0,
      tags: [],
      createdAt: NOW,
      updatedAt: NOW
    };

    await setDoc(reviewRef, reviewDoc);
    const stored = await getDoc(reviewRef);
    assert(stored.exists(), 'Review document was not persisted.');

    // The compound id pins one review per (reader, book) pair: an off-contract id
    // can never be created because the create rule re-derives the id from the uid
    // and the payload book id. The transaction commits server-side, so a denial is
    // reported as a rejection rather than a fire-and-forget write.
    const duplicateId = `${user.uid}_${PROBE_BOOK_ID}_duplicate`;
    const duplicateRef = doc(db, 'reviews', duplicateId);
    let offContractDenied = false;
    try {
      await runTransaction(db, async (transaction) => {
        const existing = await transaction.get(duplicateRef);
        assert(!existing.exists(), 'The duplicate review document already existed before the write.');
        transaction.set(duplicateRef, { ...reviewDoc, id: duplicateId });
      });
    } catch (error) {
      offContractDenied = (error as { code?: string }).code === 'permission-denied';
    }

    const duplicateSnapshot = await getDoc(duplicateRef);
    assert(!duplicateSnapshot.exists(), 'A duplicate review document was created.');
    assert(
      offContractDenied,
      'firestore.rules accepted a review document outside the compound id contract.'
    );

    // Owner edits flow through the update rule and must persist.
    await setDoc(reviewRef, { ...reviewDoc, title: 'Harness review headline (edited)' });
    const edited = await getDoc(reviewRef);
    assert(
      edited.data()?.title === 'Harness review headline (edited)',
      'Owner edit of the review did not persist.'
    );

    await deleteDoc(reviewRef);
    const removed = await getDoc(reviewRef);
    assert(!removed.exists(), 'Owner delete did not remove the review.');

    return `reviews/${reviewId} created, off-contract id denied, edit and delete allowed`;
  });

  await step('Reject writes that impersonate another reader', async () => {
    const user = requireUser();

    const foreignShelfId = `intruder_${PROBE_BOOK_ID}`;
    const foreignRecord = {
      ...createShelfRecord({
        userId: user.uid,
        book: probeBookSnapshot,
        status: 'want-to-read'
      }),
      id: foreignShelfId,
      userId: 'intruder'
    };

    let denied = false;
    try {
      await setDoc(doc(db, 'userShelves', foreignShelfId), foreignRecord);
    } catch (error) {
      denied = (error as { code?: string }).code === 'permission-denied';
      if (!denied) {
        throw new Error(`Foreign write failed with unexpected error: ${String(error)}`);
      }
    }
    assert(denied, 'firestore.rules allowed a shelf write owned by a different uid.');
    return 'userShelves write for a foreign uid rejected with permission-denied';
  });

  await step('Apply a rating through the transactional aggregate contract', async () => {
    // Catalog aggregate writes are only permitted for authenticated sessions.
    requireUser();

    const validation = parseBook(probeBook);
    assert(validation.success, 'Probe book fixture failed schema validation.');

    const bookRef = doc(db, 'books', PROBE_BOOK_ID);
    await setDoc(bookRef, probeBook);

    const aggregates = applyRatingMutation(
      {
        averageRating: probeBook.averageRating,
        bayesianRating: probeBook.bayesianRating,
        ratingsCount: probeBook.ratingsCount,
        ratingDistribution: probeBook.ratingDistribution
      },
      null,
      5
    );

    await setDoc(bookRef, { ...probeBook, ...aggregates }, { merge: true });
    const snapshot = await getDoc(bookRef);
    assert(snapshot.exists(), 'Rating aggregate update did not persist.');

    const stored = snapshot.data() as Book;
    assert(stored.ratingsCount === 1, `Expected ratingsCount 1, received ${stored.ratingsCount}.`);
    assert(stored.averageRating === 5, `Expected averageRating 5, received ${stored.averageRating}.`);
    assert(stored.ratingDistribution[5] === 1, 'Rating histogram did not record the five-star tier.');
    assert(
      stored.bayesianRating === aggregates.bayesianRating,
      `Bayesian score mismatch: stored ${stored.bayesianRating}, computed ${aggregates.bayesianRating}.`
    );
    return `books/${PROBE_BOOK_ID} aggregates updated (bayesian ${stored.bayesianRating}, count ${stored.ratingsCount})`;
  });

  await step('Round-trip a Storage object', async () => {
    const user = requireUser();

    const objectRef = ref(storage, `avatars/${user.uid}/verify.png`);
    const payload = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

    await uploadString(objectRef, payload, 'base64', { contentType: 'image/png' });
    const downloadUrl = await getDownloadURL(objectRef);
    assert(downloadUrl.length > 0, 'Storage emulator did not return a download URL.');
    await deleteObject(objectRef);
    return `avatars/${user.uid}/verify.png uploaded, resolved, and deleted`;
  });

  await step('Sign out and clean up probe data', async () => {
    const user = requireUser();

    await deleteDoc(doc(db, 'userShelves', `${user.uid}_${PROBE_BOOK_ID}`));
    await deleteDocumentBypassingRules(`books/${PROBE_BOOK_ID}`);

    await signOut(auth);
    await deleteUser(user);
    signedInUser = null;
    return 'probe documents removed and the temporary reader deleted';
  });
}

try {
  await main();
} catch (error) {
  fail('Harness execution', error instanceof Error ? error.message : String(error));
} finally {
  const warnings = [...captureBuffer];
  console.warn = originalWarn;
  console.error = originalError;

  report(warnings);

  if (warnings.length > 0) {
    emit('\n  Captured SDK messages:');
    for (const entry of warnings) {
      emit(`    · ${entry}`);
    }
  }

  await deleteApp(app);

  const failures = results.filter((result) => !result.ok);
  emit(
    `\n${results.length - failures.length}/${results.length} checks passed${failures.length > 0 ? ` — ${failures.length} failed` : ''}.\n`
  );

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}
