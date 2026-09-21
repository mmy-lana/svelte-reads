import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SearchStore,
  createSearchStore,
  filterBooks,
  normalizeSearchTerm,
  sortBooks
} from '$lib/state/search.svelte';
import { FakeCatalogGateway, firestoreError } from '$lib/testing/fakes';
import { makeBook } from '$lib/testing/fixtures';
import { DEFAULT_BOOK_SEARCH_FILTERS } from '$lib/types/domain';
import type { Book } from '$lib/types/domain';

const catalog: Book[] = [
  makeBook({
    id: 'east-of-eden',
    title: 'East of Eden',
    authors: ['John Steinbeck'],
    genres: ['Classics', 'Fiction'],
    bayesianRating: 4.31,
    ratingsCount: 500,
    publishedDate: '1952-09-19'
  }),
  makeBook({
    id: 'cannery-row',
    title: 'Cannery Row',
    authors: ['John Steinbeck'],
    genres: ['Fiction'],
    bayesianRating: 4.02,
    ratingsCount: 210,
    publishedDate: '1945-01-01'
  }),
  makeBook({
    id: 'solaris',
    title: 'Solaris',
    subtitle: 'A Novel',
    authors: ['Stanisław Lem'],
    genres: ['Science Fiction'],
    bayesianRating: 4.44,
    ratingsCount: 900,
    publishedDate: '1961-01-01'
  }),
  makeBook({
    id: 'dune',
    title: 'Dune',
    authors: ['Frank Herbert'],
    genres: ['Science Fiction', 'Classics'],
    bayesianRating: 4.18,
    ratingsCount: 4200,
    publishedDate: '1965-08-01'
  })
];

function filters(overrides: Partial<typeof DEFAULT_BOOK_SEARCH_FILTERS> = {}) {
  return { ...DEFAULT_BOOK_SEARCH_FILTERS, ...overrides };
}

describe('catalog filtering engine', () => {
  it('matches on title, author, publisher, isbn, and genre tokens', () => {
    expect(filterBooks(catalog, filters({ query: 'eden' })).map((book) => book.id)).toEqual([
      'east-of-eden'
    ]);
    expect(filterBooks(catalog, filters({ query: 'steinbeck' })).map((book) => book.id)).toEqual([
      'east-of-eden',
      'cannery-row'
    ]);
    expect(filterBooks(catalog, filters({ query: '9780140187394' }))).toHaveLength(4);
    expect(filterBooks(catalog, filters({ query: 'penguin' }))).toHaveLength(4);
  });

  it('requires every token to match, in any order', () => {
    expect(filterBooks(catalog, filters({ query: 'row cannery' })).map((b) => b.id)).toEqual([
      'cannery-row'
    ]);
    expect(filterBooks(catalog, filters({ query: 'row dune' }))).toHaveLength(0);
  });

  it('ignores case and accents', () => {
    expect(normalizeSearchTerm('  Stanisław ')).toBe('stanislaw');
    expect(filterBooks(catalog, filters({ query: 'stanislaw' })).map((b) => b.id)).toEqual([
      'solaris'
    ]);
    expect(filterBooks(catalog, filters({ query: 'SOLARIS' })).map((b) => b.id)).toEqual([
      'solaris'
    ]);
  });

  it('applies the genre and minimum-rating thresholds', () => {
    expect(filterBooks(catalog, filters({ genre: 'Science Fiction' })).map((b) => b.id)).toEqual([
      'solaris',
      'dune'
    ]);
    expect(filterBooks(catalog, filters({ minRating: 4.4 })).map((b) => b.id)).toEqual([
      'solaris'
    ]);
    expect(
      filterBooks(catalog, filters({ genre: 'Classics', minRating: 4.2 })).map((b) => b.id)
    ).toEqual(['east-of-eden']);
  });

  it('returns everything when no filter is set', () => {
    expect(filterBooks(catalog, filters())).toHaveLength(4);
  });
});

describe('catalog ordering', () => {
  it('orders by Bayesian score descending', () => {
    expect(
      sortBooks(catalog, 'bayesianRating', 'desc').map((book) => book.id)
    ).toEqual(['solaris', 'east-of-eden', 'dune', 'cannery-row']);
  });

  it('orders by title ascending', () => {
    expect(sortBooks(catalog, 'title', 'asc').map((book) => book.id)).toEqual([
      'cannery-row',
      'dune',
      'east-of-eden',
      'solaris'
    ]);
  });

  it('breaks ties deterministically by Bayesian score then title', () => {
    const tied = [
      makeBook({ id: 'b', title: 'Beta', bayesianRating: 4, ratingsCount: 10 }),
      makeBook({ id: 'a', title: 'Alpha', bayesianRating: 4, ratingsCount: 10 }),
      makeBook({ id: 'c', title: 'Gamma', bayesianRating: 4.5, ratingsCount: 10 })
    ];

    expect(sortBooks(tied, 'ratingsCount', 'desc').map((book) => book.id)).toEqual(['c', 'a', 'b']);
  });

  it('does not mutate the input list', () => {
    const original = [...catalog];
    sortBooks(catalog, 'title', 'asc');
    expect(catalog).toEqual(original);
  });
});

describe('SearchStore pagination', () => {
  let gateway: FakeCatalogGateway;
  let store: SearchStore;

  beforeEach(() => {
    gateway = new FakeCatalogGateway();
    gateway.pages = [
      {
        items: [catalog[0]!, catalog[1]!],
        nextCursorId: 'reader-1_cannery-row',
        hasMore: true
      },
      {
        items: [catalog[2]!, catalog[3]!],
        nextCursorId: null,
        hasMore: false
      }
    ];
    store = createSearchStore({ gateway, pageSize: 2, debounceMs: 0 });
  });

  it('loads the first page and exposes the cursor state', async () => {
    await store.search();

    expect(store.results.map((book) => book.id)).toEqual(['east-of-eden', 'cannery-row']);
    expect(store.hasMore).toBe(true);
    expect(gateway.queries[0]).toMatchObject({
      sortBy: 'bayesianRating',
      sortDirection: 'desc',
      pageSize: 2,
      cursorId: null
    });
  });

  it('appends the next page and stops when the cursor is exhausted', async () => {
    await store.search();
    await store.loadMore();

    expect(store.results).toHaveLength(4);
    expect(store.hasMore).toBe(false);
    expect(gateway.queries[1]?.cursorId).toBe('reader-1_cannery-row');

    await store.loadMore();
    expect(store.results).toHaveLength(4);
    expect(gateway.queries).toHaveLength(2);
  });

  it('keeps pulling server pages until a client page is filled', async () => {
    gateway.pages = [
      { items: [catalog[3]!], nextCursorId: 'dune', hasMore: true },
      { items: [catalog[2]!], nextCursorId: 'solaris', hasMore: true },
      { items: [catalog[0]!], nextCursorId: null, hasMore: false }
    ];
    store.setQuery('steinbeck');
    await store.flush();

    expect(store.results.map((book) => book.id)).toEqual(['east-of-eden']);
    expect(store.serverPagesFetched).toBe(3);
  });

  it('pushes the genre filter down to Firestore', async () => {
    store.setGenre('Science Fiction');
    await store.flush();

    expect(gateway.queries[0]?.genre).toBe('Science Fiction');
  });

  it('surfaces catalog failures and shows an empty state', async () => {
    gateway.failure = firestoreError('unavailable');
    await store.search();

    expect(store.error).toContain('offline');
    expect(store.results).toHaveLength(0);
    expect(store.isEmpty).toBe(true);
  });
});

describe('SearchStore query handling', () => {
  it('debounces keystrokes into a single round trip', async () => {
    vi.useFakeTimers();
    try {
      const gateway = new FakeCatalogGateway();
      gateway.pages = [{ items: catalog.slice(0, 1), nextCursorId: null, hasMore: false }];
      const store = createSearchStore({ gateway, pageSize: 1, debounceMs: 250 });

      store.setQuery('e');
      store.setQuery('ea');
      store.setQuery('eas');
      expect(gateway.queries).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(300);
      expect(gateway.queries).toHaveLength(1);
      expect(store.filters.query).toBe('eas');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports how many filters are active and clears them', async () => {
    const gateway = new FakeCatalogGateway();
    const store = createSearchStore({ gateway, debounceMs: 0 });

    expect(store.isDefaultView).toBe(true);

    store.setQuery('eden');
    store.setGenre('Classics');
    store.setMinRating(4);
    await store.flush();

    expect(store.activeFilterCount).toBe(3);
    expect(store.isDefaultView).toBe(false);

    store.clearFilters();
    await store.flush();

    expect(store.activeFilterCount).toBe(0);
    expect(store.filters).toEqual(DEFAULT_BOOK_SEARCH_FILTERS);
  });

  it('applies the in-memory engine when the catalog is already loaded', () => {
    const store = createSearchStore({ gateway: new FakeCatalogGateway(), debounceMs: 0 });

    store.setGenre('Science Fiction');
    store.useLocalResults(catalog);

    expect(store.results.map((book) => book.id)).toEqual(['solaris', 'dune']);
    expect(store.hasMore).toBe(false);
    expect(store.applyLocally(catalog)).toHaveLength(2);
  });

  it('parses the combined sort option value', () => {
    const store = createSearchStore({ gateway: new FakeCatalogGateway(), debounceMs: 0 });

    store.setSortOption('title:asc');
    expect(store.filters.sortBy).toBe('title');
    expect(store.filters.sortDirection).toBe('asc');

    store.toggleSortDirection();
    expect(store.filters.sortDirection).toBe('desc');

    store.setSortOption('nonsense');
    expect(store.filters.sortBy).toBe('title');
  });
});
