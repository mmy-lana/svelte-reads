/**
 * DATA-02 regression coverage.
 *
 * The composer used to fire the companion rating write with
 * `.catch(() => undefined)`. Any rating failure — a rules rejection, an offline
 * write, a failed transaction — was swallowed, and the reader was told the
 * review had been published "and your rating saved" when the rating had in fact
 * been dropped. These cases pin the two halves of the fix:
 *
 *   1. the decision to write a rating is made from an explicit, tested policy, so
 *      a real change is always attempted and a no-op is never attempted; and
 *   2. a rating failure produces an honest, non-fatal notice that says which half
 *      landed, instead of a success message.
 */
import { describe, expect, it } from 'vitest';
import {
  decideRatingSubmission,
  isWritableRating,
  ratingFailureNotice,
  reviewPayloadFromDraft
} from '$lib/utils/review-submission';

describe('decideRatingSubmission (DATA-02)', () => {
  it('submits when the reader picks a new half-star rating', () => {
    expect(decideRatingSubmission(4.5, 3)).toEqual({ submit: true, reason: 'rating-changed' });
    expect(decideRatingSubmission(0.5, 0)).toEqual({ submit: true, reason: 'rating-changed' });
    expect(decideRatingSubmission(5, 4.5)).toEqual({ submit: true, reason: 'rating-changed' });
  });

  it('skips the write when the draft carries no rating', () => {
    expect(decideRatingSubmission(0, 0)).toEqual({
      submit: false,
      reason: 'no-rating-in-draft'
    });
    // Even against an existing rating, a 0 draft means "review text only".
    expect(decideRatingSubmission(0, 4)).toEqual({
      submit: false,
      reason: 'no-rating-in-draft'
    });
  });

  it('skips the write when the stored rating already matches', () => {
    expect(decideRatingSubmission(4, 4)).toEqual({ submit: false, reason: 'rating-unchanged' });
  });

  it('refuses a rating that is not on the half-star scale', () => {
    // The gateway rejects these anyway; the composer must not attempt a write it
    // knows will fail and then blame the reader for a rating problem.
    expect(decideRatingSubmission(3.7, 0)).toEqual({
      submit: false,
      reason: 'rating-not-on-half-star-scale'
    });
    expect(decideRatingSubmission(5.5, 0)).toEqual({
      submit: false,
      reason: 'rating-not-on-half-star-scale'
    });
    // `NaN > 0` is false, so this must not be misreported as an empty draft.
    expect(decideRatingSubmission(Number.NaN, 0)).toEqual({
      submit: false,
      reason: 'rating-not-on-half-star-scale'
    });
  });

  it('never reports "rating unchanged" for a reader who has not rated yet', () => {
    // Guards the old comparison, which treated "unrated" (0) as equal to a 0
    // draft and would have skipped a legitimate first rating.
    expect(decideRatingSubmission(0.5, 0).submit).toBe(true);
  });
});

describe('isWritableRating', () => {
  it('accepts the half-star scale across its whole range', () => {
    for (let rating = 0.5; rating <= 5; rating += 0.5) {
      expect(isWritableRating(rating)).toBe(true);
    }
  });

  it('rejects off-scale, out-of-range, and non-finite values', () => {
    expect(isWritableRating(0)).toBe(false);
    expect(isWritableRating(0.25)).toBe(false);
    expect(isWritableRating(4.75)).toBe(false);
    expect(isWritableRating(5.5)).toBe(false);
    expect(isWritableRating(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isWritableRating(Number.NaN)).toBe(false);
  });
});

describe('ratingFailureNotice (DATA-02)', () => {
  it('names the half that landed and the half that did not', () => {
    expect(
      ratingFailureNotice({ wasEditing: false, reason: 'Missing or insufficient permissions.' })
    ).toBe(
      'Your review was published, but your rating was not: Missing or insufficient permissions.'
    );

    expect(ratingFailureNotice({ wasEditing: true, reason: 'Network unavailable.' })).toBe(
      'Your review changes were saved, but your rating was not: Network unavailable.'
    );
  });

  it('never claims the rating was saved', () => {
    for (const wasEditing of [true, false]) {
      const notice = ratingFailureNotice({ wasEditing, reason: 'offline' });
      expect(notice).toContain('was not');
      expect(notice).not.toContain('rating saved');
    }
  });
});

describe('reviewPayloadFromDraft', () => {
  it('trims the text fields once so validation and persistence agree', () => {
    const payload = reviewPayloadFromDraft({
      rating: 4.5,
      title: '  A measured reading  ',
      content: '   The prose is spare and the pacing never sags.   ',
      containsSpoilers: true
    });

    expect(payload).toEqual({
      rating: 4.5,
      title: 'A measured reading',
      content: 'The prose is spare and the pacing never sags.',
      containsSpoilers: true
    });
  });

  it('leaves the rating and spoiler flag untouched', () => {
    const payload = reviewPayloadFromDraft({
      rating: 0,
      title: 'x',
      content: 'y',
      containsSpoilers: false
    });

    expect(payload.rating).toBe(0);
    expect(payload.containsSpoilers).toBe(false);
  });
});
