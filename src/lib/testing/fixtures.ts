/**
 * Deterministic fixtures shared by the state-layer test suites.
 *
 * These build complete domain objects — no partial casts — so a schema change
 * breaks the tests at the type boundary rather than producing silently
 * incomplete data.
 */
import type {
  Book,
  RatingDistribution,
  Review,
  ReviewDraft,
  UserBookShelf,
  UserProfile,
  ShelfStatus
} from '$lib/types/domain';
import type { AuthUser } from '$lib/state/auth.svelte';

export const FIXED_NOW = '2025-02-14T09:30:00.000Z';

export function makeDistribution(overrides: Partial<RatingDistribution> = {}): RatingDistribution {
  return { 1: 4, 2: 9, 3: 42, 4: 180, 5: 265, ...overrides };
}

export function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    id: 'book-steinbeck',
    isbn13: '9780140187394',
    isbn10: '0140187397',
    title: 'East of Eden',
    subtitle: '',
    authors: ['John Steinbeck'],
    publisher: 'Penguin Classics',
    publishedDate: '1952-09-19',
    description: 'A retelling of Cain and Abel set in the Salinas Valley.',
    pageCount: 601,
    genres: ['Classics', 'Fiction'],
    coverUrl: 'https://covers.openlibrary.org/b/isbn/9780140187394-L.jpg',
    thumbnailUrl: 'https://covers.openlibrary.org/b/isbn/9780140187394-M.jpg',
    language: 'English',
    averageRating: 4.36,
    bayesianRating: 4.31,
    ratingsCount: 500,
    reviewsCount: 42,
    ratingDistribution: makeDistribution(),
    createdAt: '2024-01-02T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
    ...overrides
  };
}

export function makeUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    uid: 'reader-1',
    email: 'reader@example.test',
    displayName: 'Ada Lovelace',
    photoURL: '',
    ...overrides
  };
}

export function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    uid: 'reader-1',
    email: 'reader@example.test',
    displayName: 'Ada Lovelace',
    handle: 'ada_lovelace',
    avatarUrl: '',
    bio: '',
    location: '',
    website: '',
    readingGoal: { year: 2025, targetBooks: 24, completedBooks: 3 },
    stats: { reviewsCount: 2, ratingsCount: 5, booksReadCount: 3, pagesReadTotal: 1200 },
    preferences: {
      allowSpoilersDefault: false,
      isProfilePrivate: false,
      notifyOnLikes: true,
      notifyOnComments: true
    },
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides
  };
}

export function makeShelfRecord(overrides: Partial<UserBookShelf> = {}): UserBookShelf {
  return {
    id: 'reader-1_book-steinbeck',
    userId: 'reader-1',
    bookId: 'book-steinbeck',
    bookTitle: 'East of Eden',
    bookAuthors: ['John Steinbeck'],
    bookCoverUrl: '',
    bookPageCount: 601,
    status: 'currently-reading',
    rating: 0,
    progressPages: 120,
    progressPercentage: 20,
    startedAt: '2025-02-01T00:00:00.000Z',
    finishedAt: null,
    reReadsCount: 0,
    privateNotes: '',
    createdAt: '2025-02-01T00:00:00.000Z',
    updatedAt: '2025-02-10T00:00:00.000Z',
    ...overrides
  };
}

export function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    id: 'reader-1_book-steinbeck',
    bookId: 'book-steinbeck',
    bookTitle: 'East of Eden',
    bookCoverUrl: '',
    userId: 'reader-1',
    userDisplayName: 'Ada Lovelace',
    userHandle: 'ada_lovelace',
    userAvatarUrl: '',
    rating: 5,
    title: 'A patient, devastating book',
    content: 'The prose earns every one of its six hundred pages.',
    containsSpoilers: false,
    likesCount: 0,
    commentsCount: 0,
    tags: [],
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides
  };
}

export function makeDraft(overrides: Partial<ReviewDraft> = {}): ReviewDraft {
  return {
    rating: 5,
    title: 'A patient, devastating book',
    content: 'The prose earns every one of its six hundred pages.',
    containsSpoilers: false,
    ...overrides
  };
}

export function makeShelfStatusRecord(
  bookId: string,
  status: ShelfStatus,
  overrides: Partial<UserBookShelf> = {}
): UserBookShelf {
  return makeShelfRecord({ bookId, status, ...overrides });
}
