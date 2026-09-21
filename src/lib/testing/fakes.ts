/**
 * Fake gateways for the state-layer suites.
 *
 * They exist to make failure observable and controllable: a write can be held
 * open (to assert the optimistic state before it settles) and then rejected with
 * any Firestore error code, including the offline `unavailable` code the Phase 4
 * acceptance test simulates.
 */
import { applyRatingMutation } from '$lib/utils/ratings';
import type {
  CatalogGateway,
  CatalogQuery
} from '$lib/data/catalog-gateway';
import type {
  RatingCommitInput,
  RatingCommitResult,
  ShelfGateway,
  ShelfListQuery
} from '$lib/data/shelf-gateway';
import type {
  HelpfulVoteResult,
  ReviewGateway,
  ReviewListQuery,
  ReviewUpdateInput
} from '$lib/data/review-gateway';
import { DuplicateReviewError } from '$lib/data/errors';
import type { Book, CursorPage, Review, UserBookShelf } from '$lib/types/domain';
import { makeBook } from '$lib/testing/fixtures';

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

export function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Error shaped like a Firestore failure, including the offline code. */
export function firestoreError(code: string, message = 'simulated failure'): Error {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

export class FakeShelfGateway implements ShelfGateway {
  writes: UserBookShelf[] = [];
  deletions: Array<{ userId: string; bookId: string }> = [];
  ratingCommits: RatingCommitInput[] = [];
  listQueries: ShelfListQuery[] = [];
  pages: CursorPage<UserBookShelf>[] = [];

  /** When set, the next commit rejects with this error. */
  failNext: unknown = null;
  /** When set, the next commit waits for `hold`. */
  hold: Deferred<void> | null = null;
  /** Aggregates returned by `commitRating`; defaults to a local calculation. */
  authoritativeAggregates: ((input: RatingCommitInput) => RatingCommitResult['aggregates']) | null =
    null;

  async listShelves(input: ShelfListQuery): Promise<CursorPage<UserBookShelf>> {
    this.listQueries.push(input);
    // Pages are consumed in call order, which is how a real cursor behaves.
    const index = Math.min(this.listQueries.length - 1, Math.max(this.pages.length - 1, 0));
    return this.pages[index] ?? { items: [], nextCursorId: null, hasMore: false };
  }

  async writeShelf(record: UserBookShelf): Promise<void> {
    if (this.hold) await this.hold.promise;
    if (this.failNext) throw this.failNext;
    this.writes.push(record);
  }

  async deleteShelf(userId: string, bookId: string): Promise<void> {
    if (this.hold) await this.hold.promise;
    if (this.failNext) throw this.failNext;
    this.deletions.push({ userId, bookId });
  }

  async commitRating(input: RatingCommitInput): Promise<RatingCommitResult> {
    if (this.hold) await this.hold.promise;
    if (this.failNext) throw this.failNext;
    this.ratingCommits.push(input);

    const aggregates = this.authoritativeAggregates
      ? this.authoritativeAggregates(input)
      : applyRatingMutation(
          {
            ratingDistribution: { 1: 4, 2: 9, 3: 42, 4: 180, 5: 265 },
            averageRating: 4.36,
            ratingsCount: 500,
            bayesianRating: 4.31
          },
          input.previousRating,
          input.newRating
        );

    return { aggregates, reviewRatingSynced: false };
  }
}

export class FakeCatalogGateway implements CatalogGateway {
  /** Server pages, consumed in order; the last one is reused when exhausted. */
  pages: CursorPage<Book>[] = [];
  queries: CatalogQuery[] = [];
  failure: unknown = null;

  async listBooks(input: CatalogQuery): Promise<CursorPage<Book>> {
    this.queries.push(input);
    if (this.failure) throw this.failure;
    const index = Math.min(this.queries.length - 1, Math.max(this.pages.length - 1, 0));
    return this.pages[index] ?? emptyBookPage();
  }

  async getBook(bookId: string): Promise<Book | null> {
    for (const page of this.pages) {
      const match = page.items.find((book) => book.id === bookId);
      if (match) return match;
    }
    return null;
  }

  async listGenres(): Promise<string[]> {
    const genres = new Set<string>();
    for (const page of this.pages) {
      for (const book of page.items) for (const genre of book.genres) genres.add(genre);
    }
    return [...genres];
  }
}

function emptyBookPage(): CursorPage<Book> {
  return { items: [makeBook()].slice(1), nextCursorId: null, hasMore: false };
}

export class FakeReviewGateway implements ReviewGateway {
  created: Review[] = [];
  updated: ReviewUpdateInput[] = [];
  deleted: string[] = [];
  listQueries: ReviewListQuery[] = [];
  pages: CursorPage<Review>[] = [];

  /**
   * Review ids the fake reader has voted helpful on.
   *
   * Seeded by a test to describe a reader who already voted; the toggle flips it,
   * which is what makes the "authoritative state replaces the optimistic guess"
   * path observable.
   */
  votes = new Set<string>();
  /**
   * Authoritative `likesCount` per review id.
   *
   * A test seeds this alongside `votes` so the value the fake commits matches the
   * stored review; an unseeded review starts from zero, exactly as a freshly
   * created review document does.
   */
  voteCounts = new Map<string, number>();
  /** Review ids passed to `toggleHelpfulVote`, in call order. */
  voteToggles: string[] = [];

  failNext: unknown = null;
  /** When set, every feed read rejects with this error. */
  listFailure: unknown = null;
  hold: Deferred<void> | null = null;

  async listBookReviews(input: ReviewListQuery): Promise<CursorPage<Review>> {
    this.listQueries.push(input);
    if (this.listFailure) throw this.listFailure;
    const index = Math.min(this.listQueries.length - 1, Math.max(this.pages.length - 1, 0));
    return this.pages[index] ?? { items: [], nextCursorId: null, hasMore: false };
  }

  async createReview(review: Review): Promise<void> {
    if (this.hold) await this.hold.promise;
    if (this.failNext) throw this.failNext;
    if (this.created.some((existing) => existing.id === review.id)) {
      throw new DuplicateReviewError(review.bookId);
    }
    this.created.push(review);
  }

  async updateReview(input: ReviewUpdateInput): Promise<void> {
    if (this.hold) await this.hold.promise;
    if (this.failNext) throw this.failNext;
    this.updated.push(input);
  }

  async deleteReview(reviewId: string): Promise<void> {
    if (this.hold) await this.hold.promise;
    if (this.failNext) throw this.failNext;
    this.deleted.push(reviewId);
  }

  async getReview(reviewId: string): Promise<Review | null> {
    return this.created.find((review) => review.id === reviewId) ?? null;
  }

  /**
   * Mirrors the real transaction: it decides from its own stored like row, not
   * from an argument, and answers with the committed state. A seeded `votes` entry
   * therefore produces an *unvote*, which is how the store's optimistic upvote
   * guess is shown to be reconciled.
   */
  async toggleHelpfulVote(reviewId: string): Promise<HelpfulVoteResult> {
    if (this.hold) await this.hold.promise;
    if (this.failNext) throw this.failNext;

    this.voteToggles.push(reviewId);

    const stored = this.voteCounts.get(reviewId) ?? 0;
    const voted = !this.votes.has(reviewId);

    if (voted) this.votes.add(reviewId);
    else this.votes.delete(reviewId);

    const likesCount = Math.max(voted ? stored + 1 : stored - 1, 0);
    this.voteCounts.set(reviewId, likesCount);

    return { voted, likesCount };
  }
}
