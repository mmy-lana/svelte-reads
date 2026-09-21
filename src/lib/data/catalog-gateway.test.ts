/**
 * Catalog cursor-pagination contract.
 *
 * CONC-02: a cursor document that has been deleted or re-keyed between pages
 * must not restart the scan at page 1. `SearchStore.#collectMatches` loops until
 * a page reports `hasMore: false`, so silently dropping the `startAfter`
 * constraint made it re-receive page 1 forever — an unbounded query loop. These
 * cases pin the gateway's terminal-page behaviour for that input.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FirestoreCatalogGateway } from '$lib/data/catalog-gateway';
import { makeBook } from '$lib/testing/fixtures';
import type { Firestore } from 'firebase/firestore';

const sdk = vi.hoisted(() => ({
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  collection: vi.fn(),
  doc: vi.fn(),
  startAfter: vi.fn(),
  query: vi.fn()
}));

// The individual constraint builders (`where`, `orderBy`, `limit`) stay real —
// they are pure descriptors. `query` itself is mocked because applying a real
// `orderBy` descriptor requires a live `Firestore` instance; the mock records
// the constraint list instead, which is what these cases assert on.
vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return {
    ...actual,
    getDoc: sdk.getDoc,
    getDocs: sdk.getDocs,
    collection: sdk.collection,
    doc: sdk.doc,
    startAfter: sdk.startAfter,
    query: sdk.query
  };
});

/** Stand-in handle: the gateway only forwards it to the mocked SDK calls. */
const fakeDb = { __brand: 'firestore' } as unknown as Firestore;
const BOOKS_COLLECTION = 'books';

function gateway(): FirestoreCatalogGateway {
  return new FirestoreCatalogGateway({ firestore: fakeDb });
}

/** Constraint descriptors handed to the most recent `query()` call. */
function lastConstraints(): Array<{ type: string; field?: string }> {
  const call = sdk.query.mock.calls.at(-1);
  return (call?.slice(1) ?? []) as Array<{ type: string; field?: string }>;
}

function documentSnapshot(id: string, exists: boolean) {
  return {
    id,
    exists: () => exists,
    data: () => makeBook({ id })
  };
}

/** Mirrors a `QueryDocumentSnapshot`: `data()` excludes the document id. */
function querySnapshot(ids: string[]) {
  const { id: _ignored, ...data } = makeBook();
  return {
    docs: ids.map((id) => ({ id, data: () => ({ ...data, id }) })),
    size: ids.length,
    empty: ids.length === 0
  };
}

afterEach(() => {
  for (const mock of Object.values(sdk)) mock.mockReset();

  sdk.collection.mockReturnValue({ __collection: BOOKS_COLLECTION });
  sdk.doc.mockReturnValue({ __document: 'cursor' });
  sdk.startAfter.mockReturnValue({ type: 'startAfter' });
  sdk.query.mockReturnValue({ __query: true });
});

describe('FirestoreCatalogGateway cursor invalidation (CONC-02)', () => {
  it('returns a terminal empty page when the cursor document is gone', async () => {
    sdk.getDoc.mockResolvedValue(documentSnapshot('deleted-book', false));

    const page = await gateway().listBooks({
      sortBy: 'bayesianRating',
      sortDirection: 'desc',
      cursorId: 'deleted-book'
    });

    // Terminal: no items, no next cursor, nothing more to pull. A caller that
    // loops until `hasMore` is false therefore stops instead of restarting.
    expect(page).toEqual({ items: [], nextCursorId: null, hasMore: false });
  });

  it('never runs the collection query for an invalid cursor', async () => {
    sdk.getDoc.mockResolvedValue(documentSnapshot('deleted-book', false));

    await gateway().listBooks({
      sortBy: 'title',
      sortDirection: 'asc',
      cursorId: 'deleted-book'
    });

    // The expensive scan must not happen at all — restarting it from the top is
    // exactly the defect.
    expect(sdk.query).not.toHaveBeenCalled();
    expect(sdk.getDocs).not.toHaveBeenCalled();
    expect(sdk.startAfter).not.toHaveBeenCalled();
  });

  it('still applies startAfter when the cursor document exists', async () => {
    sdk.getDoc.mockResolvedValue(documentSnapshot('anchor-book', true));
    sdk.getDocs.mockResolvedValue(querySnapshot(['next-a', 'next-b']));

    const page = await gateway().listBooks({
      sortBy: 'bayesianRating',
      sortDirection: 'desc',
      pageSize: 2,
      cursorId: 'anchor-book'
    });

    expect(sdk.getDoc).toHaveBeenCalledTimes(1);
    expect(sdk.doc).toHaveBeenCalledWith(expect.anything(), BOOKS_COLLECTION, 'anchor-book');
    expect(sdk.startAfter).toHaveBeenCalledTimes(1);
    expect(lastConstraints().map((constraint) => constraint.type)).toEqual([
      'orderBy',
      'startAfter',
      'limit'
    ]);
    expect(page.items.map((book) => book.id)).toEqual(['next-a', 'next-b']);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursorId).toBeNull();
  });

  it('reports hasMore with a next cursor when the scan overflows the page', async () => {
    sdk.getDoc.mockResolvedValue(documentSnapshot('anchor-book', true));
    // pageSize + 1 documents come back, which is how the gateway detects more.
    sdk.getDocs.mockResolvedValue(querySnapshot(['next-a', 'next-b', 'next-c']));

    const page = await gateway().listBooks({
      sortBy: 'bayesianRating',
      sortDirection: 'desc',
      pageSize: 2,
      cursorId: 'anchor-book'
    });

    expect(page.items.map((book) => book.id)).toEqual(['next-a', 'next-b']);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursorId).toBe('next-b');
  });

  it('does not read a cursor document when no cursor is supplied', async () => {
    sdk.getDocs.mockResolvedValue(querySnapshot([]));

    const page = await gateway().listBooks({ sortBy: 'title', sortDirection: 'asc' });

    expect(sdk.getDoc).not.toHaveBeenCalled();
    expect(sdk.startAfter).not.toHaveBeenCalled();
    expect(lastConstraints().map((constraint) => constraint.type)).toEqual(['orderBy', 'limit']);
    expect(page).toEqual({ items: [], nextCursorId: null, hasMore: false });
  });
});
