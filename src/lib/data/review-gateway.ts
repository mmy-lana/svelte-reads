/**
 * Review persistence.
 *
 * One review per reader per book is a data invariant, not a UI convention: the
 * deterministic `${userId}_${bookId}` document id makes duplicates impossible,
 * and the write transaction re-checks existence so two racing submissions can
 * never both succeed. The same transaction maintains the denormalised counters
 * on the book (`reviewsCount`) and on the reader's profile (`stats.reviewsCount`).
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  limit as limitTo,
  orderBy,
  query as buildQuery,
  runTransaction,
  startAfter,
  updateDoc,
  where,
  type Firestore,
  type QueryConstraint,
  type QueryDocumentSnapshot
} from 'firebase/firestore';
import { db as firebaseDb } from '$lib/firebase/client';
import { parseReview } from '$lib/validation/schemas';
import { DataIntegrityError, DuplicateReviewError } from '$lib/data/errors';
import { BOOK_COLLECTION, REVIEW_COLLECTION, USER_COLLECTION } from '$lib/data/shelf-gateway';
import type { CursorPage, Review, ReviewSortOption } from '$lib/types/domain';

export const DEFAULT_REVIEW_PAGE_SIZE = 10;

export interface ReviewListQuery {
  bookId: string;
  sort?: ReviewSortOption;
  pageSize?: number;
  cursorId?: string | null;
}

export interface ReviewUpdateInput {
  reviewId: string;
  rating: number;
  title: string;
  content: string;
  containsSpoilers: boolean;
  updatedAt: string;
}

export interface ReviewGateway {
  listBookReviews(input: ReviewListQuery): Promise<CursorPage<Review>>;
  /** Persists a new review, rejecting duplicates and bumping both counters. */
  createReview(review: Review): Promise<void>;
  updateReview(input: ReviewUpdateInput): Promise<void>;
  /** Removes a review and its counter contributions; a missing review is a no-op. */
  deleteReview(reviewId: string): Promise<void>;
  getReview(reviewId: string): Promise<Review | null>;
}

function toReview(snapshot: QueryDocumentSnapshot): Review {
  const result = parseReview({ ...snapshot.data(), id: snapshot.id });
  if (!result.success) {
    throw new DataIntegrityError(REVIEW_COLLECTION, snapshot.id, result.errors);
  }
  return result.data;
}

/** Firestore-backed implementation used by the application. */
export class FirestoreReviewGateway implements ReviewGateway {
  /** Firestore handle; the emulator suite and tests inject their own. */
  #db: Firestore;

  constructor(options: { firestore?: Firestore } = {}) {
    this.#db = options.firestore ?? firebaseDb;
  }

  async listBookReviews(input: ReviewListQuery): Promise<CursorPage<Review>> {
    const pageSize = input.pageSize ?? DEFAULT_REVIEW_PAGE_SIZE;
    const sort = input.sort ?? 'newest';
    const constraints: QueryConstraint[] = [where('bookId', '==', input.bookId)];

    if (sort === 'most-helpful') constraints.push(orderBy('likesCount', 'desc'));
    else if (sort === 'highest-rated') constraints.push(orderBy('rating', 'desc'));
    else constraints.push(orderBy('createdAt', 'desc'));

    if (input.cursorId) {
      const cursor = await getDoc(doc(this.#db, REVIEW_COLLECTION, input.cursorId));
      if (cursor.exists()) constraints.push(startAfter(cursor));
    }

    constraints.push(limitTo(pageSize + 1));

    const snapshot = await getDocs(buildQuery(collection(this.#db, REVIEW_COLLECTION), ...constraints));
    const page = snapshot.docs.slice(0, pageSize);
    const hasMore = snapshot.docs.length > pageSize;

    return {
      items: page.map(toReview),
      hasMore,
      nextCursorId: hasMore && page.length > 0 ? page[page.length - 1]!.id : null
    };
  }

  async getReview(reviewId: string): Promise<Review | null> {
    const snapshot = await getDoc(doc(this.#db, REVIEW_COLLECTION, reviewId));
    if (!snapshot.exists()) return null;
    const result = parseReview({ ...snapshot.data(), id: snapshot.id });
    if (!result.success) throw new DataIntegrityError(REVIEW_COLLECTION, reviewId, result.errors);
    return result.data;
  }

  async createReview(review: Review): Promise<void> {
    const reviewRef = doc(this.#db, REVIEW_COLLECTION, review.id);
    const bookRef = doc(this.#db, BOOK_COLLECTION, review.bookId);
    const userRef = doc(this.#db, USER_COLLECTION, review.userId);

    await runTransaction(this.#db, async (transaction) => {
      const existing = await transaction.get(reviewRef);
      if (existing.exists()) throw new DuplicateReviewError(review.bookId);

      transaction.set(reviewRef, review);
      transaction.update(bookRef, { reviewsCount: increment(1), updatedAt: review.updatedAt });
      transaction.update(userRef, {
        'stats.reviewsCount': increment(1),
        updatedAt: review.updatedAt
      });
    });
  }

  async updateReview(input: ReviewUpdateInput): Promise<void> {
    await updateDoc(doc(this.#db, REVIEW_COLLECTION, input.reviewId), {
      rating: input.rating,
      title: input.title,
      content: input.content,
      containsSpoilers: input.containsSpoilers,
      updatedAt: input.updatedAt
    });
  }

  async deleteReview(reviewId: string): Promise<void> {
    const reviewRef = doc(this.#db, REVIEW_COLLECTION, reviewId);

    await runTransaction(this.#db, async (transaction) => {
      const snapshot = await transaction.get(reviewRef);
      if (!snapshot.exists()) return;

      const review = snapshot.data() as Review;
      transaction.delete(reviewRef);
      transaction.update(doc(this.#db, BOOK_COLLECTION, review.bookId), {
        reviewsCount: increment(-1)
      });
      transaction.update(doc(this.#db, USER_COLLECTION, review.userId), {
        'stats.reviewsCount': increment(-1)
      });
    });
  }
}
