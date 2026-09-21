/**
 * Domain error vocabulary shared by the data gateways and the rune stores.
 *
 * Keeping these in one module means the UI can branch on a stable set of error
 * types instead of inspecting Firebase error codes, and the stores can be unit
 * tested with gateways that raise exactly these conditions.
 */

/** Thrown when a mutation needs a signed-in reader but the session is anonymous. */
export class AuthenticationRequiredError extends Error {
  readonly code = 'app/authentication-required';

  constructor(action = 'continue') {
    super(`Sign in to ${action}.`);
    this.name = 'AuthenticationRequiredError';
  }
}

/** Thrown when a write cannot be accepted, wrapping the underlying cause. */
export class WriteRejectedError extends Error {
  readonly code: string;
  /** Message safe to render next to the control that failed. */
  readonly userMessage: string;

  constructor(userMessage: string, code = 'app/write-rejected', cause?: unknown) {
    super(userMessage);
    this.name = 'WriteRejectedError';
    this.code = code;
    this.userMessage = userMessage;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

/** Raised when the reader already reviewed the book (one review per reader). */
export class DuplicateReviewError extends Error {
  readonly code = 'reviews/duplicate';
  readonly bookId: string;

  constructor(bookId: string) {
    super('You have already reviewed this book. Edit your existing review instead.');
    this.name = 'DuplicateReviewError';
    this.bookId = bookId;
  }
}

/** Raised when a book document referenced by a mutation is missing. */
export class BookNotFoundError extends Error {
  readonly code = 'books/not-found';

  constructor(bookId: string) {
    super(`Book ${bookId} is not in the catalog.`);
    this.name = 'BookNotFoundError';
  }
}

/** Raised when a mutation is requested while an earlier one is still in flight. */
export class MutationInFlightError extends Error {
  readonly code = 'app/mutation-in-flight';

  constructor(subject: string) {
    super(`A change to ${subject} is already in progress.`);
    this.name = 'MutationInFlightError';
  }
}

/** Raised when a stored document does not satisfy its schema contract. */
export class DataIntegrityError extends Error {
  readonly code = 'app/data-integrity';
  readonly issues: readonly string[];

  constructor(collection: string, identifier: string, issues: readonly string[]) {
    super(`Stored ${collection} document "${identifier}" is invalid: ${issues.join('; ')}`);
    this.name = 'DataIntegrityError';
    this.issues = issues;
  }
}

function readErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const candidate = (error as { code?: unknown }).code;
  return typeof candidate === 'string' ? candidate : null;
}

const OFFLINE_CODES = new Set([
  'unavailable',
  'auth/network-request-failed',
  'firestore/unavailable',
  'app/offline',
  'deadline-exceeded'
]);

/**
 * Translates any thrown value into copy a reader can act on. Offline writes are
 * called out explicitly because the optimistic layer has already reverted them
 * by the time this message is rendered.
 */
export function describeWriteFailure(error: unknown, fallback: string): string {
  if (error instanceof WriteRejectedError) return error.userMessage;
  if (error instanceof AuthenticationRequiredError) return 'Sign in to save this change.';
  if (error instanceof DuplicateReviewError) return error.message;
  if (error instanceof MutationInFlightError) return error.message;

  const code = readErrorCode(error);

  if (code && OFFLINE_CODES.has(code)) {
    return 'You are offline, so that change was reverted. It will work once you reconnect.';
  }
  if (code === 'permission-denied') {
    return 'You do not have permission to make that change.';
  }
  if (code === 'not-found' || code === 'books/not-found') {
    return 'That record no longer exists. Refresh the page to see the latest state.';
  }
  if (code === 'aborted') {
    return 'Another change to this item is still settling. Try again in a moment.';
  }

  return fallback;
}

/** True when an error represents a lost connection rather than a rejected write. */
export function isOfflineError(error: unknown): boolean {
  const code = readErrorCode(error);
  return code !== null && OFFLINE_CODES.has(code);
}
