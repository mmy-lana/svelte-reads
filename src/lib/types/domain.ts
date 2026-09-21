export type ShelfStatus = 'want-to-read' | 'currently-reading' | 'read' | 'did-not-finish';

export interface TimestampContract {
  seconds: number;
  nanoseconds: number;
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
  readingGoal: {
    year: number;
    targetBooks: number;
    completedBooks: number;
  };
  stats: {
    reviewsCount: number;
    ratingsCount: number;
    booksReadCount: number;
    pagesReadTotal: number;
  };
  preferences: {
    allowSpoilersDefault: boolean;
    isProfilePrivate: boolean;
    notifyOnLikes: boolean;
    notifyOnComments: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

export interface Book {
  id: string;
  isbn13: string;
  isbn10: string;
  title: string;
  subtitle: string;
  authors: string[];
  publisher: string;
  publishedDate: string;
  description: string;
  pageCount: number;
  genres: string[];
  coverUrl: string;
  thumbnailUrl: string;
  language: string;
  averageRating: number;
  bayesianRating: number;
  ratingsCount: number;
  reviewsCount: number;
  ratingDistribution: {
    1: number;
    2: number;
    3: number;
    4: number;
    5: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface UserBookShelf {
  id: string;
  userId: string;
  bookId: string;
  bookTitle: string;
  bookAuthors: string[];
  bookCoverUrl: string;
  bookPageCount: number;
  status: ShelfStatus;
  rating: number;
  progressPages: number;
  progressPercentage: number;
  startedAt: string | null;
  finishedAt: string | null;
  reReadsCount: number;
  privateNotes: string;
  createdAt: string;
  updatedAt: string;
}

export interface Review {
  id: string;
  bookId: string;
  bookTitle: string;
  bookCoverUrl: string;
  userId: string;
  userDisplayName: string;
  userHandle: string;
  userAvatarUrl: string;
  rating: number;
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
  id: string;
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

export interface BookSearchFilters {
  query: string;
  genre: string;
  shelfStatus?: ShelfStatus;
  minRating: number;
  sortBy: 'bayesianRating' | 'ratingsCount' | 'publishedDate' | 'title';
  sortDirection: 'asc' | 'desc';
  page: number;
  limit: number;
}
