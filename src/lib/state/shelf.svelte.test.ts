import { beforeEach, describe, expect, it } from 'vitest';
import { createShelfStore, type ShelfStore } from '$lib/state/shelf.svelte';
import { MutationInFlightError, WriteRejectedError } from '$lib/data/errors';
import { calculateBayesianRating, totalRatings } from '$lib/utils/ratings';
import { FakeShelfGateway, createDeferred, firestoreError } from '$lib/testing/fakes';
import { FIXED_NOW, makeBook, makeShelfRecord, makeUser } from '$lib/testing/fixtures';

function buildHarness(options: { signedIn?: boolean } = {}): {
  store: ShelfStore;
  gateway: FakeShelfGateway;
} {
  const gateway = new FakeShelfGateway();
  const store = createShelfStore({
    gateway,
    currentUser: () => (options.signedIn === false ? null : makeUser()),
    now: () => FIXED_NOW
  });
  return { store, gateway };
}

describe('ShelfStore optimistic writes', () => {
  let harness: ReturnType<typeof buildHarness>;

  beforeEach(() => {
    harness = buildHarness();
  });

  it('applies a shelf change instantly and keeps it once the write succeeds', async () => {
    const { store, gateway } = harness;
    const book = makeBook();
    gateway.hold = createDeferred<void>();

    const pending = store.setStatus(book, 'read');

    // Before the write settles: the UI already shows the new shelf.
    expect(store.statusFor(book.id)).toBe('read');
    expect(store.isPending(book.id)).toBe(true);
    expect(store.shelfFor(book.id)?.progressPercentage).toBe(100);

    gateway.hold.resolve();
    gateway.hold = null;
    await pending;

    expect(store.isPending(book.id)).toBe(false);
    expect(store.failureFor(book.id)).toBeNull();
    expect(gateway.writes).toHaveLength(1);
    expect(gateway.writes[0]?.status).toBe('read');
    expect(gateway.writes[0]?.id).toBe('reader-1_book-steinbeck');
  });

  it('rolls the shelf back to its previous status when Firestore reports the client is offline', async () => {
    const { store, gateway } = harness;
    const book = makeBook();
    const existing = makeShelfRecord({ status: 'want-to-read' });
    store.shelves.set(book.id, existing);

    gateway.hold = createDeferred<void>();
    const pending = store.setStatus(book, 'read');

    expect(store.statusFor(book.id)).toBe('read');

    gateway.hold.reject(firestoreError('unavailable'));
    gateway.hold = null;

    await expect(pending).rejects.toMatchObject({ code: 'unavailable' });

    expect(store.statusFor(book.id)).toBe('want-to-read');
    expect(store.shelfFor(book.id)).toEqual(existing);
    expect(store.isPending(book.id)).toBe(false);
    expect(store.failureFor(book.id)).toContain('offline');
    expect(gateway.writes).toHaveLength(0);
  });

  it('removes a brand new optimistic row again when the write fails', async () => {
    const { store, gateway } = harness;
    const book = makeBook();
    gateway.failNext = firestoreError('unavailable');

    await expect(store.setStatus(book, 'currently-reading')).rejects.toBeTruthy();

    expect(store.shelfFor(book.id)).toBeUndefined();
    expect(store.counts.all).toBe(0);
    expect(store.failureFor(book.id)).toContain('reverted');
  });

  it('rejects a second concurrent write for the same book', async () => {
    const { store, gateway } = harness;
    const book = makeBook();
    gateway.hold = createDeferred<void>();

    const first = store.setStatus(book, 'read');
    await expect(store.setStatus(book, 'want-to-read')).rejects.toBeInstanceOf(
      MutationInFlightError
    );

    gateway.hold.resolve();
    gateway.hold = null;
    await first;
  });

  it('requires a signed-in reader', async () => {
    const gateway = new FakeShelfGateway();
    const store = createShelfStore({ gateway, currentUser: () => null, now: () => FIXED_NOW });

    await expect(store.setStatus(makeBook(), 'read')).rejects.toBeInstanceOf(WriteRejectedError);
    expect(gateway.writes).toHaveLength(0);
  });
});

describe('ShelfStore reading progress', () => {
  it('transitions to the read shelf when the final page is reached', async () => {
    const { store, gateway } = harnessForProgress();
    const book = makeBook({ pageCount: 601 });

    const record = await store.updateProgress(book, 601);

    expect(record.status).toBe('read');
    expect(record.progressPages).toBe(601);
    expect(record.progressPercentage).toBe(100);
    expect(record.finishedAt).not.toBeNull();
    expect(gateway.writes).toHaveLength(1);
    expect(gateway.writes[0]?.status).toBe('read');
  });

  it('keeps the row on the reading shelf for a partial update', async () => {
    const { store } = harnessForProgress();
    const record = await store.updateProgress(makeBook(), 300);

    expect(record.status).toBe('currently-reading');
    expect(record.progressPercentage).toBe(50);
    expect(record.finishedAt).toBeNull();
  });

  it('rolls the progress back when the write is rejected', async () => {
    const { store, gateway } = harnessForProgress();
    const previous = store.shelfFor('book-steinbeck');
    gateway.failNext = firestoreError('unavailable');

    await expect(store.updateProgress(makeBook(), 601)).rejects.toBeTruthy();

    expect(store.shelfFor('book-steinbeck')).toEqual(previous);
    expect(store.statusFor('book-steinbeck')).toBe('currently-reading');
    expect(store.failureFor('book-steinbeck')).toContain('offline');
  });

  it('refuses a page count beyond the edition before touching Firestore', async () => {
    const { store, gateway } = harnessForProgress();

    await expect(store.updateProgress(makeBook({ pageCount: 200 }), 500)).rejects.toBeInstanceOf(
      WriteRejectedError
    );
    expect(gateway.writes).toHaveLength(0);
  });

  function harnessForProgress(): ReturnType<typeof buildHarness> {
    const scoped = buildHarness();
    scoped.store.shelves.set(
      'book-steinbeck',
      makeShelfRecord({ status: 'currently-reading', progressPages: 120, progressPercentage: 20 })
    );
    return scoped;
  }
});

describe('ShelfStore rating mutations', () => {
  it('updates the aggregates optimistically, including the Bayesian score', async () => {
    const { store, gateway } = buildHarness();
    const book = makeBook();
    const before = store.aggregatesFor(book);
    gateway.hold = createDeferred<void>();

    const pending = store.submitRating(book, 5);

    const optimistic = store.aggregatesFor(book);
    expect(optimistic.ratingsCount).toBe(before.ratingsCount + 1);
    expect(optimistic.ratingDistribution[5]).toBe(before.ratingDistribution[5] + 1);
    expect(optimistic.bayesianRating).toBeGreaterThan(before.bayesianRating);
    expect(optimistic.bayesianRating).toBe(
      calculateBayesianRating(optimistic.ratingsCount, optimistic.averageRating)
    );

    gateway.hold.resolve();
    gateway.hold = null;
    await pending;

    expect(gateway.ratingCommits).toHaveLength(1);
    expect(gateway.ratingCommits[0]?.previousRating).toBeNull();
    expect(gateway.ratingCommits[0]?.newRating).toBe(5);
  });

  it('adopts the authoritative aggregates returned by the transaction', async () => {
    const { store, gateway } = buildHarness();
    const book = makeBook();
    gateway.authoritativeAggregates = () => ({
      ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 12 },
      averageRating: 5,
      ratingsCount: 12,
      bayesianRating: 4.62
    });

    await store.submitRating(book, 5);

    const aggregates = store.aggregatesFor(book);
    expect(aggregates.ratingsCount).toBe(12);
    expect(aggregates.bayesianRating).toBe(4.62);
    expect(totalRatings(aggregates.ratingDistribution)).toBe(12);
  });

  it('rolls back the rating and the aggregates when the transaction aborts', async () => {
    const { store, gateway } = buildHarness();
    const book = makeBook();
    const previousRecord = makeShelfRecord({ rating: 4, status: 'read' });
    store.shelves.set(book.id, previousRecord);
    const before = store.aggregatesFor(book);

    gateway.failNext = firestoreError('aborted');
    await expect(store.submitRating(book, 5)).rejects.toBeTruthy();

    expect(store.shelfFor(book.id)?.rating).toBe(4);
    expect(store.shelfFor(book.id)).toEqual(previousRecord);
    expect(store.aggregatesFor(book)).toEqual(before);
    expect(store.failureFor(book.id)).toContain('still settling');
  });

  it('moves a previous rating rather than adding a second one', async () => {
    const { store, gateway } = buildHarness();
    const book = makeBook();
    store.shelves.set(book.id, makeShelfRecord({ rating: 5, status: 'read' }));

    await store.submitRating(book, 3);

    expect(gateway.ratingCommits[0]?.previousRating).toBe(5);
    expect(store.shelfFor(book.id)?.rating).toBe(3);
  });

  it('rejects a rating outside the half-star contract without writing', async () => {
    const { store, gateway } = buildHarness();

    await expect(store.submitRating(makeBook(), 3.7)).rejects.toBeInstanceOf(WriteRejectedError);
    expect(gateway.ratingCommits).toHaveLength(0);
  });
});

describe('ShelfStore aggregation and browsing', () => {
  it('counts rows per shelf tab', () => {
    const { store } = buildHarness();
    store.shelves.set('a', makeShelfRecord({ bookId: 'a', status: 'read' }));
    store.shelves.set('b', makeShelfRecord({ bookId: 'b', status: 'read' }));
    store.shelves.set('c', makeShelfRecord({ bookId: 'c', status: 'currently-reading' }));
    store.shelves.set('d', makeShelfRecord({ bookId: 'd', status: 'did-not-finish' }));

    expect(store.counts).toMatchObject({
      all: 4,
      read: 2,
      'currently-reading': 1,
      'want-to-read': 0,
      'did-not-finish': 1
    });
  });

  it('loads pages and advances the cursor with loadMore', async () => {
    const { store, gateway } = buildHarness();
    gateway.pages = [
      {
        items: [makeShelfRecord({ bookId: 'a' }), makeShelfRecord({ bookId: 'b' })],
        nextCursorId: 'reader-1_b',
        hasMore: true
      },
      {
        items: [makeShelfRecord({ bookId: 'c' })],
        nextCursorId: null,
        hasMore: false
      }
    ];

    await store.loadShelves();
    expect(store.counts.all).toBe(2);
    expect(store.hasMore).toBe(true);

    await store.loadMore();
    expect(store.counts.all).toBe(3);
    expect(store.hasMore).toBe(false);
    expect(gateway.listQueries[1]?.cursorId).toBe('reader-1_b');
  });

  it('clears cached shelves when the session ends', async () => {
    const { store } = buildHarness();
    store.shelves.set('a', makeShelfRecord({ bookId: 'a' }));
    store.aggregates.set('a', {
      ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 1 },
      averageRating: 5,
      ratingsCount: 1,
      bayesianRating: 3.9
    });

    store.clear();

    expect(store.counts.all).toBe(0);
    expect(store.aggregates.size).toBe(0);
    expect(store.hasMore).toBe(false);
  });
});

// CONC-01: the layout shell and a route both refresh on the same navigation
// cycle, and a refresh must never blank out a row whose write is still running.
describe('ShelfStore loadShelves concurrency (CONC-01)', () => {
  function concurrentHarness(): {
    store: ShelfStore;
    gateway: FakeShelfGateway;
    advance: (ms: number) => void;
  } {
    const gateway = new FakeShelfGateway();
    let clock = 1_000;
    const store = createShelfStore({
      gateway,
      currentUser: () => makeUser(),
      now: () => FIXED_NOW,
      monotonicNow: () => clock
    });
    return { store, gateway, advance: (ms: number) => (clock += ms) };
  }

  it('shares one in-flight refresh between concurrent callers', async () => {
    const { store, gateway } = concurrentHarness();
    gateway.pages = [
      {
        items: [makeShelfRecord({ bookId: 'a' })],
        nextCursorId: null,
        hasMore: false
      }
    ];
    const gate = createDeferred<void>();
    const originalListShelves = gateway.listShelves.bind(gateway);
    gateway.listShelves = async (input) => {
      await gate.promise;
      return originalListShelves(input);
    };

    const first = store.loadShelves({ refresh: true });
    const second = store.loadShelves({ refresh: true });
    const third = store.loadShelves({ refresh: true });

    expect(second).toBe(first);
    expect(third).toBe(first);

    gate.resolve();
    await Promise.all([first, second, third]);

    // Three callers, one query.
    expect(gateway.listQueries).toHaveLength(1);
    expect(store.counts.all).toBe(1);
  });

  it('issues a fresh query once the in-flight refresh has settled', async () => {
    const { store, gateway, advance } = concurrentHarness();
    gateway.pages = [
      { items: [makeShelfRecord({ bookId: 'a' })], nextCursorId: null, hasMore: false }
    ];

    await store.loadShelves({ refresh: true });
    expect(gateway.listQueries).toHaveLength(1);

    // Inside the freshness window a second refresh reuses the completed load,
    // which is what collapses the layout + route double refresh.
    await store.loadShelves({ refresh: true });
    expect(gateway.listQueries).toHaveLength(1);

    // Past the window the reader gets genuinely fresh data again.
    advance(5_000);
    await store.loadShelves({ refresh: true });
    expect(gateway.listQueries).toHaveLength(2);
  });

  it('lets an explicit invalidate force a refetch inside the window', async () => {
    const { store, gateway } = concurrentHarness();
    gateway.pages = [
      { items: [makeShelfRecord({ bookId: 'a' })], nextCursorId: null, hasMore: false }
    ];

    await store.loadShelves({ refresh: true });
    store.invalidate();
    await store.loadShelves({ refresh: true });

    expect(gateway.listQueries).toHaveLength(2);
  });

  it('keeps an in-flight optimistic mutation across a refresh', async () => {
    const { store, gateway } = concurrentHarness();
    const book = makeBook();

    // The reader has an optimistic `read` write in flight...
    const gate = createDeferred<void>();
    gateway.hold = gate;
    const write = store.setStatus(book, 'read');
    expect(store.statusFor(book.id)).toBe('read');
    expect(store.isPending(book.id)).toBe(true);

    // ...and a refresh lands carrying the stale server value.
    gateway.hold = null;
    gateway.pages = [
      {
        items: [makeShelfRecord({ bookId: book.id, status: 'want-to-read' })],
        nextCursorId: null,
        hasMore: false
      }
    ];
    await store.loadShelves({ refresh: true });

    // The optimistic status survives; the refresh did not revert the UI.
    expect(store.statusFor(book.id)).toBe('read');

    gate.resolve();
    await write;
    expect(store.statusFor(book.id)).toBe('read');
    expect(store.isPending(book.id)).toBe(false);
  });

  it('still replaces rows that have no write in flight', async () => {
    const { store, gateway } = concurrentHarness();
    const stale = makeShelfRecord({ bookId: 'a', status: 'want-to-read' });
    store.shelves.set(stale.bookId, stale);

    gateway.pages = [
      {
        items: [makeShelfRecord({ bookId: 'a', status: 'read' })],
        nextCursorId: null,
        hasMore: false
      }
    ];
    await store.loadShelves({ refresh: true });

    expect(store.statusFor('a')).toBe('read');
  });

  it('drops rows the server no longer returns once they are settled', async () => {
    const { store, gateway } = concurrentHarness();
    store.shelves.set('gone', makeShelfRecord({ bookId: 'gone' }));

    gateway.pages = [
      { items: [makeShelfRecord({ bookId: 'kept' })], nextCursorId: null, hasMore: false }
    ];
    await store.loadShelves({ refresh: true });

    expect(store.list.map((row) => row.bookId)).toEqual(['kept']);
  });

  it('coalesces concurrent loadMore calls into a single page append', async () => {
    const { store, gateway } = concurrentHarness();
    gateway.pages = [
      {
        items: [makeShelfRecord({ bookId: 'a' })],
        nextCursorId: 'reader-1_a',
        hasMore: true
      },
      {
        items: [makeShelfRecord({ bookId: 'b' })],
        nextCursorId: null,
        hasMore: false
      }
    ];

    await store.loadShelves({ refresh: true });

    const gate = createDeferred<void>();
    const originalListShelves = gateway.listShelves.bind(gateway);
    gateway.listShelves = async (input) => {
      await gate.promise;
      return originalListShelves(input);
    };

    const first = store.loadMore();
    const second = store.loadMore();
    expect(second).toBe(first);

    gate.resolve();
    await Promise.all([first, second]);

    expect(gateway.listQueries).toHaveLength(2);
    expect(store.list.map((row) => row.bookId).sort()).toEqual(['a', 'b']);
  });
});
