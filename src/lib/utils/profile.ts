/**
 * Profile field accessors.
 *
 * The `UserProfile` schema requires `readingGoal`, but a document read from
 * Firestore is not guaranteed to satisfy it: rows written before the field
 * existed, and optimistic sign-up writes that land before the goal form is
 * touched, both arrive without it. These helpers read such fields without
 * assuming the schema held, so a partially hydrated profile degrades to a blank
 * control instead of throwing inside a reactive effect.
 */
import type { UserProfile } from '$lib/types/domain';

/**
 * The reader's annual target, or `null` when it is unavailable.
 *
 * Returns `null` — never `undefined` and never a throw — for a missing profile,
 * a missing `readingGoal`, or a `targetBooks` that is not a finite number. The
 * `null` sentinel keeps callers from having to distinguish "absent" from
 * "zero", which matters because `0` is a legitimate target.
 */
export function readingGoalTarget(profile: UserProfile | null | undefined): number | null {
  // DEF-01: every step of the chain is optional. `profile?.readingGoal.targetBooks`
  // threw a TypeError as soon as `readingGoal` was absent.
  const target = profile?.readingGoal?.targetBooks;
  return typeof target === 'number' && Number.isFinite(target) ? target : null;
}
