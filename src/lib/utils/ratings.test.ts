import { describe, expect, it } from 'vitest';
import {
  applyRatingMutation,
  bayesianFromDistribution,
  buildRatingBreakdown,
  calculateBayesianRating,
  CATALOG_CONSTANTS,
  clampRating,
  clampRatingTier,
  distributionAverage,
  emptyRatingDistribution,
  formatRating,
  RATING_BOUNDS,
  roundToTwoDecimals,
  totalRatings,
  updateRatingDistribution
} from '$lib/utils/ratings';
import type { BookRatingAggregates, RatingDistribution } from '$lib/types/domain';

describe('calculateBayesianRating', () => {
  it('returns 0 when a book has no ratings yet', () => {
    expect(calculateBayesianRating(0, 4.5)).toBe(0);
    expect(calculateBayesianRating(-3, 4.5)).toBe(0);
  });

  it('returns 0 when the supplied average is not usable', () => {
    expect(calculateBayesianRating(120, 0)).toBe(0);
    expect(calculateBayesianRating(0, 0)).toBe(0);
  });

  it('applies the weighted mean formula exactly', () => {
    // (100 / 125) * 4.5 + (25 / 125) * 3.75 = 3.6 + 0.75
    expect(calculateBayesianRating(100, 4.5)).toBe(4.35);
    // (25 / 50) * 4.2 + (25 / 50) * 3.75 = 2.1 + 1.875 -> 3.98
    expect(calculateBayesianRating(25, 4.2)).toBe(3.98);
    // (1 / 26) * 5 + (25 / 26) * 3.75 = 3.7980... -> 3.8
    expect(calculateBayesianRating(1, 5)).toBe(3.8);
  });

  it('pulls low-volume books toward the catalog mean', () => {
    const singleRating = calculateBayesianRating(1, 5);
    const catalogMean = CATALOG_CONSTANTS.GLOBAL_CATALOG_MEAN;
    expect(singleRating).toBeGreaterThan(catalogMean);
    expect(singleRating).toBeLessThan(5);
  });

  it('ranks a heavily rated classic above a single five-star rating', () => {
    const classic = calculateBayesianRating(200_000, 4.3);
    const newcomer = calculateBayesianRating(1, 5);
    expect(classic).toBeGreaterThan(newcomer);
    expect(classic).toBeCloseTo(4.3, 2);
  });

  it('converges on the arithmetic mean as the rating count grows', () => {
    expect(calculateBayesianRating(60_000, 4.8)).toBeCloseTo(4.8, 2);
  });

  it('never leaves the 0-5 domain', () => {
    for (const count of [1, 10, 25, 1000, 500_000]) {
      for (const average of [0.5, 2.5, 3.75, 5]) {
        const score = calculateBayesianRating(count, average);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(5);
      }
    }
  });

  it('rejects invalid thresholds instead of silently producing NaN', () => {
    expect(() => calculateBayesianRating(10, 4, Number.NaN)).toThrow(RangeError);
    expect(() => calculateBayesianRating(10, 4, -1)).toThrow(RangeError);
    expect(() => calculateBayesianRating(10, 4, 25, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('supports custom thresholds for editorial catalog charts', () => {
    // With m = 0 the weighted score collapses to the arithmetic mean.
    expect(calculateBayesianRating(12, 4.25, 0)).toBe(4.25);
  });
});

describe('updateRatingDistribution', () => {
  it('records a first-time rating', () => {
    const result = updateRatingDistribution(emptyRatingDistribution(), null, 4);
    expect(result.distribution).toEqual({ 1: 0, 2: 0, 3: 0, 4: 1, 5: 0 });
    expect(result.newCount).toBe(1);
    expect(result.newAverage).toBe(4);
  });

  it('moves a rating between tiers without double counting', () => {
    const withFour = updateRatingDistribution(emptyRatingDistribution(), null, 4);
    const changed = updateRatingDistribution(withFour.distribution, 4, 2);

    expect(changed.distribution).toEqual({ 1: 0, 2: 1, 3: 0, 4: 0, 5: 0 });
    expect(changed.newCount).toBe(1);
    expect(changed.newAverage).toBe(2);
  });

  it('never mutates the incoming histogram', () => {
    const original: RatingDistribution = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 };
    const snapshot = { ...original };
    updateRatingDistribution(original, 5, 1);
    expect(original).toEqual(snapshot);
  });

  it('ignores out-of-range previous ratings and clamps new tiers', () => {
    const result = updateRatingDistribution({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 1 }, 0, 9);
    expect(result.distribution[5]).toBe(2);
    expect(result.distribution[1]).toBe(0);

    const unrated = updateRatingDistribution(emptyRatingDistribution(), null, 0);
    expect(unrated.distribution[1]).toBe(1);
    expect(unrated.newCount).toBe(1);
  });

  it('rounds half-star ratings into the requested tier', () => {
    const result = updateRatingDistribution(emptyRatingDistribution(), null, 4.5);
    expect(result.distribution[5]).toBe(1);
    expect(result.newAverage).toBe(5);
  });

  it('recomputes the average across a mixed histogram', () => {
    const distribution: RatingDistribution = { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 };
    const result = updateRatingDistribution(distribution, null, 5);
    // (1 + 2 + 3 + 4 + 5 + 5) / 6 = 3.3333... -> 3.33
    expect(result.newCount).toBe(6);
    expect(result.newAverage).toBe(3.33);
  });

  it('reports a zero average for an empty histogram', () => {
    const result = updateRatingDistribution(emptyRatingDistribution(), null, 0.5);
    expect(result.newCount).toBe(1);
    expect(result.newAverage).toBe(1);
  });
});

describe('applyRatingMutation', () => {
  const aggregates: BookRatingAggregates = {
    ratingDistribution: { 1: 0, 2: 1, 3: 3, 4: 6, 5: 10 },
    averageRating: 4.25,
    ratingsCount: 20,
    bayesianRating: calculateBayesianRating(20, 4.25)
  };

  it('keeps the histogram, average, count, and Bayesian score consistent', () => {
    const next = applyRatingMutation(aggregates, null, 5);

    expect(totalRatings(next.ratingDistribution)).toBe(next.ratingsCount);
    expect(distributionAverage(next.ratingDistribution)).toBe(next.averageRating);
    expect(next.bayesianRating).toBe(
      calculateBayesianRating(next.ratingsCount, next.averageRating)
    );
    expect(next.ratingsCount).toBe(21);
    expect(next.averageRating).toBeGreaterThan(aggregates.averageRating);
  });

  it('holds the count steady when a reader edits an existing rating', () => {
    const next = applyRatingMutation(aggregates, 4, 1);
    expect(next.ratingsCount).toBe(20);
    expect(next.averageRating).toBeLessThan(aggregates.averageRating);
    expect(totalRatings(next.ratingDistribution)).toBe(20);
  });

  it('lifts a single five-star submission on a fresh catalog entry', () => {
    const fresh = applyRatingMutation(
      {
        ratingDistribution: emptyRatingDistribution(),
        averageRating: 0,
        ratingsCount: 0,
        bayesianRating: 0
      },
      null,
      5
    );
    expect(fresh.ratingsCount).toBe(1);
    expect(fresh.averageRating).toBe(5);
    expect(fresh.bayesianRating).toBe(3.8);
  });
});

describe('rating helpers', () => {
  it('clamps arbitrary numbers into the legal rating domain', () => {
    expect(clampRating(0)).toBe(0);
    expect(clampRating(-4)).toBe(0);
    expect(clampRating(Number.NaN)).toBe(0);
    expect(clampRating(4.3)).toBe(4.5);
    expect(clampRating(4.2)).toBe(4);
    expect(clampRating(9)).toBe(RATING_BOUNDS.MAX);
    expect(clampRating(0.1)).toBe(0.5);
  });

  it('clamps tiers to 1-5', () => {
    expect(clampRatingTier(0)).toBe(1);
    expect(clampRatingTier(-8)).toBe(1);
    expect(clampRatingTier(3)).toBe(3);
    expect(clampRatingTier(7)).toBe(5);
    expect(clampRatingTier(Number.NaN)).toBe(1);
  });

  it('rounds to the persisted two-decimal precision', () => {
    expect(roundToTwoDecimals(3.7980769)).toBe(3.8);
    expect(roundToTwoDecimals(3.3333333)).toBe(3.33);
    expect(roundToTwoDecimals(Number.NaN)).toBe(0);
  });

  it('formats ratings and renders unrated books as an em dash', () => {
    expect(formatRating(0)).toBe('—');
    expect(formatRating(4.5)).toBe('4.50');
    expect(formatRating(4.5, 1)).toBe('4.5');
  });

  it('builds a descending histogram breakdown with shares', () => {
    const breakdown = buildRatingBreakdown({ 1: 1, 2: 1, 3: 2, 4: 3, 5: 3 });
    expect(breakdown.map((row) => row.tier)).toEqual([5, 4, 3, 2, 1]);
    expect(breakdown[0]).toEqual({ tier: 5, count: 3, percentage: 30 });
    expect(
      breakdown.reduce((total, row) => total + row.percentage, 0)
    ).toBeGreaterThanOrEqual(99.9);
  });

  it('reports zero shares for an empty histogram', () => {
    const breakdown = buildRatingBreakdown(emptyRatingDistribution());
    expect(breakdown.every((row) => row.count === 0 && row.percentage === 0)).toBe(true);
  });

  it('derives totals and means from a histogram', () => {
    expect(totalRatings({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 })).toBe(0);
    expect(distributionAverage({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 })).toBe(0);
    expect(distributionAverage({ 1: 0, 2: 0, 3: 1, 4: 1, 5: 0 })).toBe(3.5);
  });

  it('computes a Bayesian score straight from a histogram', () => {
    expect(bayesianFromDistribution({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 })).toBe(0);
    // 25 four-star ratings -> mean 4, pulled toward the 3.75 catalog mean -> 3.88
    expect(bayesianFromDistribution({ 1: 0, 2: 0, 3: 0, 4: 25, 5: 0 })).toBe(3.88);
    // 25 one-star ratings -> mean 1, pulled toward the catalog mean -> 2.38
    expect(bayesianFromDistribution({ 1: 25, 2: 0, 3: 0, 4: 0, 5: 0 })).toBe(2.38);
  });
});
