/**
 * Catalog persistence for search and discovery.
 *
 * Firestore has no full-text search, so the split is deliberate: `orderBy` plus
 * `startAfter`/`limit` provide stable, index-backed cursor pagination, while the
 * free-text and minimum-rating predicates are applied in memory by the search
 * store. The gateway therefore returns whatever the ordered scan yields and the
 * store keeps pulling pages until it can fill a page of matches — documented in
 * `search.svelte.ts`.
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit as limitTo,
  orderBy,
  query as buildQuery,
  startAfter,
  where,
  type Firestore,
  type QueryConstraint,
  type QueryDocumentSnapshot
} from 'firebase/firestore';
import { db as firebaseDb } from '$lib/firebase/client';
import { parseBook } from '$lib/validation/schemas';
import { DataIntegrityError } from '$lib/data/errors';
import { BOOK_COLLECTION } from '$lib/data/shelf-gateway';
import type { Book, BookSortField, CursorPage, SortDirection } from '$lib/types/domain';

export const DEFAULT_CATALOG_PAGE_SIZE = 20;

export interface CatalogQuery {
  /** Exact genre match; Firestore supports this through `array-contains`. */
  genre?: string;
  sortBy: BookSortField;
  sortDirection: SortDirection;
  pageSize?: number;
  cursorId?: string | null;
}

export interface CatalogGateway {
  listBooks(input: CatalogQuery): Promise<CursorPage<Book>>;
  getBook(bookId: string): Promise<Book | null>;
  /** Distinct genre labels available in the catalog, most common first. */
  listGenres(limit?: number): Promise<string[]>;
}

function toBook(snapshot: QueryDocumentSnapshot): Book {
  const result = parseBook({ ...snapshot.data(), id: snapshot.id });
  if (!result.success) {
    throw new DataIntegrityError(BOOK_COLLECTION, snapshot.id, result.errors);
  }
  return result.data;
}

/** Firestore-backed implementation used by the application. */
export class FirestoreCatalogGateway implements CatalogGateway {
  /** Firestore handle; the emulator suite and tests inject their own. */
  #db: Firestore;

  constructor(options: { firestore?: Firestore } = {}) {
    this.#db = options.firestore ?? firebaseDb;
  }

  async listBooks(input: CatalogQuery): Promise<CursorPage<Book>> {
    const pageSize = input.pageSize ?? DEFAULT_CATALOG_PAGE_SIZE;
    const constraints: QueryConstraint[] = [];

    if (input.genre) {
      constraints.push(where('genres', 'array-contains', input.genre));
    }

    constraints.push(orderBy(input.sortBy, input.sortDirection));

    if (input.cursorId) {
      const cursor = await getDoc(doc(this.#db, BOOK_COLLECTION, input.cursorId));

      // CONC-02: a cursor document that no longer exists (deleted or re-keyed
      // between pages) must NOT be silently dropped. Dropping the constraint
      // restarts the scan at page 1, so `SearchStore.#collectMatches` would keep
      // receiving page 1 with `hasMore: true` and never terminate. Report an
      // exhausted, terminal page instead: the caller stops paging, and the
      // in-memory results already collected stay on screen.
      if (!cursor.exists()) {
        return { items: [], nextCursorId: null, hasMore: false };
      }

      constraints.push(startAfter(cursor));
    }

    constraints.push(limitTo(pageSize + 1));

    const snapshot = await getDocs(buildQuery(collection(this.#db, BOOK_COLLECTION), ...constraints));
    const page = snapshot.docs.slice(0, pageSize);
    const hasMore = snapshot.docs.length > pageSize;

    return {
      items: page.map(toBook),
      hasMore,
      nextCursorId: hasMore && page.length > 0 ? page[page.length - 1]!.id : null
    };
  }

  async getBook(bookId: string): Promise<Book | null> {
    const snapshot = await getDoc(doc(this.#db, BOOK_COLLECTION, bookId));
    if (!snapshot.exists()) return null;
    const result = parseBook({ ...snapshot.data(), id: snapshot.id });
    if (!result.success) throw new DataIntegrityError(BOOK_COLLECTION, bookId, result.errors);
    return result.data;
  }

  async listGenres(limit = 24): Promise<string[]> {
    const snapshot = await getDocs(buildQuery(collection(this.#db, BOOK_COLLECTION), limitTo(200)));
    const counts = new Map<string, number>();

    for (const document of snapshot.docs) {
      const genres = document.data().genres;
      if (!Array.isArray(genres)) continue;
      for (const genre of genres) {
        if (typeof genre !== 'string' || genre.length === 0) continue;
        counts.set(genre, (counts.get(genre) ?? 0) + 1);
      }
    }

    return [...counts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, limit)
      .map(([genre]) => genre);
  }
}
