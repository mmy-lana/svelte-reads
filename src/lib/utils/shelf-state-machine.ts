/**
 * Shelf transition state machine.
 *
 * Business invariants enforced here:
 *  - Starting a book stamps `startedAt`.
 *  - Completing a book stamps `finishedAt` and pins progress to 100%.
 *  - Returning a book to "Want to Read" clears all reading progress stamps.
 *  - Reaching the final page of a book automatically completes it.
 */
import type {
  ShelfBookSnapshot,
  ShelfStatus,
  ShelfTabValue,
  UserBookShelf
} from '$lib/types/domain';

export type ShelfAction =
  | { type: 'MOVE_TO_CURRENTLY_READING'; startedAt?: string }
  | { type: 'MOVE_TO_READ'; finishedAt?: string }
  | { type: 'MOVE_TO_WANT_TO_READ' }
  | { type: 'MOVE_TO_DNF'; privateNotes?: string }
  | { type: 'UPDATE_PROGRESS'; pagesRead: number };

export type ShelfActionType = ShelfAction['type'];

export const SHELF_STATUS_VALUES: readonly ShelfStatus[] = [
  'want-to-read',
  'currently-reading',
  'read',
  'did-not-finish'
];

/** Display labels used by badges, tabs, and the shelf selector. */
export const SHELF_STATUS_LABELS: Record<ShelfStatus, string> = {
  'want-to-read': 'Want to Read',
  'currently-reading': 'Currently Reading',
  read: 'Read',
  'did-not-finish': 'Did Not Finish'
};

/** Compact labels for constrained mobile surfaces (shelf selector trigger). */
export const SHELF_STATUS_SHORT_LABELS: Record<ShelfStatus, string> = {
  'want-to-read': 'Want to Read',
  'currently-reading': 'Reading',
  read: 'Finished',
  'did-not-finish': 'DNF'
};

/** Semantic colour tokens consumed by Badge/status pills. */
export const SHELF_STATUS_TONES: Record<ShelfStatus, 'sky' | 'amber' | 'emerald' | 'stone'> = {
  'want-to-read': 'sky',
  'currently-reading': 'amber',
  read: 'emerald',
  'did-not-finish': 'stone'
};

/** Tabs for the shelf management route, "All" first. */
export const SHELF_TABS: readonly { label: string; value: ShelfTabValue }[] = [
  { label: 'All', value: 'all' },
  { label: SHELF_STATUS_LABELS['currently-reading'], value: 'currently-reading' },
  { label: SHELF_STATUS_LABELS['want-to-read'], value: 'want-to-read' },
  { label: SHELF_STATUS_LABELS.read, value: 'read' },
  { label: SHELF_STATUS_LABELS['did-not-finish'], value: 'did-not-finish' }
];

export function isShelfStatus(value: unknown): value is ShelfStatus {
  return typeof value === 'string' && SHELF_STATUS_VALUES.includes(value as ShelfStatus);
}

/** Guarantees exhaustiveness: a new ShelfStatus fails compilation until handled. */
export function assertNever(value: never): never {
  throw new Error(`Unhandled shelf variant: ${JSON.stringify(value)}`);
}

/** Every status maps to exactly one transition action; a missing key fails compilation. */
const SHELF_ACTION_BY_STATUS: Record<ShelfStatus, ShelfActionType> = {
  'currently-reading': 'MOVE_TO_CURRENTLY_READING',
  read: 'MOVE_TO_READ',
  'want-to-read': 'MOVE_TO_WANT_TO_READ',
  'did-not-finish': 'MOVE_TO_DNF'
};

/** Maps a target shelf status onto the action that performs the transition. */
export function actionTypeForStatus(status: ShelfStatus): ShelfActionType {
  return SHELF_ACTION_BY_STATUS[status] ?? assertNever(status as never);
}

/** Builds the shelf action that moves a record to the requested status. */
export function shelfActionForStatus(status: ShelfStatus): ShelfAction {
  return { type: actionTypeForStatus(status) } as ShelfAction;
}

/** True when the requested status differs from the record's current status. */
export function isShelfTransitionNeeded(
  currentStatus: ShelfStatus | null | undefined,
  nextStatus: ShelfStatus
): boolean {
  return currentStatus !== nextStatus;
}

/** Timestamps are injected so transitions stay deterministic in tests. */
export interface ShelfClock {
  now(): string;
}

const systemClock: ShelfClock = {
  now: () => new Date().toISOString()
};

/**
 * Applies a shelf action and returns a new record. The input record is never
 * mutated, which lets callers keep an untouched copy for optimistic rollback.
 */
export function transitionShelfState(
  currentShelf: UserBookShelf,
  action: ShelfAction,
  clock: ShelfClock = systemClock
): UserBookShelf {
  const now = clock.now();
  const draft: UserBookShelf = { ...currentShelf, updatedAt: now };

  switch (action.type) {
    case 'MOVE_TO_CURRENTLY_READING':
      draft.status = 'currently-reading';
      draft.startedAt = action.startedAt || draft.startedAt || now;
      draft.finishedAt = null;
      break;

    case 'MOVE_TO_READ':
      draft.status = 'read';
      draft.finishedAt = action.finishedAt || now;
      draft.startedAt = draft.startedAt || now;
      draft.progressPages = draft.bookPageCount;
      draft.progressPercentage = 100;
      break;

    case 'MOVE_TO_WANT_TO_READ':
      draft.status = 'want-to-read';
      draft.startedAt = null;
      draft.finishedAt = null;
      draft.progressPages = 0;
      draft.progressPercentage = 0;
      break;

    case 'MOVE_TO_DNF':
      draft.status = 'did-not-finish';
      draft.finishedAt = now;
      if (action.privateNotes) {
        draft.privateNotes = action.privateNotes;
      }
      break;

    case 'UPDATE_PROGRESS': {
      const bounded = Math.max(0, Math.min(Math.trunc(action.pagesRead), draft.bookPageCount));
      draft.progressPages = bounded;
      draft.progressPercentage =
        draft.bookPageCount > 0 ? Math.round((bounded / draft.bookPageCount) * 100) : 0;
      if (draft.progressPercentage === 100) {
        draft.status = 'read';
        draft.finishedAt = draft.finishedAt || now;
        draft.startedAt = draft.startedAt || now;
      } else if (draft.status !== 'currently-reading') {
        draft.status = 'currently-reading';
        draft.startedAt = draft.startedAt || now;
        draft.finishedAt = null;
      }
      break;
    }

    default:
      return assertNever(action);
  }

  return draft;
}

/** Payload accepted by `createShelfRecord` — everything else is derived. */
export interface CreateShelfRecordInput {
  userId: string;
  book: ShelfBookSnapshot;
  status: ShelfStatus;
  rating?: number;
  clock?: ShelfClock;
}

/**
 * Materialises a brand new shelf row. The compound id and the status-dependent
 * timestamps are derived here so no caller can create an inconsistent record.
 */
export function createShelfRecord(input: CreateShelfRecordInput): UserBookShelf {
  const clock = input.clock ?? systemClock;
  const now = clock.now();
  const { userId, book, status } = input;

  return {
    id: `${userId}_${book.id}`,
    userId,
    bookId: book.id,
    bookTitle: book.title,
    bookAuthors: [...book.authors],
    bookCoverUrl: book.coverUrl,
    bookPageCount: book.pageCount,
    status,
    rating: input.rating ?? 0,
    progressPages: status === 'read' ? book.pageCount : 0,
    progressPercentage: status === 'read' ? 100 : 0,
    startedAt: status === 'currently-reading' || status === 'read' ? now : null,
    finishedAt: status === 'read' ? now : null,
    reReadsCount: 0,
    privateNotes: '',
    createdAt: now,
    updatedAt: now
  };
}

/**
 * Transitions an existing row to a new status, or creates it when the reader has
 * never shelved the book. This is the single entry point used by the shelf store.
 */
export function setShelfStatus(
  existing: UserBookShelf | undefined,
  input: CreateShelfRecordInput
): UserBookShelf {
  if (!existing) {
    return createShelfRecord(input);
  }
  return transitionShelfState(existing, shelfActionForStatus(input.status), input.clock);
}
