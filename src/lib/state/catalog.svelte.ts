/**
 * Catalog store for the discovery and detail surfaces.
 *
 * Discovery loads three small, purpose-ordered shelves (trending, top rated,
 * newest) once and caches them; book details are fetched and cached per id so
 * navigating back and forth costs nothing. Reads are public in the security
 * rules, so this store works for anonymous readers too.
 */
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { FirestoreCatalogGateway, type CatalogGateway } from '$lib/data/catalog-gateway';
import { describeReadFailure } from '$lib/data/errors';
import { retryRead } from '$lib/data/retry';
import type { Book, BookSortField, SortDirection } from '$lib/types/domain';

export type CatalogSectionKey = 'trending' | 'topRated' | 'newest';

export interface CatalogSection {
  key: CatalogSectionKey;
  title: string;
  description: string;
  books: Book[];
  isLoading: boolean;
  error: string | null;
}

export interface CatalogStoreOptions {
  gateway?: CatalogGateway;
  /** Rows per discovery shelf. */
  sectionSize?: number;
}

interface SectionRequest {
  key: CatalogSectionKey;
  title: string;
  description: string;
  sortBy: BookSortField;
  sortDirection: SortDirection;
}

const SECTION_REQUESTS: readonly SectionRequest[] = [
  {
    key: 'trending',
    title: 'Trending Now',
    description: 'Most rated across the community this season.',
    sortBy: 'ratingsCount',
    sortDirection: 'desc'
  },
  {
    key: 'topRated',
    title: 'Highest Rated',
    description: 'Top of the leaderboard once review volume is accounted for.',
    sortBy: 'bayesianRating',
    sortDirection: 'desc'
  },
  {
    key: 'newest',
    title: 'Fresh Arrivals',
    description: 'Recently published editions worth a look.',
    sortBy: 'publishedDate',
    sortDirection: 'desc'
  }
];

export class CatalogStore {
  /** Discovery shelves in render order. */
  sections = $state<CatalogSection[]>(
    SECTION_REQUESTS.map((request) => ({
      key: request.key,
      title: request.title,
      description: request.description,
      books: [],
      isLoading: false,
      error: null
    }))
  );

  /** Distinct genre labels for the search filters. */
  genres = $state<string[]>([]);
  genresLoading = $state(false);

  /** Detail-page cache keyed by book id. */
  booksById = new SvelteMap<string, Book>();
  loadingBookIds = new SvelteSet<string>();
  bookErrors = new SvelteMap<string, string>();

  #gateway: CatalogGateway;
  #sectionSize: number;
  #discoveryLoaded = false;
  #genresLoaded = false;

  constructor(options: CatalogStoreOptions = {}) {
    this.#gateway = options.gateway ?? new FirestoreCatalogGateway();
    this.#sectionSize = options.sectionSize ?? 8;
  }

  /** True once every discovery shelf has produced a result or failed. */
  get isDiscoveryLoading(): boolean {
    return this.sections.some((section) => section.isLoading);
  }

  get hasDiscoveryContent(): boolean {
    return this.sections.some((section) => section.books.length > 0);
  }

  get discoveryError(): string | null {
    const failed = this.sections.filter((section) => section.error !== null);
    return failed.length === this.sections.length && failed.length > 0
      ? (failed[0]?.error ?? null)
      : null;
  }

  /** Loads the discovery shelves once; pass `refresh` to re-query. */
  async loadDiscovery(options: { refresh?: boolean } = {}): Promise<void> {
    if (this.#discoveryLoaded && !options.refresh) return;
    this.#discoveryLoaded = true;

    await Promise.all(
      SECTION_REQUESTS.map(async (request, index) => {
        this.#patchSection(index, { isLoading: true, error: null });
        try {
          const page = await retryRead(() =>
            this.#gateway.listBooks({
              sortBy: request.sortBy,
              sortDirection: request.sortDirection,
              pageSize: this.#sectionSize
            })
          );
          this.#cacheBooks(page.items);
          this.#patchSection(index, { books: page.items, isLoading: false });
        } catch (error) {
          this.#patchSection(index, {
            isLoading: false,
            error: describeReadFailure(
              error,
              'This shelf could not be loaded. Check your connection and try again.'
            )
          });
        }
      })
    );
  }

  /** Loads genre labels once for the search filters. */
  async loadGenres(options: { refresh?: boolean } = {}): Promise<void> {
    if (this.#genresLoaded && !options.refresh) return;
    this.#genresLoaded = true;
    this.genresLoading = true;
    try {
      this.genres = await retryRead(() => this.#gateway.listGenres());
    } catch {
      // Genre chips are a convenience; search still works without them.
      this.genres = [];
    } finally {
      this.genresLoading = false;
    }
  }

  /** Returns a cached book, fetching and caching it when absent. */
  async loadBook(bookId: string): Promise<Book | null> {
    const cached = this.booksById.get(bookId);
    if (cached) return cached;

    this.loadingBookIds.add(bookId);
    this.#clearBookError(bookId);

    try {
      const book = await retryRead(() => this.#gateway.getBook(bookId));
      if (book) this.#cacheBooks([book]);
      return book;
    } catch (error) {
      this.#setBookError(
        bookId,
        describeReadFailure(error, 'This book could not be loaded. Try again in a moment.')
      );
      return null;
    } finally {
      this.loadingBookIds.delete(bookId);
    }
  }

  bookFor(bookId: string): Book | undefined {
    return this.booksById.get(bookId);
  }

  isLoadingBook(bookId: string): boolean {
    return this.loadingBookIds.has(bookId);
  }

  bookError(bookId: string): string | null {
    return this.bookErrors.get(bookId) ?? null;
  }

  clear(): void {
    this.booksById.clear();
    this.bookErrors.clear();
    this.#discoveryLoaded = false;
    this.#genresLoaded = false;
    this.sections = SECTION_REQUESTS.map((request) => ({
      key: request.key,
      title: request.title,
      description: request.description,
      books: [],
      isLoading: false,
      error: null
    }));
  }

  #cacheBooks(books: readonly Book[]): void {
    if (books.length === 0) return;
    for (const book of books) this.booksById.set(book.id, book);
  }

  #patchSection(index: number, patch: Partial<CatalogSection>): void {
    const current = this.sections[index];
    if (!current) return;
    this.sections = this.sections.map((section, position) =>
      position === index ? { ...section, ...patch } : section
    );
  }

  #setBookError(bookId: string, message: string): void {
    this.bookErrors.set(bookId, message);
  }

  #clearBookError(bookId: string): void {
    this.bookErrors.delete(bookId);
  }
}

export function createCatalogStore(options: CatalogStoreOptions = {}): CatalogStore {
  return new CatalogStore(options);
}

export const catalogStore = new CatalogStore();
