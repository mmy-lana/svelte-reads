/**
 * Review composer submission policy.
 *
 * Publishing a review and recording a star rating are two independent writes to
 * two different backends: the review document plus the book's review counter in
 * one transaction, and the reader's shelf row plus the book's rating aggregates
 * in another. The composer has to decide, before either write, whether the
 * rating half is even applicable — and it has to do so from a snapshot of the
 * reader's rating taken *before* the review write, because that write refreshes
 * the shelf and would otherwise make the comparison compare a value to itself.
 *
 * Keeping this decision here (rather than inline in the component) makes the
 * DATA-02 contract testable: a rating is only ever submitted when it is a real,
 * half-star-valid change, so the composer never issues a no-op write and never
 * reports a rating success it did not perform.
 */
import { ValidationRules } from '$lib/validation/schemas';
import type { ReviewDraft } from '$lib/types/domain';

/** Why the composer decided for or against a companion rating write. */
export type RatingSubmissionReason =
  /** The draft carries no star rating; only the review text is persisted. */
  | 'no-rating-in-draft'
  /** The reader's stored rating already equals the draft rating. */
  | 'rating-unchanged'
  /** The draft rating is not on the half-star scale and is not writable. */
  | 'rating-not-on-half-star-scale'
  /** A genuine change: the rating must be written alongside the review. */
  | 'rating-changed';

export interface RatingSubmissionDecision {
  submit: boolean;
  reason: RatingSubmissionReason;
}

/**
 * Decides whether a review submission must also write a rating.
 *
 * @param draftRating - the rating carried by the composer draft, or `0` when the
 *   reader did not pick one.
 * @param previousRating - the reader's stored rating, snapshotted before the
 *   review write. `0` means "not rated yet".
 */
export function decideRatingSubmission(
  draftRating: number,
  previousRating: number
): RatingSubmissionDecision {
  // A `0` draft is the composer's explicit "no rating chosen" state.
  if (draftRating === 0) return { submit: false, reason: 'no-rating-in-draft' };
  // Checked before the change comparison so an off-scale or non-finite value is
  // reported as unwritable rather than mislabelled. `NaN > 0` is false, so a
  // naive ordering would classify it as "no rating in draft".
  if (!isWritableRating(draftRating)) {
    return { submit: false, reason: 'rating-not-on-half-star-scale' };
  }
  if (draftRating === previousRating) return { submit: false, reason: 'rating-unchanged' };
  return { submit: true, reason: 'rating-changed' };
}

/**
 * True when a rating is on the half-star scale the aggregates are built around.
 *
 * A rating off the scale would be rejected by the shelf gateway anyway; catching
 * it here keeps the composer from attempting a write it knows will fail and then
 * reporting that failure as a rating problem the reader cannot fix.
 */
export function isWritableRating(rating: number): boolean {
  if (!Number.isFinite(rating)) return false;
  const { min, max, step } = ValidationRules.review.rating;
  if (rating < min || rating > max) return false;
  // Exact division check, not a rounded one: `Math.round(rating / step)` would
  // accept 4.75 (9.5 → 10), which is not a half-star value.
  return Number.isInteger(rating / step);
}

/**
 * The reader-facing notice shown when the review landed but its rating did not.
 *
 * Phrased as a warning rather than an error on purpose: the review is a valid,
 * published document, so telling the reader the whole submission failed would be
 * false, and would invite a duplicate re-submission.
 */
export function ratingFailureNotice(options: {
  wasEditing: boolean;
  reason: string;
}): string {
  const lead = options.wasEditing
    ? 'Your review changes were saved, but your rating was not'
    : 'Your review was published, but your rating was not';
  return `${lead}: ${options.reason}`;
}

/**
 * Builds the trimmed review payload the stores persist.
 *
 * Trimming happens once, here, so the length checks the composer runs and the
 * text the gateway writes can never disagree about what "empty" means.
 */
export function reviewPayloadFromDraft(draft: ReviewDraft): ReviewDraft {
  return {
    rating: draft.rating,
    title: draft.title.trim(),
    content: draft.content.trim(),
    containsSpoilers: draft.containsSpoilers
  };
}
