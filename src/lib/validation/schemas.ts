/**
 * Zod validation contracts for every writable domain document.
 *
 * `ValidationRules` is the shared numeric/textual source of truth: both the Zod
 * schemas below and the UI character counters read from it so limits can never
 * drift between a form and the persistence layer.
 */
import { z } from 'zod';
import type {
  Book,
  BookSearchFilters,
  RatingDistribution,
  Review,
  ReviewComment,
  ReviewDraft,
  ReviewLike,
  ShelfStatus,
  TimestampContract,
  UserBookShelf,
  UserProfile
} from '$lib/types/domain';

export const ValidationRules = {
  user: {
    handle: {
      regex: /^[a-zA-Z0-9_]{3,20}$/,
      message: 'Handle must be between 3 and 20 alphanumeric characters or underscores.'
    },
    displayName: {
      minLength: 2,
      maxLength: 50
    },
    bio: {
      maxLength: 500
    }
  },
  book: {
    isbn13: {
      regex: /^(978|979)\d{10}$/,
      message: 'Must be a valid 13-digit standard ISBN.'
    }
  },
  review: {
    rating: {
      min: 0.5,
      max: 5.0,
      step: 0.5
    },
    title: {
      minLength: 2,
      maxLength: 120
    },
    content: {
      minLength: 20,
      maxLength: 10000
    }
  },
  shelf: {
    progressPages: (pageCount: number) => ({
      min: 0,
      max: pageCount
    })
  }
} as const;

/** Uniform result shape for parse helpers so callers never need try/catch. */
export type ValidationResult<T> = { success: true; data: T } | { success: false; errors: string[] };

export const SHELF_STATUSES = [
  'want-to-read',
  'currently-reading',
  'read',
  'did-not-finish'
] as const satisfies readonly ShelfStatus[];

export const shelfStatusSchema = z.enum(SHELF_STATUSES);

export const ratingValueSchema = z
  .number()
  .min(ValidationRules.review.rating.min, 'Rating must be at least 0.5 stars.')
  .max(ValidationRules.review.rating.max, 'Rating must be at most 5 stars.')
  .refine((value) => Number.isInteger(value * 2), 'Rating must use whole or half star increments.');

export const timestampContractSchema: z.ZodType<TimestampContract> = z.object({
  seconds: z.number().int(),
  nanoseconds: z.number().int().min(0)
});

export const ratingDistributionSchema: z.ZodType<RatingDistribution> = z.object({
  1: z.number().int().min(0),
  2: z.number().int().min(0),
  3: z.number().int().min(0),
  4: z.number().int().min(0),
  5: z.number().int().min(0)
});

/** Accepts any ISO 8601 string that JavaScript can round-trip. */
export const isoDateStringSchema = z
  .string()
  .refine(
    (value) => value.trim().length > 0 && !Number.isNaN(new Date(value).getTime()),
    'Must be a valid ISO 8601 date string.'
  );

export const userProfileSchema: z.ZodType<UserProfile> = z.object({
  uid: z.string().min(1),
  email: z.email('Must be a valid email address.'),
  displayName: z
    .string()
    .min(ValidationRules.user.displayName.minLength, 'Display name is too short.')
    .max(ValidationRules.user.displayName.maxLength, 'Display name is too long.'),
  handle: z.string().regex(ValidationRules.user.handle.regex, ValidationRules.user.handle.message),
  avatarUrl: z.string(),
  bio: z.string().max(ValidationRules.user.bio.maxLength, 'Bio must be 500 characters or fewer.'),
  location: z.string().max(120),
  website: z.string().max(300),
  readingGoal: z.object({
    year: z.number().int().min(1900).max(9999),
    targetBooks: z.number().int().min(0).max(10000),
    completedBooks: z.number().int().min(0).max(10000)
  }),
  stats: z.object({
    reviewsCount: z.number().int().min(0),
    ratingsCount: z.number().int().min(0),
    booksReadCount: z.number().int().min(0),
    pagesReadTotal: z.number().int().min(0)
  }),
  preferences: z.object({
    allowSpoilersDefault: z.boolean(),
    isProfilePrivate: z.boolean(),
    notifyOnLikes: z.boolean(),
    notifyOnComments: z.boolean()
  }),
  createdAt: isoDateStringSchema,
  updatedAt: isoDateStringSchema
});

export const bookSchema: z.ZodType<Book> = z.object({
  id: z.string().min(1),
  isbn13: z
    .string()
    .regex(ValidationRules.book.isbn13.regex, ValidationRules.book.isbn13.message),
  isbn10: z.string(),
  title: z.string().min(1),
  subtitle: z.string(),
  authors: z.array(z.string().min(1)).min(1, 'At least one author is required.'),
  publisher: z.string(),
  publishedDate: z.string(),
  description: z.string(),
  pageCount: z.number().int().min(0),
  genres: z.array(z.string().min(1)),
  coverUrl: z.string(),
  thumbnailUrl: z.string(),
  language: z.string().min(2),
  averageRating: z.number().min(0).max(5),
  bayesianRating: z.number().min(0).max(5),
  ratingsCount: z.number().int().min(0),
  reviewsCount: z.number().int().min(0),
  ratingDistribution: ratingDistributionSchema,
  createdAt: isoDateStringSchema,
  updatedAt: isoDateStringSchema
});

export const userBookShelfSchema: z.ZodType<UserBookShelf> = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  bookId: z.string().min(1),
  bookTitle: z.string().min(1),
  bookAuthors: z.array(z.string()),
  bookCoverUrl: z.string(),
  bookPageCount: z.number().int().min(0),
  status: shelfStatusSchema,
  rating: z.number().min(0).max(5),
  progressPages: z.number().int().min(0),
  progressPercentage: z.number().min(0).max(100),
  startedAt: isoDateStringSchema.nullable(),
  finishedAt: isoDateStringSchema.nullable(),
  reReadsCount: z.number().int().min(0),
  privateNotes: z.string().max(2000),
  createdAt: isoDateStringSchema,
  updatedAt: isoDateStringSchema
});

export const reviewSchema: z.ZodType<Review> = z.object({
  id: z.string().min(1),
  bookId: z.string().min(1),
  bookTitle: z.string().min(1),
  bookCoverUrl: z.string(),
  userId: z.string().min(1),
  userDisplayName: z.string().min(1),
  userHandle: z.string().min(1),
  userAvatarUrl: z.string(),
  rating: ratingValueSchema,
  title: z
    .string()
    .min(ValidationRules.review.title.minLength)
    .max(ValidationRules.review.title.maxLength),
  content: z
    .string()
    .min(ValidationRules.review.content.minLength)
    .max(ValidationRules.review.content.maxLength),
  containsSpoilers: z.boolean(),
  likesCount: z.number().int().min(0),
  commentsCount: z.number().int().min(0),
  tags: z.array(z.string()),
  createdAt: isoDateStringSchema,
  updatedAt: isoDateStringSchema
});

export const reviewDraftSchema: z.ZodType<ReviewDraft> = z.object({
  rating: ratingValueSchema,
  title: z
    .string()
    .trim()
    .min(ValidationRules.review.title.minLength, 'Headline must be at least 2 characters.')
    .max(ValidationRules.review.title.maxLength, 'Headline must be 120 characters or fewer.'),
  content: z
    .string()
    .trim()
    .min(ValidationRules.review.content.minLength, 'Review must be at least 20 characters.')
    .max(ValidationRules.review.content.maxLength, 'Review must be 10,000 characters or fewer.'),
  containsSpoilers: z.boolean()
});

export const reviewCommentSchema: z.ZodType<ReviewComment> = z.object({
  id: z.string().min(1),
  reviewId: z.string().min(1),
  userId: z.string().min(1),
  userDisplayName: z.string().min(1),
  userAvatarUrl: z.string(),
  content: z.string().min(1).max(2000),
  createdAt: isoDateStringSchema,
  updatedAt: isoDateStringSchema
});

export const reviewLikeSchema: z.ZodType<ReviewLike> = z.object({
  id: z.string().min(1),
  reviewId: z.string().min(1),
  userId: z.string().min(1),
  createdAt: isoDateStringSchema
});

export const bookSearchFiltersSchema: z.ZodType<BookSearchFilters> = z.object({
  query: z.string().max(200),
  genre: z.string().max(80),
  shelfStatus: shelfStatusSchema.optional(),
  minRating: z.number().min(0).max(5),
  sortBy: z.enum(['bayesianRating', 'ratingsCount', 'publishedDate', 'title']),
  sortDirection: z.enum(['asc', 'desc']),
  page: z.number().int().min(1),
  limit: z.number().int().min(1).max(48)
});

export const shelfProgressUpdateSchema = z.object({
  progressPages: z.number().int().min(0)
});

export function validateRating(val: number): boolean {
  return val >= 0.5 && val <= 5.0 && (val * 2) % 1 === 0;
}

export function validateProgress(
  current: number,
  total: number
): { valid: boolean; percentage: number } {
  const boundedCurrent = Math.max(0, Math.min(current, total));
  const percentage = total > 0 ? Math.round((boundedCurrent / total) * 100) : 0;
  return {
    valid: current >= 0 && current <= total,
    percentage
  };
}

/** ISBN-13 checksum (modulus 10, alternating weights 1 and 3). */
export function isValidIsbn13(value: string): boolean {
  const digits = value.replace(/[-\s]/g, '');
  if (!ValidationRules.book.isbn13.regex.test(digits)) return false;

  let sum = 0;
  for (let index = 0; index < 12; index += 1) {
    const digit = Number.parseInt(digits[index] ?? '0', 10);
    sum += index % 2 === 0 ? digit : digit * 3;
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  return checkDigit === Number.parseInt(digits[12] ?? '-1', 10);
}

/** Normalises free-form input into a handle that satisfies the handle contract. */
export function normalizeHandle(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 20);
}

/** Flattens a Zod error into human readable, field-prefixed messages. */
export function formatValidationIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join('.');
    return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
  });
}

function toResult<T>(parsed: z.ZodSafeParseResult<T>): ValidationResult<T> {
  if (parsed.success) {
    return { success: true, data: parsed.data };
  }
  return { success: false, errors: formatValidationIssues(parsed.error) };
}

export function parseUserProfile(input: unknown): ValidationResult<UserProfile> {
  return toResult(userProfileSchema.safeParse(input));
}

export function parseBook(input: unknown): ValidationResult<Book> {
  return toResult(bookSchema.safeParse(input));
}

export function parseUserBookShelf(input: unknown): ValidationResult<UserBookShelf> {
  return toResult(userBookShelfSchema.safeParse(input));
}

export function parseReview(input: unknown): ValidationResult<Review> {
  return toResult(reviewSchema.safeParse(input));
}

export function parseReviewDraft(input: unknown): ValidationResult<ReviewDraft> {
  return toResult(reviewDraftSchema.safeParse(input));
}

export function parseBookSearchFilters(input: unknown): ValidationResult<BookSearchFilters> {
  return toResult(bookSearchFiltersSchema.safeParse(input));
}

/** Validates a shelf row against its own page-count invariant. */
export function validateShelfProgressRecord(
  shelf: Pick<UserBookShelf, 'progressPages' | 'progressPercentage' | 'bookPageCount'>
): ValidationResult<{ progressPages: number; progressPercentage: number }> {
  const { progressPages, bookPageCount } = shelf;
  const { valid, percentage } = validateProgress(progressPages, bookPageCount);

  if (!valid) {
    return {
      success: false,
      errors: [`progressPages must be between 0 and ${bookPageCount} pages.`]
    };
  }
  if (percentage !== shelf.progressPercentage) {
    return {
      success: false,
      errors: [
        `progressPercentage is ${shelf.progressPercentage}% but ${progressPages}/${bookPageCount} pages equals ${percentage}%.`
      ]
    };
  }
  return { success: true, data: { progressPages, progressPercentage: percentage } };
}
