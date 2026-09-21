/**
 * Shelf and rating persistence.
 *
 * The gateway is an interface so the rune stores can be exercised against a
 * deterministic fake — including simulated offline rejections — while the app
 * uses the Firestore implementation below it, which accepts an injected
 * `Firestore` handle so the emulator suite exercises exactly this code path. Rating writes run inside a
 * Firestore transaction that reads the authoritative histogram before applying
 * the delta, so concurrent submissions cannot clobber each other.
 */
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit as limitTo,
  orderBy,
  query as buildQuery,
  runTransaction,
  setDoc,
  startAfter,
  where,
  type Firestore,
  type QueryConstraint,
  type QueryDocumentSnapshot
} from 'firebase/firestore';
import { db as firebaseDb } from '$lib/firebase/client';
import { applyRatingMutation } from '$lib/utils/ratings';
import { parseUserBookShelf } from '$lib/validation/schemas';
import { BookNotFoundError, DataIntegrityError, WriteRejectedError } from '$lib/data/errors';
import type {
  Book,
  BookRatingAggregates,
  CursorPage,
  ShelfStatus,
  UserBookShelf
} from '$lib/types/domain';

export const SHELF_COLLECTION = 'userShelves';
export const BOOK_COLLECTION = 'books';
export const REVIEW_COLLECTION = 'reviews';
export const USER_COLLECTION = 'users';

export const DEFAULT_SHELF_PAGE_SIZE = 24;

export interface ShelfListQuery {
  userId: string;
  /** `'all'` (or omitted) lists every shelf row for the reader. */
  status?: ShelfStatus | 'all';
  pageSize?: number;
  cursorId?: string | null;
}

export interface RatingCommitInput {
  /** Shelf row to persist, already carrying the new rating. */
  record: UserBookShelf;
  /** The reader's previous rating, or null when rating for the first time. */
  previousRating: number | null;
  newRating: number;
}

export interface RatingCommitResult {
  /** Authoritative aggregates after the transaction. */
  aggregates: BookRatingAggregates;
  /** True when the reader's existing review had its denormalised rating updated. */
  reviewRatingSynced: boolean;
}

export interface ShelfGateway {
  listShelves(input: ShelfListQuery): Promise<CursorPage<UserBookShelf>>;
  writeShelf(record: UserBookShelf): Promise<void>;
  deleteShelf(userId: string, bookId: string): Promise<void>;
  commitRating(input: RatingCommitInput): Promise<RatingCommitResult>;
}

function shelfIdFor(userId: string, bookId: string): string {
  return `${userId}_${bookId}`;
}

function toShelfRecord(snapshot: QueryDocumentSnapshot): UserBookShelf {
  const result = parseUserBookShelf({ ...snapshot.data(), id: snapshot.id });
  if (!result.success) {
    throw new DataIntegrityError(SHELF_COLLECTION, snapshot.id, result.errors);
  }
  return result.data;
}

/** Firestore-backed implementation used by the application. */
export class FirestoreShelfGateway implements ShelfGateway {
  /** Firestore handle; the emulator suite and tests inject their own. */
  #db: Firestore;

  constructor(options: { firestore?: Firestore } = {}) {
    this.#db = options.firestore ?? firebaseDb;
  }

  async listShelves(input: ShelfListQuery): Promise<CursorPage<UserBookShelf>> {
    const pageSize = input.pageSize ?? DEFAULT_SHELF_PAGE_SIZE;
    const constraints: QueryConstraint[] = [where('userId', '==', input.userId)];

    if (input.status && input.status !== 'all') {
      constraints.push(where('status', '==', input.status));
    }

    constraints.push(orderBy('updatedAt', 'desc'));

    if (input.cursorId) {
      const cursor = await getDoc(doc(this.#db, SHELF_COLLECTION, input.cursorId));
      if (cursor.exists()) constraints.push(startAfter(cursor));
    }

    constraints.push(limitTo(pageSize + 1));

    const snapshot = await getDocs(buildQuery(collection(this.#db, SHELF_COLLECTION), ...constraints));
    const page = snapshot.docs.slice(0, pageSize);
    const hasMore = snapshot.docs.length > pageSize;

    return {
      items: page.map(toShelfRecord),
      hasMore,
      nextCursorId: hasMore && page.length > 0 ? page[page.length - 1]!.id : null
    };
  }

  async writeShelf(record: UserBookShelf): Promise<void> {
    await setDoc(doc(this.#db, SHELF_COLLECTION, record.id), record);
  }

  async deleteShelf(userId: string, bookId: string): Promise<void> {
    await deleteDoc(doc(this.#db, SHELF_COLLECTION, shelfIdFor(userId, bookId)));
  }

  async commitRating(input: RatingCommitInput): Promise<RatingCommitResult> {
    const bookRef = doc(this.#db, BOOK_COLLECTION, input.record.bookId);
    const shelfRef = doc(this.#db, SHELF_COLLECTION, input.record.id);
    // The review document shares the shelf's compound id: `${userId}_${bookId}`.
    const reviewRef = doc(this.#db, REVIEW_COLLECTION, input.record.id);

    let aggregates: BookRatingAggregates | null = null;
    let reviewRatingSynced = false;

    await runTransaction(this.#db, async (transaction) => {
      // Firestore requires every read in a transaction to precede the writes, so
      // both documents are fetched before anything is queued for writing.
      const [bookSnapshot, reviewSnapshot] = await Promise.all([
        transaction.get(bookRef),
        transaction.get(reviewRef)
      ]);

      if (!bookSnapshot.exists()) throw new BookNotFoundError(input.record.bookId);

      const book = bookSnapshot.data() as Book;
      const current: BookRatingAggregates = {
        ratingDistribution: book.ratingDistribution,
        averageRating: book.averageRating,
        ratingsCount: book.ratingsCount,
        bayesianRating: book.bayesianRating
      };

      const next = applyRatingMutation(current, input.previousRating, input.newRating);
      aggregates = next;

      transaction.update(bookRef, { ...next, updatedAt: input.record.updatedAt });
      transaction.set(shelfRef, input.record);

      if (reviewSnapshot.exists() && reviewSnapshot.data().rating !== input.newRating) {
        transaction.update(reviewRef, {
          rating: input.newRating,
          updatedAt: input.record.updatedAt
        });
        reviewRatingSynced = true;
      }
    });

    if (!aggregates) {
      throw new WriteRejectedError('The rating could not be saved. Try again.', 'ratings/no-result');
    }

    return { aggregates, reviewRatingSynced };
  }
}

/** Shelf row id shared by the store, the gateway, and the security rules. */
export { shelfIdFor };
