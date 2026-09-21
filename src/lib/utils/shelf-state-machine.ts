import type { UserBookShelf } from '$lib/types/domain';

export type ShelfAction =
  | { type: 'MOVE_TO_CURRENTLY_READING'; startedAt?: string }
  | { type: 'MOVE_TO_READ'; finishedAt?: string }
  | { type: 'MOVE_TO_WANT_TO_READ' }
  | { type: 'MOVE_TO_DNF'; privateNotes?: string }
  | { type: 'UPDATE_PROGRESS'; pagesRead: number };

export function transitionShelfState(
  currentShelf: UserBookShelf,
  action: ShelfAction
): UserBookShelf {
  const now = new Date().toISOString();
  const draft = { ...currentShelf, updatedAt: now };

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

    case 'UPDATE_PROGRESS':
      const bounded = Math.max(0, Math.min(action.pagesRead, draft.bookPageCount));
      draft.progressPages = bounded;
      draft.progressPercentage =
        draft.bookPageCount > 0 ? Math.round((bounded / draft.bookPageCount) * 100) : 0;
      if (draft.progressPercentage === 100) {
        draft.status = 'read';
        draft.finishedAt = draft.finishedAt || now;
      } else if (draft.status !== 'currently-reading') {
        draft.status = 'currently-reading';
        draft.startedAt = draft.startedAt || now;
      }
      break;
  }

  return draft;
}
