import { describe, expect, it } from 'vitest';
import {
  AuthenticationRequiredError,
  DataIntegrityError,
  DuplicateReviewError,
  WriteRejectedError,
  describeReadFailure,
  describeWriteFailure,
  isOfflineError
} from '$lib/data/errors';
import { firestoreError } from '$lib/testing/fakes';

describe('write failure copy', () => {
  it('explains that an offline write was reverted', () => {
    expect(describeWriteFailure(firestoreError('unavailable'), 'fallback')).toContain(
      'reverted'
    );
    expect(describeWriteFailure(firestoreError('unavailable'), 'fallback')).toContain('offline');
  });

  it('prefers the typed error message when one is available', () => {
    expect(describeWriteFailure(new WriteRejectedError('Rating rejected.', 'ratings/nope'), 'fallback')).toBe(
      'Rating rejected.'
    );
    expect(describeWriteFailure(new AuthenticationRequiredError('write'), 'fallback')).toBe(
      'Sign in to save this change.'
    );
    expect(describeWriteFailure(new DuplicateReviewError('book-1'), 'fallback')).toContain(
      'already reviewed'
    );
  });

  it('covers the remaining Firestore codes and falls back otherwise', () => {
    expect(describeWriteFailure(firestoreError('permission-denied'), 'fallback')).toContain(
      'permission'
    );
    expect(describeWriteFailure(firestoreError('not-found'), 'fallback')).toContain('no longer exists');
    expect(describeWriteFailure(firestoreError('aborted'), 'fallback')).toContain('still settling');
    expect(describeWriteFailure(new Error('unexpected'), 'fallback')).toBe('fallback');
  });
});

describe('read failure copy', () => {
  it('asks for a retry instead of claiming a revert', () => {
    const message = describeReadFailure(firestoreError('unavailable'), 'fallback');

    expect(message).toContain('offline');
    expect(message).not.toContain('reverted');
  });

  it('maps expired sessions, missing records, and timeouts', () => {
    expect(describeReadFailure(firestoreError('permission-denied'), 'fallback')).toContain(
      'Sign in again'
    );
    expect(describeReadFailure(firestoreError('books/not-found'), 'fallback')).toContain(
      'no longer available'
    );
    // `deadline-exceeded` counts as a lost connection, so it keeps the retry copy.
    expect(describeReadFailure(firestoreError('deadline-exceeded'), 'fallback')).toContain(
      'Reconnect'
    );
  });

  it('surfaces integrity problems verbatim and falls back otherwise', () => {
    const integrity = new DataIntegrityError('books', 'book-1', ['title is required']);
    expect(describeReadFailure(integrity, 'fallback')).toBe(integrity.message);
    expect(describeReadFailure(new Error('unexpected'), 'fallback')).toBe('fallback');
  });
});

describe('offline detection', () => {
  it('recognises connection codes only', () => {
    expect(isOfflineError(firestoreError('unavailable'))).toBe(true);
    expect(isOfflineError(firestoreError('auth/network-request-failed'))).toBe(true);
    expect(isOfflineError(firestoreError('permission-denied'))).toBe(false);
    expect(isOfflineError(new Error('plain'))).toBe(false);
  });
});
