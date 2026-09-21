/**
 * Domain contracts for the Book Review Community Platform.
 *
 * These interfaces are the single source of truth for every Firestore document
 * shape, component prop, and utility signature in the application. All timestamps
 * are ISO 8601 strings so documents stay JSON-serialisable across the
 * SvelteKit server/client boundary.
 */

export type ShelfStatus = 'want-to-read' | 'currently-reading' | 'read' | 'did-not-finish';

/** Star tier used by the rating distribution histogram. */
export type RatingTier = 1 | 2 | 3 | 4 | 5;

/** Firestore timestamp projection, preserved for interop with raw documents. */
export interface TimestampContract {
  seconds: number;
  nanoseconds: number;
}

/** Count of ratings per star tier. Always keyed by every tier, never sparse. */
export interface RatingDistribution {
  1: number;
  2: number;
  3: number;
  4: number;
  5: number;
}

export interface ReadingGoal {
  year: number;
  targetBooks: number;
  completedBooks: number;
}

export interface UserStats {
  reviewsCount: number;
  ratingsCount: number;
  booksReadCount: number;
  pagesReadTotal: number;
}

export interface UserPreferences {
  allowSpoilersDefault: boolean;
  isProfilePrivate: boolean;
  notifyOnLikes: boolean;
  notifyOnComments: boolean;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  handle: string;
  avatarUrl: string;
  bio: string;
  location: string;
  website: string;
  readingGoal: ReadingGoal;
  stats: UserStats;
  preferences: UserPreferences;
  createdAt: string;
  updatedAt: string;
}

export interface Book {
  id: string; // ISBN-13 or normalized slug
  isbn13: string;
  isbn10: string;
  title: string;
  subtitle: string;
  authors: string[];
  publisher: string;
  publishedDate: string; // YYYY-MM-DD
  description: string;
  pageCount: number;
  genres: string[];
  coverUrl: string;
  thumbnailUrl: string;
  language: string;
  averageRating: number; // 0.00 to 5.00
  bayesianRating: number; // Weighted community score
  ratingsCount: number;
  reviewsCount: number;
  ratingDistribution: RatingDistribution;
  createdAt: string;
  updatedAt: string;
}

/** Fields required to materialise a shelf row without loading the full book document. */
export type ShelfBookSnapshot = Pick<
  Book,
  'id' | 'title' | 'authors' | 'coverUrl' | 'pageCount'
>;

/** Rating aggregates touched by a single rating mutation. */
export type BookRatingAggregates = Pick<
  Book,
  'averageRating' | 'bayesianRating' | 'ratingsCount' | 'ratingDistribution'
>;

export interface UserBookShelf {
  id: string; // Compound ID: `${uid}_${bookId}`
  userId: string;
  bookId: string;
  bookTitle: string;
  bookAuthors: string[];
  bookCoverUrl: string;
  bookPageCount: number;
  status: ShelfStatus;
  rating: number; // 0 if unrated, 0.5 - 5.0 in 0.5 increments
  progressPages: number;
  progressPercentage: number; // 0 to 100
  startedAt: string | null;
  finishedAt: string | null;
  reReadsCount: number;
  privateNotes: string;
  createdAt: string;
  updatedAt: string;
}

export interface Review {
  id: string; // Deterministic Compound ID: `${userId}_${bookId}` preventing duplicate reviews
  bookId: string;
  bookTitle: string;
  bookCoverUrl: string;
  userId: string;
  userDisplayName: string;
  userHandle: string;
  userAvatarUrl: string;
  rating: number; // 0.5 - 5.0
  title: string;
  content: string;
  containsSpoilers: boolean;
  likesCount: number;
  commentsCount: number;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ReviewLike {
  id: string; // Compound ID: `${reviewId}_${userId}`
  reviewId: string;
  userId: string;
  createdAt: string;
}

export interface ReviewComment {
  id: string;
  reviewId: string;
  userId: string;
  userDisplayName: string;
  userAvatarUrl: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export type BookSortField = 'bayesianRating' | 'ratingsCount' | 'publishedDate' | 'title';

export type SortDirection = 'asc' | 'desc';

export interface BookSearchFilters {
  query: string;
  genre: string;
  shelfStatus?: ShelfStatus;
  minRating: number;
  sortBy: BookSortField;
  sortDirection: SortDirection;
  page: number;
  limit: number;
}

/** Review feed ordering options surfaced on the book detail page. */
export type ReviewSortOption = 'newest' | 'highest-rated' | 'most-helpful';

/** Tab values for the shelf management route. */
export type ShelfTabValue = ShelfStatus | 'all';

/** Cursor-paginated payload returned by catalog and review queries. */
export interface CursorPage<T> {
  items: T[];
  /** Document id to pass as `startAfter` for the next page; null when exhausted. */
  nextCursorId: string | null;
  hasMore: boolean;
}

/** Draft produced by the review editor before persistence. */
export interface ReviewDraft {
  rating: number;
  title: string;
  content: string;
  containsSpoilers: boolean;
}

export const DEFAULT_BOOK_SEARCH_FILTERS: BookSearchFilters = {
  query: '',
  genre: '',
  minRating: 0,
  sortBy: 'bayesianRating',
  sortDirection: 'desc',
  page: 1,
  limit: 24
};
