/**
 * Review persistence.
 *
 * One review per reader per book is a data invariant, not a UI convention: the
 * deterministic `${userId}_${bookId}` document id makes duplicates impossible,
 * and the write transaction re-checks existence so two racing submissions can
 * never both succeed. The same transaction maintains the denormalised review
 * counter on the book (`reviewsCount`).
 *
 * Deleting a review is a cascading delete: the likes that point at it and the
 * `comments` subcollection beneath it are retired in the *same* transaction as
 * the review document itself, so a feed can never render orphaned engagement
 * against a review that no longer exists.
 *
 * Engagement the reader controls is atomic for the same reason. A helpful vote
 * writes the caller's `/reviewLikes` row and steps `likesCount` together, which
 * is the only shape the Phase 1 rules accept.
 *
 * Profile statistics are deliberately *not* written here. SEC-02 locks
 * `users/{uid}.stats` to trusted backends, so a client transaction cannot touch
 * `stats.reviewsCount`; that counter is owned by the server-side stats sync and
 * the reader's own profile writes stay inside the profile allowlist.
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
  type DocumentReference,
  type Firestore,
  type QueryConstraint,
  type QueryDocumentSnapshot
} from 'firebase/firestore';
import { db as firebaseDb, auth } from '$lib/firebase/client';
import { parseReview } from '$lib/validation/schemas';
import { DataIntegrityError, DuplicateReviewError, WriteRejectedError } from '$lib/data/errors';
import { BOOK_COLLECTION, REVIEW_COLLECTION } from '$lib/data/shelf-gateway';
import type { CursorPage, Review, ReviewLike, ReviewSortOption } from '$lib/types/domain';

export const DEFAULT_REVIEW_PAGE_SIZE = 10;

/** Likes collection that mirrors `reviews/{reviewId}` engagement. */
export const REVIEW_LIKE_COLLECTION = 'reviewLikes';
/** Comments subcollection beneath each review document. */
export const REVIEW_COMMENT_COLLECTION = 'comments';

/**
 * Compound like id shared with `firestore.rules`: `${reviewId}_${userId}`.
 *
 * The rule for `/reviewLikes/{likeId}` asserts exactly this shape, so the id is
 * derived here rather than assembled at each call site.
 */
export function likeIdFor(reviewId: string, userId: string): string {
  return `${reviewId}_${userId}`;
}

/** Outcome of a helpful-vote toggle, as committed by the transaction. */
export interface HelpfulVoteResult {
  /** True when the acting reader's own `/reviewLikes` row exists after the commit. */
  voted: boolean;
  /** Authoritative `likesCount` on `reviews/{reviewId}` after the commit. */
  likesCount: number;
}

/**
 * Maximum dependent documents retired in a single delete call.
 *
 * The modular `Transaction.get` accepts a single `DocumentReference` rather than
 * a query, so dependents are discovered with a bounded query and then handed to
 * the transaction as references; Firestore's 500-write ceiling is the other
 * bound. A review with more engagement than this is deleted together with its
 * first chunk, and the remainder is swept by the follow-up pass described in
 * `deleteReview`.
 */
const CASCADE_CHUNK_SIZE = 200;

/**
 * Upper bound on cascade passes in `deleteReview`.
 *
 * Each pass retires one full chunk of dependents, so this bounds how much
 * engagement a single delete will sweep (chunk size × passes). It also stops the
 * loop if a pathological stream of new engagement keeps refilling the chunk.
 */
const CASCADE_SWEEP_PASSES = 8;

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
  /**
   * Removes a review together with everything that points at it — its likes and
   * its `comments` subcollection — and decrements the book's `reviewsCount` by
   * one. A review that is already gone is a no-op; a caller who is not the
   * author is rejected with `WriteRejectedError`.
   */
  deleteReview(reviewId: string): Promise<void>;
  getReview(reviewId: string): Promise<Review | null>;
  /**
   * Toggles the acting reader's helpful vote on a review, creating or deleting
   * their own `/reviewLikes` row and stepping `reviews/{reviewId}.likesCount` by
   * exactly one inside a single transaction. Resolves with the committed state so
   * the caller can replace its optimistic guess with the authoritative values.
   */
  toggleHelpfulVote(reviewId: string): Promise<HelpfulVoteResult>;
}

/**
 * Discovers every dependent document of a review: the likes that point at it
 * through their `reviewId` field, and the documents in its `comments`
 * subcollection. Returns document references ready for a transaction.
 */
async function collectDependentReferences(
  db: Firestore,
  reviewId: string
): Promise<DocumentReference[]> {
  const [likes, comments] = await Promise.all([
    getDocs(
      buildQuery(
        collection(db, REVIEW_LIKE_COLLECTION),
        where('reviewId', '==', reviewId),
        limitTo(CASCADE_CHUNK_SIZE)
      )
    ),
    getDocs(
      buildQuery(
        collection(db, REVIEW_COLLECTION, reviewId, REVIEW_COMMENT_COLLECTION),
        limitTo(CASCADE_CHUNK_SIZE)
      )
    )
  ]);

  return [...likes.docs, ...comments.docs].map((snapshot) => snapshot.ref);
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
  /** Resolves the acting reader's uid for ownership assertions. */
  #currentUserId: () => string | null;
  /** Timestamp source for like rows, injectable for deterministic tests. */
  #now: () => string;

  constructor(
    options: {
      firestore?: Firestore;
      currentUserId?: () => string | null;
      now?: () => string;
    } = {}
  ) {
    this.#db = options.firestore ?? firebaseDb;
    this.#currentUserId = options.currentUserId ?? (() => auth.currentUser?.uid ?? null);
    this.#now = options.now ?? (() => new Date().toISOString());
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

    await runTransaction(this.#db, async (transaction) => {
      const existing = await transaction.get(reviewRef);
      if (existing.exists()) throw new DuplicateReviewError(review.bookId);

      transaction.set(reviewRef, review);
      transaction.update(bookRef, { reviewsCount: increment(1), updatedAt: review.updatedAt });
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

  /**
   * Creates or retires the reader's helpful vote, atomically.
   *
   * The Phase 1 security rule authorises a `likesCount` step only when the
   * acting reader's own `/reviewLikes/{reviewId}_{uid}` row appears (for `+1`)
   * or disappears (for `-1`) *in the same commit*: the rule resolves `exists()`
   * against the post-commit state, so two sequential writes can never satisfy it
   * — the counter write arrives before the like row and is denied. Both writes
   * therefore share one transaction.
   *
   * The counter is read inside the transaction and written back as a literal
   * rather than a `FieldValue.increment`, which keeps the value the rule compares
   * against `resource.data.likesCount` unambiguous, and turns the read into
   * conflict detection: a concurrent vote from another tab retries against the
   * new base instead of both callers stepping the same stale number.
   *
   * Whether the caller had already voted is answered by the like document, not
   * by the caller. The feeds never hydrate `/reviewLikes`, so a client's memory
   * of "did I vote?" is only a hint and the transaction is the authority.
   */
  async toggleHelpfulVote(reviewId: string): Promise<HelpfulVoteResult> {
    const userId = this.#currentUserId();
    if (userId === null) {
      throw new WriteRejectedError('Sign in to vote a review helpful.', 'reviewLikes/signed-out');
    }

    const reviewRef = doc(this.#db, REVIEW_COLLECTION, reviewId);
    const likeRef = doc(this.#db, REVIEW_LIKE_COLLECTION, likeIdFor(reviewId, userId));

    return runTransaction(this.#db, async (transaction) => {
      // The review is read first: its absence means the vote has nowhere to
      // land, and the rule would deny the like row anyway (DATA-01).
      const reviewSnapshot = await transaction.get(reviewRef);
      if (!reviewSnapshot.exists()) {
        throw new WriteRejectedError(
          'That review is no longer available to vote on.',
          'reviews/not-found'
        );
      }

      const likeSnapshot = await transaction.get(likeRef);
      const storedLikes = reviewSnapshot.data()?.likesCount;
      const likesCount = typeof storedLikes === 'number' ? storedLikes : 0;

      if (likeSnapshot.exists()) {
        transaction.delete(likeRef);
        // A counter that is already zero is left untouched: the row still goes,
        // but a `0 -> 0` write is neither a `+1` nor a `-1` step, and the rule
        // would reject it as an arbitrary change.
        if (likesCount <= 0) return { voted: false, likesCount: 0 };

        transaction.update(reviewRef, { likesCount: likesCount - 1 });
        return { voted: false, likesCount: likesCount - 1 };
      }

      const like: ReviewLike = {
        id: likeRef.id,
        reviewId,
        userId,
        createdAt: this.#now()
      };

      transaction.set(likeRef, like);
      transaction.update(reviewRef, { likesCount: likesCount + 1 });
      return { voted: true, likesCount: likesCount + 1 };
    });
  }

  /**
   * Cascading delete: the review, every like that points at it, and every
   * document in its `comments` subcollection are retired together.
   *
   * Dependents are read before the transaction because the modular SDK cannot
   * read a query inside one, so the passes sweep: each one removes what it read
   * and re-reads, and the review document is removed only by the pass that finds
   * a short chunk.
   *
   * The ordering is load-bearing. The security rules authorise deleting a
   * comment or a like either as its own author or as the parent review's author,
   * and that parent lookup returns nothing once the review is gone — so removing
   * the review first would make every dependent discovered afterwards
   * permanently undeletable. The review is therefore the last document to go.
   *
   * The residual window is a dependent written between a final read and the
   * commit. Such a row is unreachable in practice (nothing loads engagement for a
   * review that no longer exists) and the rules independently block creating new
   * ones against a deleted review, so no live surface can observe it.
   *
   * If the review is already gone the call is a no-op, matching the previous
   * behaviour that deleting an absent review never throws.
   *
   * Ownership is asserted before any write so a non-author gets a typed,
   * renderable rejection instead of a half-executed cascade that Firestore
   * aborts with an opaque permission error.
   */
  async deleteReview(reviewId: string): Promise<void> {
    const reviewRef = doc(this.#db, REVIEW_COLLECTION, reviewId);

    const snapshot = await getDoc(reviewRef);
    if (!snapshot.exists()) return;

    const review = snapshot.data() as Review;
    const actingUserId = this.#currentUserId();
    if (actingUserId === null || review.userId !== actingUserId) {
      throw new WriteRejectedError('Only the author can delete a review.', 'reviews/not-author');
    }

    const bookRef = doc(this.#db, BOOK_COLLECTION, review.bookId);

    for (let pass = 0; pass < CASCADE_SWEEP_PASSES; pass += 1) {
      const dependents = await collectDependentReferences(this.#db, reviewId);
      // A full chunk means more may be waiting, so the review survives another
      // pass; a short chunk is the last one, and the review goes with it.
      const isFinalPass = dependents.length < CASCADE_CHUNK_SIZE;

      await runTransaction(this.#db, async (transaction) => {
        // Firestore transactions require all reads to precede all writes.
        const bookSnapshot = isFinalPass ? await transaction.get(bookRef) : null;

        for (const dependent of dependents) transaction.delete(dependent);

        if (!isFinalPass) return;
        transaction.delete(reviewRef);

        if (bookSnapshot && bookSnapshot.exists()) {
          const currentReviews = bookSnapshot.data()?.reviewsCount;
          const safeReviewsCount =
            typeof currentReviews === 'number' ? Math.max(0, currentReviews - 1) : 0;
          transaction.update(bookRef, { reviewsCount: safeReviewsCount });
        }
      });

      if (isFinalPass) return;
    }
  }
}
