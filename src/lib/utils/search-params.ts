/**
 * Search filter ↔ query-string mapping.
 *
 * The search route mirrors its filters into the address bar in one direction and
 * accepts them from it in the other. Both directions are defined here, as pure
 * functions, for two reasons:
 *
 *   1. the route stays a thin shell around them, and
 *   2. the *absence* of a debounce in this layer is testable (PERF-01). The only
 *      debounce in the whole search pipeline belongs to `SearchStore`, around the
 *      Firestore query; the URL is a synchronous side effect of a filter change
 *      and must never grow a timer of its own.
 */
import { DEFAULT_BOOK_SEARCH_FILTERS } from '$lib/types/domain';
import type { BookSearchFilters, BookSortField, SortDirection } from '$lib/types/domain';

/** Applies a query string to a store-shaped filter mutator. */
export interface FilterApplier {
  setQuery(query: string): void;
  setGenre(genre: string): void;
  setMinRating(minRating: number): void;
  setSortOption(option: string): void;
}

/**
 * Reads filters out of a query string and pushes them into `applier`.
 *
 * Every parameter is optional, and anything unrecognised falls back to the
 * default rather than throwing: a hand-edited or stale URL should narrow the view
 * sensibly, not break the page.
 */
export function applySearchParams(search: URLSearchParams, applier: FilterApplier): void {
  applier.setQuery(search.get('q') ?? '');
  applier.setGenre(search.get('genre') ?? '');

  const minRating = Number.parseInt(search.get('rating') ?? '', 10);
  applier.setMinRating(Number.isFinite(minRating) ? minRating : 0);

  const sort = search.get('sort');
  if (!sort) return;

  const direction = search.get('dir');
  applier.setSortOption(
    `${sort}:${direction === 'asc' || direction === 'desc' ? direction : 'desc'}`
  );
}

/**
 * Canonical query string for the current filters.
 *
 * Defaults are omitted so the common view has a clean `/search` URL, and the
 * parameters are written in a fixed order so two equal filter sets always
 * produce the same string — which is what lets the route compare against what it
 * last wrote and skip redundant history writes.
 */
export function searchParamsForFilters(filters: BookSearchFilters): string {
  const params = new URLSearchParams();

  const query = filters.query.trim();
  if (query.length > 0) params.set('q', query);
  if (filters.genre) params.set('genre', filters.genre);
  if (filters.minRating > 0) params.set('rating', String(filters.minRating));

  if (filters.sortBy !== DEFAULT_BOOK_SEARCH_FILTERS.sortBy) {
    params.set('sort', filters.sortBy satisfies BookSortField);
  }
  if (filters.sortDirection !== DEFAULT_BOOK_SEARCH_FILTERS.sortDirection) {
    params.set('dir', filters.sortDirection satisfies SortDirection);
  }

  const serialised = params.toString();
  return serialised.length > 0 ? `?${serialised}` : '';
}
