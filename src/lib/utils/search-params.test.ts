/**
 * PERF-01 regression coverage.
 *
 * The search route used to mirror its filters into the URL behind a 250ms
 * `setTimeout` that stacked on top of `SearchStore`'s own 250ms debounce. Two
 * independent timers measured two different things, so the URL settled only after
 * the reader had been idle twice over, and each pause in typing also drove a full
 * SvelteKit navigation.
 *
 * The debounce contract these cases pin down:
 *
 *   1. exactly one debounce governs the pipeline, and it lives in `SearchStore`
 *      (verified here, since the URL layer must contribute none);
 *   2. the URL layer is a *synchronous* pure mapping in both directions, so it can
 *      never introduce a second timer;
 *   3. the mapping is stable — equal filters always serialise identically — which
 *      is what lets the route skip redundant history writes.
 */
import { describe, expect, it, vi } from 'vitest';
import { applySearchParams, searchParamsForFilters } from '$lib/utils/search-params';
import { createSearchStore } from '$lib/state/search.svelte';
import { FakeCatalogGateway } from '$lib/testing/fakes';
import { DEFAULT_BOOK_SEARCH_FILTERS } from '$lib/types/domain';
import type { BookSearchFilters } from '$lib/types/domain';

function filters(overrides: Partial<BookSearchFilters> = {}): BookSearchFilters {
  return { ...DEFAULT_BOOK_SEARCH_FILTERS, ...overrides };
}

describe('searchParamsForFilters (PERF-01)', () => {
  it('omits every default so the plain view has a clean URL', () => {
    expect(searchParamsForFilters(filters())).toBe('');
  });

  it('serialises only the filters that differ from the defaults', () => {
    expect(searchParamsForFilters(filters({ query: 'steinbeck' }))).toBe('?q=steinbeck');
    expect(searchParamsForFilters(filters({ genre: 'Classics' }))).toBe('?genre=Classics');
    expect(searchParamsForFilters(filters({ minRating: 4 }))).toBe('?rating=4');
    expect(searchParamsForFilters(filters({ sortBy: 'title' }))).toBe('?sort=title');
    expect(searchParamsForFilters(filters({ sortDirection: 'asc' }))).toBe('?dir=asc');
  });

  it('trims the query so trailing spaces never churn the URL', () => {
    // A reader typing "dune " must not produce a different URL than "dune".
    expect(searchParamsForFilters(filters({ query: 'dune ' }))).toBe('?q=dune');
    expect(searchParamsForFilters(filters({ query: '  dune' }))).toBe('?q=dune');
    expect(searchParamsForFilters(filters({ query: '   ' }))).toBe('');
  });

  it('is stable for equal filter sets regardless of construction order', () => {
    const a = filters({ query: 'lem', genre: 'Science Fiction', minRating: 3, sortBy: 'title' });
    const b = filters({ sortBy: 'title', minRating: 3, genre: 'Science Fiction', query: 'lem' });

    expect(searchParamsForFilters(a)).toBe(searchParamsForFilters(b));
    expect(searchParamsForFilters(a)).toBe('?q=lem&genre=Science+Fiction&rating=3&sort=title');
  });

  it('encodes values that would otherwise break the URL', () => {
    expect(searchParamsForFilters(filters({ query: 'a&b=c' }))).toBe('?q=a%26b%3Dc');
    expect(searchParamsForFilters(filters({ genre: 'Sci-Fi & Fantasy' }))).toBe(
      '?genre=Sci-Fi+%26+Fantasy'
    );
  });
});

describe('applySearchParams (PERF-01)', () => {
  function recorder() {
    const calls: string[] = [];
    return {
      calls,
      applier: {
        setQuery: vi.fn((value: string) => calls.push(`query=${value}`)),
        setGenre: vi.fn((value: string) => calls.push(`genre=${value}`)),
        setMinRating: vi.fn((value: number) => calls.push(`minRating=${value}`)),
        setSortOption: vi.fn((value: string) => calls.push(`sortOption=${value}`))
      }
    };
  }

  it('round-trips a serialised filter set', () => {
    const original = filters({
      query: 'lem',
      genre: 'Science Fiction',
      minRating: 3,
      sortBy: 'title',
      sortDirection: 'asc'
    });
    const { applier } = recorder();

    applySearchParams(new URLSearchParams(searchParamsForFilters(original)), applier);

    expect(applier.setQuery).toHaveBeenCalledWith('lem');
    expect(applier.setGenre).toHaveBeenCalledWith('Science Fiction');
    expect(applier.setMinRating).toHaveBeenCalledWith(3);
    expect(applier.setSortOption).toHaveBeenCalledWith('title:asc');
  });

  it('resets every filter for an empty query string', () => {
    const { applier } = recorder();

    applySearchParams(new URLSearchParams(''), applier);

    expect(applier.setQuery).toHaveBeenCalledWith('');
    expect(applier.setGenre).toHaveBeenCalledWith('');
    expect(applier.setMinRating).toHaveBeenCalledWith(0);
    // No `sort` parameter means "leave the default ordering alone".
    expect(applier.setSortOption).not.toHaveBeenCalled();
  });

  it('falls back to descending for a missing or unknown direction', () => {
    for (const search of ['sort=title', 'sort=title&dir=nonsense', 'sort=title&dir=']) {
      const { applier } = recorder();
      applySearchParams(new URLSearchParams(search), applier);
      expect(applier.setSortOption).toHaveBeenCalledWith('title:desc');
    }
  });

  it('treats an unparseable rating as no minimum', () => {
    for (const search of ['rating=abc', 'rating=', 'rating=NaN']) {
      const { applier } = recorder();
      applySearchParams(new URLSearchParams(search), applier);
      expect(applier.setMinRating).toHaveBeenCalledWith(0);
    }
  });

  it('never schedules work itself — it only calls the store mutators', () => {
    vi.useFakeTimers();
    try {
      const { applier } = recorder();

      applySearchParams(new URLSearchParams('q=dune&genre=Classics&rating=4&sort=title'), applier);

      // Nothing in the URL layer may own a timer: if it did, the reader would be
      // waiting on two debounces instead of one.
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('SearchStore debounce is the single ceiling (PERF-01)', () => {
  it('schedules exactly one search across a burst of keystrokes', async () => {
    vi.useFakeTimers();
    try {
      const gateway = new FakeCatalogGateway();
      const store = createSearchStore({ gateway, pageSize: 10, debounceMs: 250 });

      // Five keystrokes, as a reader would type "dune".
      for (const term of ['d', 'du', 'dun', 'dune']) {
        store.setQuery(term);
        // The URL layer runs synchronously here; it must not add a timer.
        expect(vi.getTimerCount()).toBe(1);
      }

      // Nothing has hit the gateway yet — the store is still debouncing.
      expect(gateway.queries).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(250);

      // One debounce, one query.
      expect(gateway.queries).toHaveLength(1);
      expect(store.filters.query).toBe('dune');
    } finally {
      vi.useRealTimers();
    }
  });

  it('applies the query to the filters immediately for instant input feedback', () => {
    const store = createSearchStore({ gateway: new FakeCatalogGateway(), debounceMs: 250 });

    store.setQuery('dune');

    // The *visual* state updates synchronously; only the I/O is debounced.
    expect(store.filters.query).toBe('dune');
  });
});
