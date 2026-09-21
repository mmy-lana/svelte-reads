/**
 * Review pipeline.
 *
 * A review is identified by the deterministic `${userId}_${bookId}` id, which
 * makes "one review per reader per book" a property of the data rather than a
 * convention. The store layers optimistic behaviour on top:
 *
 *   - `createReview` inserts the draft into the feed immediately and removes it
 *     again if the write is rejected, so a failed submission never leaves a
 *     phantom review behind;
 *   - it refuses a second review for the same book before any I/O happens
 *     (the Firestore transaction re-checks the same invariant server-side);
 *   - `updateReview`/`deleteReview` snapshot the previous list and restore it
 *     verbatim when the write fails.
 *
 * The helpful vote follows the same contract as the write-side mutations, with
 * one addition: the gateway's atomic transaction returns the committed vote
 * state, so the optimistic count is replaced by the authoritative one instead of
 * being trusted.
 *
 * Review counters on the book and on the reader's profile are maintained by the
 * gateway transaction, so they can never drift from the review documents.
 */
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { retryRead } from '$lib/data/retry';
import {
  FirestoreReviewGateway,
  type ReviewGateway,
  type ReviewUpdateInput
} from '$lib/data/review-gateway';
import {
  DuplicateReviewError,
  MutationInFlightError,
  describeReadFailure,
  describeWriteFailure
} from '$lib/data/errors';
import { normalizeHandle } from '$lib/validation/schemas';
import { authState, type AuthUser } from '$lib/state/auth.svelte';
import type { Book, Review, ReviewDraft, ReviewSortOption } from '$lib/types/domain';

export { DuplicateReviewError };

export interface ReviewStoreOptions {
  gateway?: ReviewGateway;
  currentUser?: () => AuthUser | null;
  /** Display name and avatar used to render the optimistic review. */
  currentProfileSummary?: () => { displayName: string; handle: string; avatarUrl: string } | null;
  now?: () => string;
  pageSize?: number;
}

export const REVIEW_SORT_OPTIONS: readonly { value: ReviewSortOption; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'highest-rated', label: 'Highest rated' },
  { value: 'most-helpful', label: 'Most helpful' }
] as const;

/** Orders reviews in memory; used for optimistic inserts and local re-sorts. */
export function sortReviews(reviews: Review[], sort: ReviewSortOption): Review[] {
  return [...reviews].sort((left, right) => {
    if (sort === 'highest-rated') {
      const byRating = right.rating - left.rating;
      if (byRating !== 0) return byRating;
    } else if (sort === 'most-helpful') {
      const byLikes = right.likesCount - left.likesCount;
      if (byLikes !== 0) return byLikes;
    }

    return right.createdAt.localeCompare(left.createdAt);
  });
}

/** Compound review id shared with `firestore.rules`. */
export function reviewIdFor(userId: string, bookId: string): string {
  return `${userId}_${bookId}`;
}

export class ReviewStore {
  /** Reviews keyed by book id, in the book's current sort order. */
  reviews = new SvelteMap<string, Review[]>();
  /** Sort option per book. */
  sorts = new SvelteMap<string, ReviewSortOption>();
  /** True while a feed page is loading, per book. */
  loading = new SvelteSet<string>();
  /** Book ids with a write in flight. */
  pending = new SvelteSet<string>();
  /** Latest reader-facing failure per book id. */
  failures = new SvelteMap<string, string>();
  /** Whether more feed pages exist, per book. */
  more = new SvelteMap<string, boolean>();
  /**
   * Review ids this session has confirmed the reader voted helpful on.
   *
   * Keyed by review id (not book) because the vote, like the like document
   * itself, belongs to the review.
   */
  votedHelpful = new SvelteSet<string>();
  /** Review ids with a helpful-vote toggle in flight. */
  votingHelpful = new SvelteSet<string>();
  /** Latest helpful-vote failure per review id. */
  voteFailures = new SvelteMap<string, string>();

  /**
   * uid the cached vote state belongs to.
   *
   * A vote is the reader's own row, and this store outlives a session (nothing
   * calls `clear()` on sign-out because review feeds are public data), so the
   * pressed state is only reported while the acting reader is the one who voted.
   * Otherwise a reader who signs in after another would see their own reviews
   * pre-voted — an `aria-pressed` state that is simply not true.
   */
  #votedHelpfulUserId = $state<string | null>(null);

  #gateway: ReviewGateway;
  #currentUser: () => AuthUser | null;
  #profileSummary: () => { displayName: string; handle: string; avatarUrl: string } | null;
  #now: () => string;
  #pageSize: number;
  #cursors = new Map<string, string | null>();

  constructor(options: ReviewStoreOptions = {}) {
    this.#gateway = options.gateway ?? new FirestoreReviewGateway();
    this.#currentUser = options.currentUser ?? (() => authState.user);
    this.#profileSummary =
      options.currentProfileSummary ??
      (() => {
        const profile = authState.profile;
        return profile
          ? { displayName: profile.displayName, handle: profile.handle, avatarUrl: profile.avatarUrl }
          : null;
      });
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#pageSize = options.pageSize ?? 10;
  }

  reviewsFor(bookId: string): Review[] {
    return this.reviews.get(bookId) ?? [];
  }

  sortFor(bookId: string): ReviewSortOption {
    return this.sorts.get(bookId) ?? 'newest';
  }

  isLoading(bookId: string): boolean {
    return this.loading.has(bookId);
  }

  isPending(bookId: string): boolean {
    return this.pending.has(bookId);
  }

  failureFor(bookId: string): string | null {
    return this.failures.get(bookId) ?? null;
  }

  hasMore(bookId: string): boolean {
    return this.more.get(bookId) ?? false;
  }

  /**
   * True once this session has confirmed the reader's helpful vote exists.
   *
   * Reading the acting reader here (rather than only at write time) keeps the
   * pressed state honest across a sign-out/sign-in: a vote cached for another
   * reader reports `false` instead of a borrowed `aria-pressed="true"`.
   */
  hasVotedHelpful(reviewId: string): boolean {
    const user = this.#currentUser();
    if (!user || user.uid !== this.#votedHelpfulUserId) return false;
    return this.votedHelpful.has(reviewId);
  }

  /** True while a helpful vote for this review is still being committed. */
  isVotingHelpful(reviewId: string): boolean {
    return this.votingHelpful.has(reviewId);
  }

  /** Reader-facing reason the last helpful vote on this review was reverted. */
  helpfulVoteFailureFor(reviewId: string): string | null {
    return this.voteFailures.get(reviewId) ?? null;
  }

  /** The signed-in reader's review for a book, if one exists locally. */
  ownReview(bookId: string): Review | null {
    const user = this.#currentUser();
    if (!user) return null;
    const id = reviewIdFor(user.uid, bookId);
    return this.reviewsFor(bookId).find((review) => review.id === id) ?? null;
  }

  hasReviewed(bookId: string): boolean {
    return this.ownReview(bookId) !== null;
  }

  clear(): void {
    this.reviews.clear();
    this.sorts.clear();
    this.loading.clear();
    this.pending.clear();
    this.failures.clear();
    this.more.clear();
    this.votedHelpful.clear();
    this.votingHelpful.clear();
    this.voteFailures.clear();
    this.#votedHelpfulUserId = null;
    this.#cursors = new Map();
  }

  /** Loads (or reloads) the first page of a book's review feed. */
  async loadReviews(
    bookId: string,
    options: { sort?: ReviewSortOption; refresh?: boolean } = {}
  ): Promise<void> {
    const sort = options.sort ?? this.sortFor(bookId);
    const refresh = options.refresh ?? true;
    const cursorId = refresh ? null : (this.#cursors.get(bookId) ?? null);

    this.sorts.set(bookId, sort);
    this.loading.add(bookId);

    try {
      const page = await retryRead(() =>
        this.#gateway.listBookReviews({
          bookId,
          sort,
          pageSize: this.#pageSize,
          cursorId
        })
      );

      this.reviews.set(bookId, sortReviews(page.items, sort));
      this.#cursors.set(bookId, page.nextCursorId);
      this.more.set(bookId, page.hasMore);
      this.failures.delete(bookId);
    } catch (error) {
      this.failures.set(bookId, describeReadFailure(error, 'Reviews could not be loaded.'));
    } finally {
      this.loading.delete(bookId);
    }
  }

  /** Appends the next page of reviews. */
  async loadMoreReviews(bookId: string): Promise<void> {
    const cursor = this.#cursors.get(bookId) ?? null;
    if (!this.hasMore(bookId) || cursor === null || this.isLoading(bookId)) return;

    const existing = this.reviewsFor(bookId);
    const sort = this.sortFor(bookId);
    this.loading.add(bookId);

    try {
      const page = await retryRead(() =>
        this.#gateway.listBookReviews({
          bookId,
          sort,
          pageSize: this.#pageSize,
          cursorId: cursor
        })
      );

      this.reviews.set(bookId, sortReviews([...existing, ...page.items], sort));
      this.#cursors.set(bookId, page.nextCursorId);
      this.more.set(bookId, page.hasMore);
    } catch (error) {
      this.failures.set(bookId, describeReadFailure(error, 'More reviews could not be loaded.'));
    } finally {
      this.loading.delete(bookId);
    }
  }

  /** Re-sorts the cached feed without another round trip. */
  reorder(bookId: string, sort: ReviewSortOption): void {
    this.sorts.set(bookId, sort);
    this.reviews.set(bookId, sortReviews(this.reviewsFor(bookId), sort));
  }

  /**
   * Publishes a review optimistically.
   *
   * Duplicate detection happens twice: locally (so the UI can respond without a
   * round trip) and inside the Firestore transaction (so concurrent submissions
   * cannot both succeed).
   */
  async createReview(book: Book, draft: ReviewDraft): Promise<Review> {
    const user = this.#requireUser('write a review');
    const id = reviewIdFor(user.uid, book.id);

    if (this.reviewsFor(book.id).some((review) => review.id === id)) {
      throw new DuplicateReviewError(book.id);
    }

    const summary = this.#profileSummary();
    const timestamp = this.#now();
    const review: Review = {
      id,
      bookId: book.id,
      bookTitle: book.title,
      bookCoverUrl: book.coverUrl,
      userId: user.uid,
      userDisplayName: summary?.displayName ?? (user.displayName || 'Reader'),
      userHandle: summary?.handle ?? normalizeHandle((user.displayName || 'reader').toLowerCase()),
      userAvatarUrl: summary?.avatarUrl ?? user.photoURL,
      rating: draft.rating,
      title: draft.title,
      content: draft.content,
      containsSpoilers: draft.containsSpoilers,
      likesCount: 0,
      commentsCount: 0,
      tags: [],
      createdAt: timestamp,
      updatedAt: timestamp
    };

    const previous = this.reviewsFor(book.id);

    await this.#optimistic(book.id, 'publish this review', {
      optimistic: () => {
        this.reviews.set(book.id, sortReviews([review, ...previous], this.sortFor(book.id)));
      },
      rollback: () => {
        this.reviews.set(book.id, previous);
      },
      commit: () => this.#gateway.createReview(review)
    });

    return review;
  }

  /** Edits an existing review with the same optimistic/rollback contract. */
  async updateReview(bookId: string, reviewId: string, changes: ReviewDraft): Promise<void> {
    this.#requireUser('edit your review');

    const previous = this.reviewsFor(bookId);
    const existing = previous.find((review) => review.id === reviewId);
    if (!existing) return;

    const timestamp = this.#now();
    const updated: Review = { ...existing, ...changes, updatedAt: timestamp };

    const input: ReviewUpdateInput = {
      reviewId,
      rating: changes.rating,
      title: changes.title,
      content: changes.content,
      containsSpoilers: changes.containsSpoilers,
      updatedAt: timestamp
    };

    await this.#optimistic(bookId, 'edit this review', {
      optimistic: () => {
        this.reviews.set(
          bookId,
          sortReviews(
            previous.map((review) => (review.id === reviewId ? updated : review)),
            this.sortFor(bookId)
          )
        );
      },
      rollback: () => {
        this.reviews.set(bookId, previous);
      },
      commit: () => this.#gateway.updateReview(input)
    });
  }

  /**
   * Toggles the reader's helpful vote on one review.
   *
   * `bookId` leads the argument list for the same reason it does on
   * `updateReview` and `deleteReview`: the feed is cached per book, and the
   * optimistic edit has to reach the right list without scanning every cached
   * book for the review id.
   *
   * The write itself is atomic in the gateway — the `/reviewLikes` row and the
   * single-step `likesCount` change share one transaction, which is what the
   * Phase 1 rule requires. What this method adds is the optimistic layer:
   *
   *   - the count steps immediately and the button renders pressed, so the
   *     control answers a tap without waiting for the round trip;
   *   - the transaction's committed result then *replaces* that guess, so the
   *     counter can never drift from the server even if the guess was wrong;
   *   - a rejection restores the previous list verbatim and records why.
   *
   * The guess is always an upvote, because nothing hydrates `/reviewLikes` for
   * a feed: the reader's prior state is unknown until the transaction answers.
   * The visible cost is a brief upvote on the first click against a review the
   * reader had already voted on; the alternative — delaying the count until the
   * server replies — would leave the button feeling dead on a slow connection.
   *
   * `likesCount` is deliberately *not* re-sorted here. A successful vote must not
   * make the list jump under the reader's finger while the "most helpful" order
   * is active; the next feed load or explicit re-sort picks up the new order.
   */
  async toggleHelpfulVote(bookId: string, reviewId: string): Promise<void> {
    this.#requireUser('vote a review helpful');

    // A second tap while the first is still committing is dropped rather than
    // queued: two overlapping toggles would race the same counter, and the
    // button advertises the in-flight state through `isVotingHelpful`.
    if (this.votingHelpful.has(reviewId)) return;

    const previous = this.reviewsFor(bookId);
    const existing = previous.find((review) => review.id === reviewId);
    if (!existing) return;

    const wasVoted = this.votedHelpful.has(reviewId);

    this.votingHelpful.add(reviewId);
    this.voteFailures.delete(reviewId);
    this.#applyHelpfulVote(bookId, reviewId, {
      likesCount: existing.likesCount + 1,
      voted: true
    });

    try {
      const result = await this.#gateway.toggleHelpfulVote(reviewId);
      this.#applyHelpfulVote(bookId, reviewId, result);
    } catch (error) {
      this.reviews.set(bookId, previous);
      this.#setVotedHelpful(reviewId, wasVoted);
      this.voteFailures.set(
        reviewId,
        describeWriteFailure(error, 'That helpful vote could not be saved, so it was reverted.')
      );
      throw error;
    } finally {
      this.votingHelpful.delete(reviewId);
    }
  }

  /** Writes one review's vote state into the cached feed and the voted set. */
  #applyHelpfulVote(
    bookId: string,
    reviewId: string,
    next: { likesCount: number; voted: boolean }
  ): void {
    const likesCount = Math.max(next.likesCount, 0);

    this.reviews.set(
      bookId,
      this.reviewsFor(bookId).map((review) =>
        review.id === reviewId ? { ...review, likesCount } : review
      )
    );
    this.#setVotedHelpful(reviewId, next.voted);
  }

  #setVotedHelpful(reviewId: string, voted: boolean): void {
    // The whole set is stamped with the reader who produced it: a later session
    // reading this store must not inherit the previous reader's votes.
    this.#votedHelpfulUserId = this.#currentUser()?.uid ?? null;

    if (voted) this.votedHelpful.add(reviewId);
    else this.votedHelpful.delete(reviewId);
  }

  /** Deletes a review, restoring the list if the delete is rejected. */
  async deleteReview(bookId: string, reviewId: string): Promise<void> {
    this.#requireUser('delete your review');

    const previous = this.reviewsFor(bookId);

    await this.#optimistic(bookId, 'delete this review', {
      optimistic: () => {
        this.reviews.set(
          bookId,
          previous.filter((review) => review.id !== reviewId)
        );
      },
      rollback: () => {
        this.reviews.set(bookId, previous);
      },
      commit: () => this.#gateway.deleteReview(reviewId)
    });
  }

  async #optimistic(
    bookId: string,
    subject: string,
    plan: { optimistic: () => void; rollback: () => void; commit: () => Promise<void> }
  ): Promise<void> {
    if (this.pending.has(bookId)) throw new MutationInFlightError(subject);

    this.pending.add(bookId);
    this.failures.delete(bookId);

    plan.optimistic();

    try {
      await plan.commit();
    } catch (error) {
      plan.rollback();
      this.failures.set(bookId, describeWriteFailure(error, 'That review change was reverted.'));
      throw error;
    } finally {
      this.pending.delete(bookId);
    }
  }

  #requireUser(action: string): AuthUser {
    const user = this.#currentUser();
    if (!user) throw new Error(`Sign in to ${action}.`);
    return user;
  }
}

/** Factory used by tests; the app imports the singleton below. */
export function createReviewStore(options: ReviewStoreOptions = {}): ReviewStore {
  return new ReviewStore(options);
}

export const reviewStore = createReviewStore();
