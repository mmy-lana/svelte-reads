/**
 * DEF-01 regression coverage.
 *
 * The profile page seeded its reading-goal input with
 * `profile?.readingGoal.targetBooks`. Optional chaining stopped at `profile`, so
 * a profile document without a `readingGoal` — a legacy row, or an optimistic
 * sign-up write that has not been completed yet — dereferenced `undefined` and
 * threw a TypeError inside a reactive effect, taking the whole page down.
 *
 * The schema types `readingGoal` as required, so these cases cast a partial
 * document deliberately: the point is that runtime data does not have to honour
 * the type, and the accessor must survive that.
 */
import { describe, expect, it } from 'vitest';
import { readingGoalTarget } from '$lib/utils/profile';
import { makeUser } from '$lib/testing/fixtures';
import type { UserProfile } from '$lib/types/domain';

/** A profile that satisfies the schema, used as the base for partial variants. */
function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  const user = makeUser();
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    handle: 'ada_reader',
    avatarUrl: '',
    bio: '',
    location: '',
    website: '',
    readingGoal: { year: 2026, targetBooks: 24, completedBooks: 7 },
    stats: { reviewsCount: 0, ratingsCount: 0, booksReadCount: 0, pagesReadTotal: 0 },
    preferences: {
      allowSpoilersDefault: false,
      isProfilePrivate: false,
      notifyOnLikes: true,
      notifyOnComments: true
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  };
}

/** Simulates a document that does not carry `readingGoal` at all. */
function withoutReadingGoal(): UserProfile {
  const { readingGoal: _dropped, ...rest } = makeProfile();
  return rest as unknown as UserProfile;
}

describe('readingGoalTarget (DEF-01)', () => {
  it('returns the target for a fully hydrated profile', () => {
    expect(readingGoalTarget(makeProfile())).toBe(24);
  });

  it('returns null instead of throwing when readingGoal is absent', () => {
    // The original expression threw here.
    expect(() => readingGoalTarget(withoutReadingGoal())).not.toThrow();
    expect(readingGoalTarget(withoutReadingGoal())).toBeNull();
  });

  it('returns null for a missing profile', () => {
    expect(readingGoalTarget(null)).toBeNull();
    expect(readingGoalTarget(undefined)).toBeNull();
  });

  it('returns null when readingGoal is present but targetBooks is absent', () => {
    const partial = makeProfile({
      readingGoal: { year: 2026, completedBooks: 3 } as UserProfile['readingGoal']
    });

    expect(readingGoalTarget(partial)).toBeNull();
  });

  it('preserves a legitimate zero target rather than treating it as absent', () => {
    const zero = makeProfile({
      readingGoal: { year: 2026, targetBooks: 0, completedBooks: 0 }
    });

    expect(readingGoalTarget(zero)).toBe(0);
  });

  it('rejects non-finite targets so the input is never seeded with NaN', () => {
    const broken = makeProfile({
      readingGoal: {
        year: 2026,
        targetBooks: Number.NaN,
        completedBooks: 0
      } as UserProfile['readingGoal']
    });

    expect(readingGoalTarget(broken)).toBeNull();
  });
});
