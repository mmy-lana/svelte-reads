import { describe, expect, it } from 'vitest';
import {
  assertNever,
  createShelfRecord,
  isShelfStatus,
  isShelfTransitionNeeded,
  setShelfStatus,
  SHELF_STATUS_LABELS,
  SHELF_STATUS_SHORT_LABELS,
  SHELF_STATUS_TONES,
  SHELF_STATUS_VALUES,
  SHELF_TABS,
  actionTypeForStatus,
  shelfActionForStatus,
  transitionShelfState,
  type ShelfAction,
  type ShelfClock
} from '$lib/utils/shelf-state-machine';
import type { ShelfBookSnapshot, ShelfStatus, UserBookShelf } from '$lib/types/domain';

const NOW = '2026-01-15T10:00:00.000Z';
const LATER = '2026-02-01T08:30:00.000Z';

const clock: ShelfClock = { now: () => NOW };

const book: ShelfBookSnapshot = {
  id: '9780143127741',
  title: 'East of Eden',
  authors: ['John Steinbeck'],
  coverUrl: 'https://covers.openlibrary.org/b/isbn/9780143127741-L.jpg',
  pageCount: 601
};

function makeShelf(status: ShelfStatus = 'want-to-read', overrides: Partial<UserBookShelf> = {}): UserBookShelf {
  return { ...createShelfRecord({ userId: 'reader-1', book, status, clock }), ...overrides };
}

describe('createShelfRecord', () => {
  it('derives the compound id and zeroed progress for an unstarted book', () => {
    const shelf = makeShelf('want-to-read');
    expect(shelf.id).toBe('reader-1_9780143127741');
    expect(shelf.userId).toBe('reader-1');
    expect(shelf.bookId).toBe('9780143127741');
    expect(shelf.bookTitle).toBe('East of Eden');
    expect(shelf.bookAuthors).toEqual(['John Steinbeck']);
    expect(shelf.progressPages).toBe(0);
    expect(shelf.progressPercentage).toBe(0);
    expect(shelf.startedAt).toBeNull();
    expect(shelf.finishedAt).toBeNull();
    expect(shelf.rating).toBe(0);
    expect(shelf.reReadsCount).toBe(0);
    expect(shelf.createdAt).toBe(NOW);
    expect(shelf.updatedAt).toBe(NOW);
  });

  it('stamps startedAt when the reader is already reading', () => {
    const shelf = makeShelf('currently-reading');
    expect(shelf.startedAt).toBe(NOW);
    expect(shelf.finishedAt).toBeNull();
    expect(shelf.progressPages).toBe(0);
  });

  it('pins progress to 100% for a finished book', () => {
    const shelf = makeShelf('read');
    expect(shelf.progressPages).toBe(601);
    expect(shelf.progressPercentage).toBe(100);
    expect(shelf.startedAt).toBe(NOW);
    expect(shelf.finishedAt).toBe(NOW);
  });

  it('keeps a DNF book without a finish stamp until the transition runs', () => {
    const shelf = makeShelf('did-not-finish');
    expect(shelf.status).toBe('did-not-finish');
    expect(shelf.finishedAt).toBeNull();
    expect(shelf.progressPages).toBe(0);
  });

  it('carries an optional rating supplied at creation time', () => {
    const shelf = createShelfRecord({ userId: 'reader-1', book, status: 'read', rating: 4.5, clock });
    expect(shelf.rating).toBe(4.5);
  });
});

describe('transitionShelfState', () => {
  it('never mutates the record it was given', () => {
    const original = makeShelf('want-to-read');
    const snapshot = { ...original };
    transitionShelfState(original, { type: 'MOVE_TO_READ' }, { now: () => LATER });
    expect(original).toEqual(snapshot);
  });

  it('starts a book and clears a stale finish stamp', () => {
    const finished = makeShelf('read');
    const started = transitionShelfState(
      finished,
      { type: 'MOVE_TO_CURRENTLY_READING' },
      { now: () => LATER }
    );

    expect(started.status).toBe('currently-reading');
    expect(started.startedAt).toBe(NOW);
    expect(started.finishedAt).toBeNull();
    expect(started.updatedAt).toBe(LATER);
  });

  it('honours an explicit startedAt when back-dating a read', () => {
    const started = transitionShelfState(
      makeShelf('want-to-read'),
      { type: 'MOVE_TO_CURRENTLY_READING', startedAt: '2025-12-01T00:00:00.000Z' },
      { now: () => LATER }
    );
    expect(started.startedAt).toBe('2025-12-01T00:00:00.000Z');
  });

  it('completes a book with a finish stamp and full progress', () => {
    const reading = makeShelf('currently-reading', { progressPages: 120, progressPercentage: 20 });
    const finished = transitionShelfState(reading, { type: 'MOVE_TO_READ' }, { now: () => LATER });

    expect(finished.status).toBe('read');
    expect(finished.progressPages).toBe(601);
    expect(finished.progressPercentage).toBe(100);
    expect(finished.finishedAt).toBe(LATER);
    expect(finished.startedAt).toBe(NOW);
  });

  it('accepts an explicit finish date', () => {
    const finished = transitionShelfState(
      makeShelf('currently-reading'),
      { type: 'MOVE_TO_READ', finishedAt: '2025-12-25T00:00:00.000Z' },
      { now: () => LATER }
    );
    expect(finished.finishedAt).toBe('2025-12-25T00:00:00.000Z');
  });

  it('resets all progress when returning a finished book to want-to-read', () => {
    const reset = transitionShelfState(makeShelf('read'), { type: 'MOVE_TO_WANT_TO_READ' }, { now: () => LATER });

    expect(reset.status).toBe('want-to-read');
    expect(reset.progressPages).toBe(0);
    expect(reset.progressPercentage).toBe(0);
    expect(reset.startedAt).toBeNull();
    expect(reset.finishedAt).toBeNull();
  });

  it('keeps reading progress when a book is abandoned', () => {
    const reading = makeShelf('currently-reading', { progressPages: 200, progressPercentage: 33 });
    const abandoned = transitionShelfState(
      reading,
      { type: 'MOVE_TO_DNF', privateNotes: 'Lost the thread at the halfway mark.' },
      { now: () => LATER }
    );

    expect(abandoned.status).toBe('did-not-finish');
    expect(abandoned.progressPages).toBe(200);
    expect(abandoned.progressPercentage).toBe(33);
    expect(abandoned.finishedAt).toBe(LATER);
    expect(abandoned.privateNotes).toBe('Lost the thread at the halfway mark.');
  });

  it('leaves private notes untouched when none are supplied', () => {
    const reading = makeShelf('currently-reading', { privateNotes: 'Keep this note.' });
    const abandoned = transitionShelfState(reading, { type: 'MOVE_TO_DNF' }, { now: () => LATER });
    expect(abandoned.privateNotes).toBe('Keep this note.');
  });

  it('records progress and starts the book on the first page update', () => {
    const updated = transitionShelfState(
      makeShelf('want-to-read'),
      { type: 'UPDATE_PROGRESS', pagesRead: 120 },
      { now: () => LATER }
    );

    expect(updated.status).toBe('currently-reading');
    expect(updated.progressPages).toBe(120);
    expect(updated.progressPercentage).toBe(20);
    expect(updated.startedAt).toBe(LATER);
    expect(updated.finishedAt).toBeNull();
  });

  it('auto-completes a book that reaches the final page', () => {
    const updated = transitionShelfState(
      makeShelf('currently-reading'),
      { type: 'UPDATE_PROGRESS', pagesRead: 601 },
      { now: () => LATER }
    );

    expect(updated.status).toBe('read');
    expect(updated.progressPercentage).toBe(100);
    expect(updated.finishedAt).toBe(LATER);
  });

  it('clamps out-of-range page updates', () => {
    const beyond = transitionShelfState(
      makeShelf('currently-reading'),
      { type: 'UPDATE_PROGRESS', pagesRead: 5000 },
      { now: () => LATER }
    );
    expect(beyond.progressPages).toBe(601);
    expect(beyond.status).toBe('read');

    const negative = transitionShelfState(
      makeShelf('currently-reading'),
      { type: 'UPDATE_PROGRESS', pagesRead: -40 },
      { now: () => LATER }
    );
    expect(negative.progressPages).toBe(0);
    expect(negative.progressPercentage).toBe(0);
  });

  it('truncates fractional page counts', () => {
    const updated = transitionShelfState(
      makeShelf('currently-reading'),
      { type: 'UPDATE_PROGRESS', pagesRead: 60.7 },
      { now: () => LATER }
    );
    expect(updated.progressPages).toBe(60);
    expect(updated.progressPercentage).toBe(10);
  });

  it('handles books without a page count', () => {
    const pageless = createShelfRecord({
      userId: 'reader-1',
      book: { ...book, pageCount: 0 },
      status: 'currently-reading',
      clock
    });
    const updated = transitionShelfState(pageless, { type: 'UPDATE_PROGRESS', pagesRead: 10 }, { now: () => LATER });
    expect(updated.progressPages).toBe(0);
    expect(updated.progressPercentage).toBe(0);
    expect(updated.status).toBe('currently-reading');
  });

  it('keeps an already finished book finished on further progress updates', () => {
    const finished = makeShelf('read');
    const updated = transitionShelfState(finished, { type: 'UPDATE_PROGRESS', pagesRead: 601 }, { now: () => LATER });
    expect(updated.status).toBe('read');
    expect(updated.finishedAt).toBe(NOW);
  });
});

describe('shelf status helpers', () => {
  it('exposes every status with labels and semantic tones', () => {
    for (const status of SHELF_STATUS_VALUES) {
      expect(SHELF_STATUS_LABELS[status]).toBeTruthy();
      expect(SHELF_STATUS_SHORT_LABELS[status]).toBeTruthy();
      expect(SHELF_STATUS_TONES[status]).toBeTruthy();
    }
    expect(SHELF_STATUS_VALUES).toHaveLength(4);
  });

  it('lists the shelf tabs with an "All" entry first', () => {
    expect(SHELF_TABS).toHaveLength(5);
    expect(SHELF_TABS[0]).toEqual({ label: 'All', value: 'all' });
    expect(SHELF_TABS.map((tab) => tab.value)).toEqual([
      'all',
      'currently-reading',
      'want-to-read',
      'read',
      'did-not-finish'
    ]);
  });

  it('narrows unknown values', () => {
    expect(isShelfStatus('read')).toBe(true);
    expect(isShelfStatus('reading')).toBe(false);
    expect(isShelfStatus(undefined)).toBe(false);
    expect(isShelfStatus(3)).toBe(false);
  });

  it('maps statuses onto their transition actions', () => {
    expect(actionTypeForStatus('currently-reading')).toBe('MOVE_TO_CURRENTLY_READING');
    expect(actionTypeForStatus('read')).toBe('MOVE_TO_READ');
    expect(actionTypeForStatus('want-to-read')).toBe('MOVE_TO_WANT_TO_READ');
    expect(actionTypeForStatus('did-not-finish')).toBe('MOVE_TO_DNF');
    expect(shelfActionForStatus('read')).toEqual({ type: 'MOVE_TO_READ' });
  });

  it('detects when a transition is required', () => {
    expect(isShelfTransitionNeeded(null, 'read')).toBe(true);
    expect(isShelfTransitionNeeded(undefined, 'read')).toBe(true);
    expect(isShelfTransitionNeeded('read', 'read')).toBe(false);
    expect(isShelfTransitionNeeded('want-to-read', 'read')).toBe(true);
  });

  it('throws on unreachable variants', () => {
    expect(() => assertNever('impossible' as never)).toThrow('Unhandled shelf variant');
  });
});

describe('setShelfStatus', () => {
  it('creates a record when the reader has never shelved the book', () => {
    const created = setShelfStatus(undefined, {
      userId: 'reader-1',
      book,
      status: 'currently-reading',
      clock
    });
    expect(created.status).toBe('currently-reading');
    expect(created.startedAt).toBe(NOW);
  });

  it('transitions an existing record in place', () => {
    const existing = makeShelf('want-to-read');
    const moved = setShelfStatus(existing, {
      userId: 'reader-1',
      book,
      status: 'read',
      clock: { now: () => LATER }
    });
    expect(moved.status).toBe('read');
    expect(moved.progressPercentage).toBe(100);
    expect(moved.createdAt).toBe(NOW);
    expect(moved.updatedAt).toBe(LATER);
  });

  it('is idempotent when the requested status is already active', () => {
    const existing = makeShelf('read');
    const again = setShelfStatus(existing, { userId: 'reader-1', book, status: 'read', clock: { now: () => LATER } });
    expect(again.status).toBe('read');
    expect(again.progressPages).toBe(601);
    expect(again.finishedAt).toBe(LATER);
  });

  it('applies an unknown-to-known transition sequence without leaking state', () => {
    const sequence: ShelfAction[] = [
      { type: 'MOVE_TO_CURRENTLY_READING' },
      { type: 'UPDATE_PROGRESS', pagesRead: 300 },
      { type: 'MOVE_TO_DNF', privateNotes: 'Paused.' },
      { type: 'MOVE_TO_WANT_TO_READ' },
      { type: 'MOVE_TO_READ' }
    ];

    const final = sequence.reduce(
      (record, action) => transitionShelfState(record, action, { now: () => LATER }),
      makeShelf('want-to-read')
    );

    expect(final.status).toBe('read');
    expect(final.progressPercentage).toBe(100);
    expect(final.progressPages).toBe(601);
    expect(final.startedAt).toBe(LATER);
    expect(final.finishedAt).toBe(LATER);
  });
});
