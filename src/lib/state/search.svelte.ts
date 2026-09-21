/**
 * Catalog search: index-backed pagination in Firestore, ranking in memory.
 *
 * Firestore cannot do full-text search, so the split is explicit:
 *   - `orderBy` + `startAfter` + `limit` give stable cursor pagination over an
 *     index (see `firestore.indexes.json`), with the genre filter pushed down
 *     through `array-contains`;
 *   - the free-text query, the minimum-rating threshold, and the tie-break
 *     ordering run in memory on the arriving page.
 *
 * Because a server page can filter down to nothing, the store keeps pulling
 * pages until it can fill a client page or the cursor is exhausted. That is the
 * documented tradeoff of combining the two.
 */
import {
  DEFAULT_CATALOG_PAGE_SIZE,
  FirestoreCatalogGateway,
  type CatalogGateway,
  type CatalogQuery
} from '$lib/data/catalog-gateway';
import { describeReadFailure } from '$lib/data/errors';
import { retryRead } from '$lib/data/retry';
import type { Book, BookSearchFilters, BookSortField, SortDirection } from '$lib/types/domain';
import { DEFAULT_BOOK_SEARCH_FILTERS } from '$lib/types/domain';

export const CATALOG_SORT_OPTIONS: readonly {
  value: `${BookSortField}:${SortDirection}`;
  label: string;
}[] = [
  { value: 'bayesianRating:desc', label: 'Best rated' },
  { value: 'ratingsCount:desc', label: 'Most rated' },
  { value: 'publishedDate:desc', label: 'Newest' },
  { value: 'title:asc', label: 'Title A–Z' }
] as const;

export interface SearchStoreOptions {
  gateway?: CatalogGateway;
  pageSize?: number;
  /** Debounce applied to keystroke-driven searches. */
  debounceMs?: number;
  /** Upper bound on Firestore round trips used to fill one client page. */
  maxServerPagesPerSearch?: number;
}

/** Normalises a query for matching; accents and case are ignored. */
/** Letters NFKD leaves intact but readers still expect to match. */
const LETTER_FOLDING: Record<string, string> = {
  ł: 'l',
  ø: 'o',
  đ: 'd',
  ð: 'd',
  þ: 'th',
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  ı: 'i'
};

export function normalizeSearchTerm(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[łøđðþßæœı]/g, (letter) => LETTER_FOLDING[letter] ?? letter)
    .trim();
}

function searchableText(book: Book): string {
  return normalizeSearchTerm(
    [book.title, book.subtitle, ...book.authors, book.publisher, book.isbn13, ...book.genres].join(' ')
  );
}

/**
 * Applies the in-memory half of the filter contract. Pure and exported so the
 * matching rules are unit tested independently of the store.
 */
export function filterBooks(books: readonly Book[], filters: BookSearchFilters): Book[] {
  const term = normalizeSearchTerm(filters.query);

  return books.filter((book) => {
    if (filters.genre && !book.genres.includes(filters.genre)) return false;
    if (filters.minRating > 0 && book.bayesianRating < filters.minRating) return false;
    if (term.length === 0) return true;

    const haystack = searchableText(book);
    return term.split(/\s+/).every((token) => haystack.includes(token));
  });
}

function compareBy(field: BookSortField, left: Book, right: Book): number {
  switch (field) {
    case 'title':
      return left.title.localeCompare(right.title);
    case 'publishedDate':
      return left.publishedDate.localeCompare(right.publishedDate);
    case 'ratingsCount':
      return left.ratingsCount - right.ratingsCount;
    case 'bayesianRating':
      return left.bayesianRating - right.bayesianRating;
  }
}

/**
 * Orders books by the requested field and direction, falling back to the
 * Bayesian score and then the title so equal values never reorder between pages.
 */
export function sortBooks(books: Book[], field: BookSortField, direction: SortDirection): Book[] {
  const sign = direction === 'asc' ? 1 : -1;

  return [...books].sort((left, right) => {
    const primary = compareBy(field, left, right);
    if (primary !== 0) return primary * sign;

    const balance = left.bayesianRating - right.bayesianRating;
    if (balance !== 0) return -balance;

    return left.title.localeCompare(right.title);
  });
}

export class SearchStore {
  filters = $state<BookSearchFilters>({ ...DEFAULT_BOOK_SEARCH_FILTERS });
  results = $state<Book[]>([]);
  isLoading = $state(false);
  hasMore = $state(false);
  error = $state<string | null>(null);
  /** Number of Firestore pages pulled for the most recent search. */
  serverPagesFetched = $state(0);

  #gateway: CatalogGateway;
  #pageSize: number;
  #debounceMs: number;
  #maxServerPages: number;
  #cursor: string | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #pendingResolvers: Array<() => void> = [];

  constructor(options: SearchStoreOptions = {}) {
    this.#gateway = options.gateway ?? new FirestoreCatalogGateway();
    this.#pageSize = options.pageSize ?? DEFAULT_CATALOG_PAGE_SIZE;
    this.#debounceMs = options.debounceMs ?? 250;
    this.#maxServerPages = options.maxServerPagesPerSearch ?? 5;
  }

  /** How many filters are narrowing the catalog right now. */
  activeFilterCount = $derived(
    (this.filters.query.trim().length > 0 ? 1 : 0) +
      (this.filters.genre.length > 0 ? 1 : 0) +
      (this.filters.minRating > 0 ? 1 : 0)
  );

  get hasResults(): boolean {
    return this.results.length > 0;
  }

  get isEmpty(): boolean {
    return !this.isLoading && this.results.length === 0;
  }

  /** Result count for the "showing N books" label. */
  get resultCount(): number {
    return this.results.length;
  }

  /** True when `results` is the unfiltered default view. */
  get isDefaultView(): boolean {
    return this.activeFilterCount === 0;
  }

  /** Debounced query update, used by the search field on every keystroke. */
  setQuery(query: string): void {
    this.filters.query = query;
    this.#schedule();
  }

  setGenre(genre: string): void {
    this.filters.genre = genre;
    this.#schedule(0);
  }

  setMinRating(minRating: number): void {
    this.filters.minRating = minRating;
    this.#schedule(0);
  }

  setSort(field: BookSortField, direction: SortDirection): void {
    this.filters.sortBy = field;
    this.filters.sortDirection = direction;
    this.#schedule(0);
  }

  setSortOption(option: string): void {
    const [field, direction] = option.split(':') as [BookSortField, SortDirection];
    if (!field || !direction) return;
    this.setSort(field, direction);
  }

  toggleSortDirection(): void {
    this.setSort(this.filters.sortBy, this.filters.sortDirection === 'asc' ? 'desc' : 'asc');
  }

  clearFilters(): void {
    this.filters = { ...DEFAULT_BOOK_SEARCH_FILTERS };
    this.#schedule(0);
  }

  /** Resets the cursor and loads the first client page immediately. */
  async search(): Promise<void> {
    this.#cancelTimer();
    this.#cursor = null;
    this.isLoading = true;
    this.error = null;

    try {
      const { matches, cursorId, hasMore, pages } = await this.#collectMatches(0, this.#pageSize);
      this.results = matches;
      this.#cursor = cursorId;
      this.hasMore = hasMore;
      this.serverPagesFetched = pages;
    } catch (error) {
      this.error = describeReadFailure(error, 'The catalog could not be loaded.');
      this.results = [];
      this.hasMore = false;
    } finally {
      this.isLoading = false;
      this.#flushPending();
    }
  }

  /** Appends the next client page, reusing the server cursor. */
  async loadMore(): Promise<void> {
    if (!this.hasMore || this.isLoading || this.#cursor === null) return;

    this.isLoading = true;

    try {
      const { matches, cursorId, hasMore, pages } = await this.#collectMatches(0, this.#pageSize);
      this.results = [...this.results, ...matches];
      this.#cursor = cursorId;
      this.hasMore = hasMore;
      this.serverPagesFetched += pages;
    } catch (error) {
      this.error = describeReadFailure(error, 'The next page could not be loaded.');
    } finally {
      this.isLoading = false;
      this.#flushPending();
    }
  }

  /** Resolves once the debounce window has elapsed and the search completed. */
  flush(): Promise<void> {
    if (this.#timer === null && !this.isLoading) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.#pendingResolvers.push(resolve);
    });
  }

  /**
   * Pure in-memory pass over an already loaded list — the client-side engine the
   * dashboard uses when the whole catalog is small enough to hold in memory.
   */
  applyLocally(books: readonly Book[]): Book[] {
    return sortBooks(
      filterBooks(books, this.filters),
      this.filters.sortBy,
      this.filters.sortDirection
    );
  }

  /** Replaces the result list with a locally filtered view (no I/O). */
  useLocalResults(books: readonly Book[]): void {
    this.results = this.applyLocally(books);
    this.hasMore = false;
    this.#cursor = null;
    this.error = null;
  }

  /**
   * Pulls server pages until the client page is full or the cursor is exhausted.
   * Returns the matching books plus the resume cursor.
   */
  async #collectMatches(
    offset: number,
    wanted: number
  ): Promise<{ matches: Book[]; cursorId: string | null; hasMore: boolean; pages: number }> {
    const matches: Book[] = [];
    let cursorId = this.#cursor;
    let hasMore = false;
    let pages = 0;
    let guard = 0;

    void offset;

    do {
      const query: CatalogQuery = {
        genre: this.filters.genre || undefined,
        sortBy: this.filters.sortBy,
        sortDirection: this.filters.sortDirection,
        pageSize: this.#pageSize,
        cursorId
      };

      const page = await retryRead(() => this.#gateway.listBooks(query));
      pages += 1;
      guard += 1;

      matches.push(...filterBooks(page.items, this.filters));
      cursorId = page.nextCursorId;
      hasMore = page.hasMore;
    } while (matches.length < wanted && hasMore && cursorId !== null && guard < this.#maxServerPages);

    return { matches, cursorId, hasMore, pages };
  }

  #schedule(delay = this.#debounceMs): void {
    this.#cancelTimer();

    if (delay <= 0) {
      void this.search();
      return;
    }

    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.search();
    }, delay);
  }

  #cancelTimer(): void {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }

  #flushPending(): void {
    const resolvers = this.#pendingResolvers;
    this.#pendingResolvers = [];
    for (const resolve of resolvers) resolve();
  }
}

/** Factory used by tests; the app imports the singleton below. */
export function createSearchStore(options: SearchStoreOptions = {}): SearchStore {
  return new SearchStore(options);
}

export const searchStore = createSearchStore();
