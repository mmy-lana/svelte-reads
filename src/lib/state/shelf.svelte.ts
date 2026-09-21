/**
 * Shelf and rating state with optimistic writes.
 *
 * Every mutation follows the same contract:
 *   1. the local record is updated immediately, so the UI never waits on I/O;
 *   2. the write is committed (rating changes run inside a Firestore
 *      transaction that recomputes the community aggregates);
 *   3. if the write fails — offline, permission denied, or a rejected
 *      transaction — the previous record is restored exactly and the failure is
 *      published as reader-facing copy.
 *
 * The gateway is injectable, which is what lets the offline path be unit tested
 * deterministically instead of being hoped for.
 */
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { applyRatingMutation, calculateBayesianRating } from '$lib/utils/ratings';
import {
  createShelfRecord,
  setShelfStatus as applyShelfStatus,
  transitionShelfState,
  type ShelfClock
} from '$lib/utils/shelf-state-machine';
import { validateProgress, validateRating } from '$lib/validation/schemas';
import {
  MutationInFlightError,
  WriteRejectedError,
  describeReadFailure,
  describeWriteFailure
} from '$lib/data/errors';
import { retryRead } from '$lib/data/retry';
import {
  DEFAULT_SHELF_PAGE_SIZE,
  FirestoreShelfGateway,
  shelfIdFor,
  type ShelfGateway
} from '$lib/data/shelf-gateway';
import { authState, type AuthUser } from '$lib/state/auth.svelte';
import type {
  Book,
  BookRatingAggregates,
  ShelfBookSnapshot,
  ShelfStatus,
  ShelfTabValue,
  UserBookShelf
} from '$lib/types/domain';

export type ShelfCounts = Record<ShelfTabValue, number>;

export interface ShelfStoreOptions {
  gateway?: ShelfGateway;
  /** Resolves the signed-in reader; injectable so tests need no Firebase app. */
  currentUser?: () => AuthUser | null;
  now?: () => string;
  pageSize?: number;
}

/** Projects the fields the shelf row denormalises from the catalog document. */
function toSnapshot(book: Book): ShelfBookSnapshot {
  return {
    id: book.id,
    title: book.title,
    authors: book.authors,
    coverUrl: book.coverUrl,
    pageCount: book.pageCount
  };
}

function aggregatesOf(book: Book): BookRatingAggregates {
  return {
    ratingDistribution: book.ratingDistribution,
    averageRating: book.averageRating,
    ratingsCount: book.ratingsCount,
    bayesianRating: book.bayesianRating
  };
}

function emptyCounts(): ShelfCounts {
  return {
    all: 0,
    'want-to-read': 0,
    'currently-reading': 0,
    read: 0,
    'did-not-finish': 0
  };
}

export class ShelfStore {
  /** Shelf rows keyed by book id, so components look one up in O(1). */
  shelves = new SvelteMap<string, UserBookShelf>();
  /** Community aggregates updated by this reader's rating mutations. */
  aggregates = new SvelteMap<string, BookRatingAggregates>();
  /** Book ids with a write in flight. */
  pending = new SvelteSet<string>();
  /** Latest reader-facing failure per book id, cleared by the next attempt. */
  failures = new SvelteMap<string, string>();

  isLoading = $state(false);
  hasMore = $state(false);
  error = $state<string | null>(null);

  #gateway: ShelfGateway;
  #currentUser: () => AuthUser | null;
  #clock: ShelfClock;
  #pageSize: number;
  #cursor: string | null = null;

  constructor(options: ShelfStoreOptions = {}) {
    this.#gateway = options.gateway ?? new FirestoreShelfGateway();
    this.#currentUser = options.currentUser ?? (() => authState.user);
    this.#clock = { now: options.now ?? (() => new Date().toISOString()) };
    this.#pageSize = options.pageSize ?? DEFAULT_SHELF_PAGE_SIZE;
  }

  /** Rows per shelf tab, used by the dashboard counters. */
  counts = $derived.by<ShelfCounts>(() => {
    const counts = emptyCounts();
    for (const record of this.shelves.values()) {
      counts.all += 1;
      counts[record.status] += 1;
    }
    return counts;
  });

  /** Every loaded shelf row, most recently updated first. */
  list = $derived(
    [...this.shelves.values()].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt)
    )
  );

  shelfFor(bookId: string): UserBookShelf | undefined {
    return this.shelves.get(bookId);
  }

  statusFor(bookId: string): ShelfStatus | null {
    return this.shelves.get(bookId)?.status ?? null;
  }

  isPending(bookId: string): boolean {
    return this.pending.has(bookId);
  }

  failureFor(bookId: string): string | null {
    return this.failures.get(bookId) ?? null;
  }

  /** Aggregates for a book, preferring this session's optimistic values. */
  aggregatesFor(book: Book): BookRatingAggregates {
    return this.aggregates.get(book.id) ?? aggregatesOf(book);
  }

  /** Seeds the aggregate cache from a catalog page without any write. */
  primeAggregates(book: Book): void {
    if (!this.aggregates.has(book.id)) {
      this.aggregates.set(book.id, aggregatesOf(book));
    }
  }

  /** Releases every cached row; called when the session ends. */
  clear(): void {
    this.shelves.clear();
    this.aggregates.clear();
    this.pending.clear();
    this.failures.clear();
    this.#cursor = null;
    this.hasMore = false;
    this.error = null;
  }

  /** Loads the first page of shelf rows, or refreshes them in place. */
  async loadShelves(options: { refresh?: boolean } = {}): Promise<void> {
    const user = this.#currentUser();
    if (!user) {
      this.clear();
      return;
    }

    const previousCursor = options.refresh ? null : this.#cursor;
    this.isLoading = true;
    this.error = null;

    try {
      const page = await retryRead(() =>
        this.#gateway.listShelves({
          userId: user.uid,
          pageSize: this.#pageSize,
          cursorId: previousCursor
        })
      );

      if (options.refresh || previousCursor === null) this.shelves.clear();
      for (const record of page.items) this.shelves.set(record.bookId, record);

      this.#cursor = page.nextCursorId;
      this.hasMore = page.hasMore;
    } catch (error) {
      this.error = describeReadFailure(error, 'We could not load your shelves.');
    } finally {
      this.isLoading = false;
    }
  }

  /** Fetches the next page using the cursor returned by the previous one. */
  async loadMore(): Promise<void> {
    if (!this.hasMore || this.isLoading || this.#cursor === null) return;
    await this.loadShelves();
  }

  /** Moves a book onto a shelf, creating the row on first shelving. */
  async setStatus(book: Book, status: ShelfStatus): Promise<UserBookShelf> {
    const user = this.#requireUser('shelve books');
    const existing = this.shelves.get(book.id);
    const next = applyShelfStatus(existing, {
      userId: user.uid,
      book: toSnapshot(book),
      status,
      clock: this.#clock
    });

    await this.#optimistic(book.id, 'move this book between shelves', {
      optimistic: () => {
        this.shelves.set(book.id, next);
      },
      rollback: () => {
        this.#restore(book.id, existing);
      },
      commit: () => this.#gateway.writeShelf(next)
    });

    return next;
  }

  /**
   * Records reading progress. Reaching the final page transitions the row to
   * `read` — timestamps included — inside the same write.
   */
  async updateProgress(book: Book, pages: number): Promise<UserBookShelf> {
    const user = this.#requireUser('track your reading');
    const validation = validateProgress(pages, book.pageCount);

    if (!validation.valid) {
      throw new WriteRejectedError(
        `Enter a page between 0 and ${book.pageCount}.`,
        'progress/out-of-range'
      );
    }

    const existing = this.shelves.get(book.id);
    const base =
      existing ??
      createShelfRecord({
        userId: user.uid,
        book: toSnapshot(book),
        status: 'currently-reading',
        clock: this.#clock
      });

    const pagesRead = Math.min(Math.max(Math.trunc(pages), 0), book.pageCount);
    const next = transitionShelfState(
      base,
      { type: 'UPDATE_PROGRESS', pagesRead },
      this.#clock
    );

    await this.#optimistic(book.id, 'save your reading progress', {
      optimistic: () => {
        this.shelves.set(book.id, next);
      },
      rollback: () => {
        this.#restore(book.id, existing);
      },
      commit: () => this.#gateway.writeShelf(next)
    });

    return next;
  }

  /**
   * Applies a rating optimistically, then persists it through the transaction
   * that recomputes the community histogram, average, and Bayesian score.
   */
  async submitRating(book: Book, rating: number): Promise<BookRatingAggregates> {
    const user = this.#requireUser('rate books');

    if (!validateRating(rating)) {
      throw new WriteRejectedError(
        'Ratings run from 0.5 to 5 stars in half-star steps.',
        'ratings/invalid-value'
      );
    }

    const existing = this.shelves.get(book.id);
    const previousRating = existing && existing.rating > 0 ? existing.rating : null;
    const currentAggregates = this.aggregates.get(book.id) ?? aggregatesOf(book);
    const optimisticAggregates = applyRatingMutation(currentAggregates, previousRating, rating);

    const base =
      existing ??
      createShelfRecord({
        userId: user.uid,
        book: toSnapshot(book),
        status: 'read',
        clock: this.#clock
      });

    const next: UserBookShelf = { ...base, rating, updatedAt: this.#clock.now() };
    let committed: BookRatingAggregates | null = null;

    await this.#optimistic(book.id, 'save your rating', {
      optimistic: () => {
        this.shelves.set(book.id, next);
        this.aggregates.set(book.id, optimisticAggregates);
      },
      rollback: () => {
        this.#restore(book.id, existing);
        this.aggregates.set(book.id, currentAggregates);
      },
      commit: async () => {
        const result = await this.#gateway.commitRating({
          record: next,
          previousRating,
          newRating: rating
        });
        committed = result.aggregates;
      }
    });

    // The transaction returns the authoritative figures; recompute defensively
    // only if a gateway resolves without them.
    const authoritative: BookRatingAggregates =
      committed ?? {
        ...optimisticAggregates,
        bayesianRating: calculateBayesianRating(
          optimisticAggregates.ratingsCount,
          optimisticAggregates.averageRating
        )
      };

    this.aggregates.set(book.id, authoritative);
    return authoritative;
  }

  /** Removes a book from the reader's shelves. */
  async remove(book: Book): Promise<void> {
    const user = this.#requireUser('change your shelves');
    const existing = this.shelves.get(book.id);
    if (!existing) return;

    await this.#optimistic(book.id, 'remove this book from your shelves', {
      optimistic: () => {
        this.shelves.delete(book.id);
      },
      rollback: () => {
        this.shelves.set(book.id, existing);
      },
      commit: () => this.#gateway.deleteShelf(user.uid, book.id)
    });
  }

  /** Identifier shared with the security rules; exposed for optimistic updates. */
  shelfIdFor(bookId: string): string | null {
    const user = this.#currentUser();
    return user ? shelfIdFor(user.uid, bookId) : null;
  }

  async #optimistic(
    bookId: string,
    subject: string,
    plan: {
      optimistic: () => void;
      rollback: () => void;
      commit: () => Promise<void>;
    }
  ): Promise<void> {
    if (this.pending.has(bookId)) throw new MutationInFlightError(subject);

    this.pending.add(bookId);
    this.failures.delete(bookId);

    // Applied before the first await, so the UI updates in the same tick.
    plan.optimistic();

    try {
      await plan.commit();
    } catch (error) {
      plan.rollback();
      this.failures.set(bookId, describeWriteFailure(error, 'That change could not be saved.'));
      throw error;
    } finally {
      this.pending.delete(bookId);
    }
  }

  #restore(bookId: string, previous: UserBookShelf | undefined): void {
    if (previous) this.shelves.set(bookId, previous);
    else this.shelves.delete(bookId);
  }

  #requireUser(action: string): AuthUser {
    const user = this.#currentUser();
    if (!user) throw new WriteRejectedError(`Sign in to ${action}.`, 'auth/required');
    return user;
  }
}

/** Factory used by tests; the app imports the singleton below. */
export function createShelfStore(options: ShelfStoreOptions = {}): ShelfStore {
  return new ShelfStore(options);
}

export const shelfStore = createShelfStore();
