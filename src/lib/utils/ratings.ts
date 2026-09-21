/**
 * Pure rating mathematics for the community catalog.
 *
 * Every function here is deterministic and side-effect free so the exact same
 * code path can run in the browser (optimistic UI), inside a Firestore
 * transaction (atomic aggregate update), and in unit tests.
 */
import type { BookRatingAggregates, RatingDistribution, RatingTier } from '$lib/types/domain';

export const CATALOG_CONSTANTS = {
  MINIMUM_RATINGS_THRESHOLD: 25,
  GLOBAL_CATALOG_MEAN: 3.75
} as const;

/** Interaction bounds shared by the rating widget and the validation layer. */
export const RATING_BOUNDS = {
  MIN: 0.5,
  MAX: 5.0,
  STEP: 0.5
} as const;

export const RATING_TIERS: readonly RatingTier[] = [1, 2, 3, 4, 5];

/** A single histogram row: tier, absolute count, and share of all ratings. */
export interface RatingTierBreakdown {
  tier: RatingTier;
  count: number;
  percentage: number;
}

/**
 * Bayesian (weighted) mean rating.
 *
 * WR = (v / (v + m)) * R + (m / (v + m)) * C
 *
 * Selection bias guard: a book with a single 5-star rating must not outrank a
 * classic with 200,000 ratings averaging 4.3, so the score is pulled toward the
 * catalog mean `C` until `v` comfortably exceeds the threshold `m`.
 */
export function calculateBayesianRating(
  ratingsCount: number,
  averageRating: number,
  minThreshold: number = CATALOG_CONSTANTS.MINIMUM_RATINGS_THRESHOLD,
  catalogMean: number = CATALOG_CONSTANTS.GLOBAL_CATALOG_MEAN
): number {
  if (!Number.isFinite(ratingsCount) || ratingsCount <= 0) return 0;
  if (!Number.isFinite(averageRating) || averageRating <= 0) return 0;
  if (!Number.isFinite(minThreshold) || minThreshold < 0) {
    throw new RangeError('minThreshold must be a finite, non-negative number.');
  }
  if (!Number.isFinite(catalogMean)) {
    throw new RangeError('catalogMean must be a finite number.');
  }

  const total = ratingsCount + minThreshold;
  const weightedRating =
    (ratingsCount / total) * averageRating + (minThreshold / total) * catalogMean;

  return roundToTwoDecimals(weightedRating);
}

/**
 * Rounds to the two decimal places persisted in Firestore aggregates.
 *
 * IEEE-754 binary doubles cannot represent most decimal midpoints exactly
 * (`1.005 * 100` is `100.49999999999998579`), so a naive `Math.round` truncates
 * the boundary case downward and a stored average drifts one cent below the
 * value the pipeline computed. Seeding the product with `Number.EPSILON`
 * restores the intended half-up result (`1.005 -> 1.01`) while leaving ordinary
 * values — including explicit near-misses such as `1.0049999999` — untouched,
 * because the correction is orders of magnitude below the rounding resolution.
 */
export function roundToTwoDecimals(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Folds a rating mutation into an existing histogram.
 *
 * `oldRating` is the caller's previous rating (null when this is a first-time
 * rating); passing it keeps the histogram consistent when a reader changes
 * their mind instead of double counting.
 */
export function updateRatingDistribution(
  currentDist: RatingDistribution,
  oldRating: number | null,
  newRating: number
): {
  distribution: RatingDistribution;
  newAverage: number;
  newCount: number;
} {
  const dist: RatingDistribution = { ...emptyRatingDistribution(), ...currentDist };

  if (oldRating !== null && oldRating >= 1 && oldRating <= 5) {
    const roundedOld = Math.round(oldRating) as RatingTier;
    dist[roundedOld] = Math.max(0, dist[roundedOld] - 1);
  }

  const roundedNew = clampRatingTier(newRating);
  dist[roundedNew] = (dist[roundedNew] || 0) + 1;

  const newCount = dist[1] + dist[2] + dist[3] + dist[4] + dist[5];
  const totalScore = dist[1] * 1 + dist[2] * 2 + dist[3] * 3 + dist[4] * 4 + dist[5] * 5;

  return {
    distribution: dist,
    newAverage: newCount > 0 ? roundToTwoDecimals(totalScore / newCount) : 0,
    newCount
  };
}

/** Produces the aggregates to persist after a rating mutation, including the new Bayesian score. */
export function applyRatingMutation(
  currentAggregates: BookRatingAggregates,
  oldRating: number | null,
  newRating: number
): BookRatingAggregates {
  const { distribution, newAverage, newCount } = updateRatingDistribution(
    currentAggregates.ratingDistribution,
    oldRating,
    newRating
  );

  return {
    ratingDistribution: distribution,
    averageRating: newAverage,
    ratingsCount: newCount,
    bayesianRating: calculateBayesianRating(newCount, newAverage)
  };
}

/** A zeroed histogram — never sparse, so every tier is addressable. */
export function emptyRatingDistribution(): RatingDistribution {
  return { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
}

/** Snaps an arbitrary number to the nearest valid star tier, clamped to 1..5. */
export function clampRatingTier(value: number): RatingTier {
  if (!Number.isFinite(value)) return 1;
  const rounded = Math.round(value);
  if (rounded < 1) return 1;
  if (rounded > 5) return 5;
  return rounded as RatingTier;
}

/**
 * Snaps an arbitrary number to a legal rating (0 when unrated, otherwise
 * 0.5 - 5.0 in half-star increments).
 */
export function clampRating(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const clamped = Math.min(RATING_BOUNDS.MAX, Math.max(RATING_BOUNDS.MIN, value));
  return Math.round(clamped * 2) / 2;
}

/** Formats a rating for display; unrated values render as an em dash. */
export function formatRating(value: number, fractionDigits = 2): string {
  if (!Number.isFinite(value) || value <= 0) return '—';
  return value.toFixed(fractionDigits);
}

/** Total number of ratings recorded in a histogram. */
export function totalRatings(distribution: RatingDistribution): number {
  return distribution[1] + distribution[2] + distribution[3] + distribution[4] + distribution[5];
}

/** Mean star value implied by a histogram (0 when empty). */
export function distributionAverage(distribution: RatingDistribution): number {
  const count = totalRatings(distribution);
  if (count === 0) return 0;
  const score =
    distribution[1] * 1 +
    distribution[2] * 2 +
    distribution[3] * 3 +
    distribution[4] * 4 +
    distribution[5] * 5;
  return roundToTwoDecimals(score / count);
}

/** Histogram rows ordered highest tier first, ready for the distribution chart. */
export function buildRatingBreakdown(
  distribution: RatingDistribution,
  totalOverride?: number
): RatingTierBreakdown[] {
  const total = totalOverride ?? totalRatings(distribution);
  return [...RATING_TIERS].reverse().map((tier) => {
    const count = distribution[tier] || 0;
    return {
      tier,
      count,
      percentage: total > 0 ? roundToTwoDecimals((count / total) * 100) : 0
    };
  });
}

/** Bayesian score for a histogram, using the shared catalog constants. */
export function bayesianFromDistribution(distribution: RatingDistribution): number {
  const count = totalRatings(distribution);
  return calculateBayesianRating(count, distributionAverage(distribution));
}
