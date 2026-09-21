import { describe, expect, it } from 'vitest';
import {
  bookSchema,
  bookSearchFiltersSchema,
  formatValidationIssues,
  HTTP_URL_SCHEME_REGEX,
  isValidIsbn13,
  normalizeHandle,
  parseBook,
  parseBookSearchFilters,
  parseReviewDraft,
  parseUserBookShelf,
  parseUserProfile,
  ratingValueSchema,
  reviewDraftSchema,
  shelfStatusSchema,
  userBookShelfSchema,
  userProfileSchema,
  ValidationRules,
  validateProgress,
  validateRating,
  validateShelfProgressRecord
} from '$lib/validation/schemas';
import { emptyRatingDistribution } from '$lib/utils/ratings';
import type { Book, UserBookShelf, UserProfile } from '$lib/types/domain';

const NOW = '2026-01-15T10:00:00.000Z';

const validProfile: UserProfile = {
  uid: 'reader-1',
  email: 'reader@example.com',
  displayName: 'Ada Reader',
  handle: 'ada_reader',
  avatarUrl: 'https://example.com/avatar.png',
  bio: 'Reads two books a week.',
  location: 'Lisbon',
  website: 'https://example.com',
  readingGoal: { year: 2026, targetBooks: 52, completedBooks: 4 },
  stats: { reviewsCount: 3, ratingsCount: 12, booksReadCount: 12, pagesReadTotal: 4200 },
  preferences: {
    allowSpoilersDefault: false,
    isProfilePrivate: false,
    notifyOnLikes: true,
    notifyOnComments: true
  },
  createdAt: NOW,
  updatedAt: NOW
};

const validBook: Book = {
  id: '9780143127741',
  isbn13: '9780143127741',
  isbn10: '0143127748',
  title: 'East of Eden',
  subtitle: '',
  authors: ['John Steinbeck'],
  publisher: 'Penguin Classics',
  publishedDate: '2002-06-25',
  description: 'A retelling of Genesis set in the Salinas Valley.',
  pageCount: 601,
  genres: ['Classics', 'Fiction'],
  coverUrl: 'https://covers.openlibrary.org/b/isbn/9780143127741-L.jpg',
  thumbnailUrl: 'https://covers.openlibrary.org/b/isbn/9780143127741-M.jpg',
  language: 'en',
  averageRating: 4.38,
  bayesianRating: 4.32,
  ratingsCount: 1200,
  reviewsCount: 84,
  ratingDistribution: { 1: 12, 2: 24, 3: 120, 4: 420, 5: 624 },
  createdAt: NOW,
  updatedAt: NOW
};

const validShelf: UserBookShelf = {
  id: 'reader-1_9780143127741',
  userId: 'reader-1',
  bookId: '9780143127741',
  bookTitle: 'East of Eden',
  bookAuthors: ['John Steinbeck'],
  bookCoverUrl: validBook.coverUrl,
  bookPageCount: 601,
  status: 'currently-reading',
  rating: 0,
  progressPages: 120,
  progressPercentage: 20,
  startedAt: NOW,
  finishedAt: null,
  reReadsCount: 0,
  privateNotes: '',
  createdAt: NOW,
  updatedAt: NOW
};

describe('validateRating', () => {
  it('accepts whole and half star values inside the domain', () => {
    for (const value of [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]) {
      expect(validateRating(value)).toBe(true);
    }
  });

  it('rejects values outside the domain or between increments', () => {
    for (const value of [0, 0.25, 4.3, 5.5, -1, Number.NaN]) {
      expect(validateRating(value)).toBe(false);
    }
  });
});

describe('validateProgress', () => {
  it('computes a rounded percentage for valid progress', () => {
    expect(validateProgress(120, 601)).toEqual({ valid: true, percentage: 20 });
    expect(validateProgress(300, 601)).toEqual({ valid: true, percentage: 50 });
    expect(validateProgress(601, 601)).toEqual({ valid: true, percentage: 100 });
  });

  it('flags out-of-range progress while still reporting a bounded percentage', () => {
    expect(validateProgress(700, 601)).toEqual({ valid: false, percentage: 100 });
    expect(validateProgress(-5, 601)).toEqual({ valid: false, percentage: 0 });
  });

  it('avoids division by zero for pageless records', () => {
    expect(validateProgress(0, 0)).toEqual({ valid: true, percentage: 0 });
    expect(validateProgress(10, 0)).toEqual({ valid: false, percentage: 0 });
  });
});

describe('isValidIsbn13', () => {
  it('accepts real ISBN-13 values with a correct check digit', () => {
    expect(isValidIsbn13('9780143127741')).toBe(true);
    expect(isValidIsbn13('978-0-14-312774-1')).toBe(true);
    expect(isValidIsbn13('9780743273565')).toBe(true);
  });

  it('rejects a wrong check digit and malformed prefixes', () => {
    expect(isValidIsbn13('9780143127742')).toBe(false);
    expect(isValidIsbn13('1234567890123')).toBe(false);
    expect(isValidIsbn13('978014312774')).toBe(false);
  });
});

describe('userProfileSchema', () => {
  it('accepts a complete profile', () => {
    const result = parseUserProfile(validProfile);
    expect(result.success).toBe(true);
  });

  it('rejects an invalid handle with the shared rule message', () => {
    const result = parseUserProfile({ ...validProfile, handle: 'ab' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((error) => error.includes('Handle must be between 3 and 20'))).toBe(true);
    }
  });

  it('rejects a malformed email address', () => {
    const result = parseUserProfile({ ...validProfile, email: 'not-an-email' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.join(' ')).toContain('email');
    }
  });

  it('enforces the bio length ceiling', () => {
    const result = parseUserProfile({
      ...validProfile,
      bio: 'x'.repeat(ValidationRules.user.bio.maxLength + 1)
    });
    expect(result.success).toBe(false);
  });

  it('rejects a profile missing nested preference fields', () => {
    const result = parseUserProfile({
      ...validProfile,
      preferences: { allowSpoilersDefault: false, isProfilePrivate: false }
    });
    expect(result.success).toBe(false);
  });
});

// SEC-05: profile URLs are rendered into href/src attributes, so the protocol
// scheme is a stored-XSS boundary and only http(s) may survive validation.
describe('userProfileSchema URL scheme validation (SEC-05)', () => {
  const maliciousUrls = [
    'javascript:alert(1)',
    'JavaScript:alert(document.cookie)',
    ' javascript:alert(1)',
    'jav&#x09;ascript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    'data:image/svg+xml,<svg onload=alert(1)>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'about:blank',
    'blob:https://example.com/8f0c1f6e',
    '//example.com/protocol-relative',
    'ftp://example.com/avatar.png',
    'example.com/avatar.png'
  ];

  it.each(maliciousUrls)('rejects %s as a website', (url) => {
    const result = parseUserProfile({ ...validProfile, website: url });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.join(' ')).toContain('http:// or https://');
    }
  });

  it.each(maliciousUrls)('rejects %s as an avatarUrl', (url) => {
    const result = parseUserProfile({ ...validProfile, avatarUrl: url });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.join(' ')).toContain('http:// or https://');
    }
  });

  it('accepts http and https URLs regardless of case', () => {
    for (const url of [
      'http://example.com',
      'https://example.com/reader?tab=reviews#top',
      'HTTPS://Example.com/Avatar.PNG',
      'https://covers.openlibrary.org/b/isbn/9780143127741-L.jpg'
    ]) {
      expect(userProfileSchema.safeParse({ ...validProfile, website: url }).success).toBe(true);
      expect(userProfileSchema.safeParse({ ...validProfile, avatarUrl: url }).success).toBe(true);
    }
  });

  it('still accepts the empty strings used by freshly created profiles', () => {
    const result = parseUserProfile({ ...validProfile, website: '', avatarUrl: '' });
    expect(result.success).toBe(true);
  });

  it('keeps the shared scheme contract exported for form-level reuse', () => {
    expect(HTTP_URL_SCHEME_REGEX.test('https://example.com')).toBe(true);
    expect(HTTP_URL_SCHEME_REGEX.test('javascript:alert(1)')).toBe(false);
  });

  it('rejects over-long URLs before they reach the profile document', () => {
    const longUrl = `https://example.com/${'a'.repeat(ValidationRules.user.website.maxLength)}`;
    const result = parseUserProfile({ ...validProfile, website: longUrl });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.join(' ')).toContain('300 characters or fewer');
    }
  });
});

describe('bookSchema', () => {
  it('accepts a valid catalog document', () => {
    expect(parseBook(validBook).success).toBe(true);
  });

  it('requires a well-formed ISBN-13', () => {
    expect(bookSchema.safeParse({ ...validBook, isbn13: '1234567890123' }).success).toBe(false);
  });

  it('requires at least one author', () => {
    expect(bookSchema.safeParse({ ...validBook, authors: [] }).success).toBe(false);
  });

  it('rejects ratings outside 0-5 and negative counts', () => {
    expect(bookSchema.safeParse({ ...validBook, averageRating: 5.4 }).success).toBe(false);
    expect(bookSchema.safeParse({ ...validBook, ratingsCount: -1 }).success).toBe(false);
  });
});

describe('userBookShelfSchema', () => {
  it('accepts a consistent shelf row', () => {
    expect(parseUserBookShelf(validShelf).success).toBe(true);
  });

  it('rejects an unknown shelf status', () => {
    expect(userBookShelfSchema.safeParse({ ...validShelf, status: 'reading' }).success).toBe(false);
  });

  it('rejects percentages outside 0-100', () => {
    expect(userBookShelfSchema.safeParse({ ...validShelf, progressPercentage: 140 }).success).toBe(false);
  });
});

describe('validateShelfProgressRecord', () => {
  it('passes when pages and percentage agree', () => {
    const result = validateShelfProgressRecord(validShelf);
    expect(result).toEqual({ success: true, data: { progressPages: 120, progressPercentage: 20 } });
  });

  it('reports a percentage that disagrees with the page count', () => {
    const result = validateShelfProgressRecord({ ...validShelf, progressPercentage: 55 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors[0]).toContain('progressPercentage is 55%');
    }
  });

  it('reports page counts beyond the book length', () => {
    const result = validateShelfProgressRecord({ ...validShelf, progressPages: 900, progressPercentage: 100 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors[0]).toContain('between 0 and 601');
    }
  });
});

describe('reviewDraftSchema', () => {
  const draft = {
    rating: 4.5,
    title: 'A sweeping family epic',
    content: 'The Salinas Valley chapters carry the whole novel for me.',
    containsSpoilers: false
  };

  it('accepts a compliant draft', () => {
    expect(parseReviewDraft(draft).success).toBe(true);
  });

  it('enforces the headline length window', () => {
    expect(reviewDraftSchema.safeParse({ ...draft, title: 'A' }).success).toBe(false);
    expect(reviewDraftSchema.safeParse({ ...draft, title: 'x'.repeat(121) }).success).toBe(false);
    expect(reviewDraftSchema.safeParse({ ...draft, title: 'xy' }).success).toBe(true);
  });

  it('enforces the content length window', () => {
    expect(reviewDraftSchema.safeParse({ ...draft, content: 'x'.repeat(19) }).success).toBe(false);
    expect(reviewDraftSchema.safeParse({ ...draft, content: 'x'.repeat(20) }).success).toBe(true);
    expect(reviewDraftSchema.safeParse({ ...draft, content: 'x'.repeat(10_001) }).success).toBe(false);
  });

  it('rejects off-increment ratings', () => {
    const result = parseReviewDraft({ ...draft, rating: 4.3 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.join(' ')).toContain('half star increments');
    }
  });

  it('rejects ratings outside the 0.5-5 window', () => {
    expect(ratingValueSchema.safeParse(0).success).toBe(false);
    expect(ratingValueSchema.safeParse(5.5).success).toBe(false);
  });
});

describe('bookSearchFiltersSchema', () => {
  it('accepts and type-narrows valid filters', () => {
    const result = parseBookSearchFilters({
      query: 'steinbeck',
      genre: 'Classics',
      minRating: 3.5,
      sortBy: 'publishedDate',
      sortDirection: 'asc',
      page: 2,
      limit: 12
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sortBy).toBe('publishedDate');
    }
  });

  it('rejects unsupported sort fields and out-of-range paging', () => {
    expect(
      bookSearchFiltersSchema.safeParse({
        query: '',
        genre: '',
        minRating: 0,
        sortBy: 'popularity',
        sortDirection: 'desc',
        page: 1,
        limit: 24
      }).success
    ).toBe(false);
    expect(
      bookSearchFiltersSchema.safeParse({
        query: '',
        genre: '',
        minRating: 0,
        sortBy: 'title',
        sortDirection: 'asc',
        page: 0,
        limit: 24
      }).success
    ).toBe(false);
    expect(
      bookSearchFiltersSchema.safeParse({
        query: '',
        genre: '',
        minRating: 0,
        sortBy: 'title',
        sortDirection: 'asc',
        page: 1,
        limit: 100
      }).success
    ).toBe(false);
  });

  it('accepts an optional shelf status filter', () => {
    expect(
      bookSearchFiltersSchema.safeParse({
        query: '',
        genre: '',
        shelfStatus: 'want-to-read',
        minRating: 0,
        sortBy: 'bayesianRating',
        sortDirection: 'desc',
        page: 1,
        limit: 24
      }).success
    ).toBe(true);
  });
});

describe('shared helpers', () => {
  it('validates shelf statuses against the enum', () => {
    expect(shelfStatusSchema.safeParse('did-not-finish').success).toBe(true);
    expect(shelfStatusSchema.safeParse('finished').success).toBe(false);
  });

  it('normalises handles into the accepted character set', () => {
    const handle = normalizeHandle('Ada Lovelace!');
    expect(ValidationRules.user.handle.regex.test(handle)).toBe(true);
    expect(normalizeHandle('x'.repeat(40))).toHaveLength(20);
  });

  it('prefixes Zod issues with their field path', () => {
    const parsed = reviewDraftSchema.safeParse({ rating: 4.5, title: 'ok', content: 'short', containsSpoilers: false });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const issues = formatValidationIssues(parsed.error);
      expect(issues.some((issue) => issue.startsWith('content: '))).toBe(true);
    }
  });

  it('reads the shared rating step from ValidationRules', () => {
    expect(ValidationRules.review.rating.step).toBe(0.5);
    expect(ValidationRules.shelf.progressPages(300)).toEqual({ min: 0, max: 300 });
    expect(emptyRatingDistribution()).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
  });
});
