export const CATALOG_CONSTANTS = {
  MINIMUM_RATINGS_THRESHOLD: 25,
  GLOBAL_CATALOG_MEAN: 3.75
} as const;

export function calculateBayesianRating(
  ratingsCount: number,
  averageRating: number,
  minThreshold: number = CATALOG_CONSTANTS.MINIMUM_RATINGS_THRESHOLD,
  catalogMean: number = CATALOG_CONSTANTS.GLOBAL_CATALOG_MEAN
): number {
  if (ratingsCount <= 0) return 0;

  const weightedRating =
    (ratingsCount / (ratingsCount + minThreshold)) * averageRating +
    (minThreshold / (ratingsCount + minThreshold)) * catalogMean;

  return Math.round(weightedRating * 100) / 100;
}

export function updateRatingDistribution(
  currentDist: { 1: number; 2: number; 3: number; 4: number; 5: number },
  oldRating: number | null,
  newRating: number
): {
  distribution: { 1: number; 2: number; 3: number; 4: number; 5: number };
  newAverage: number;
  newCount: number;
} {
  const dist = { ...currentDist };

  if (oldRating !== null && oldRating >= 1 && oldRating <= 5) {
    const roundedOld = Math.round(oldRating) as 1 | 2 | 3 | 4 | 5;
    dist[roundedOld] = Math.max(0, dist[roundedOld] - 1);
  }

  const roundedNew = Math.round(newRating) as 1 | 2 | 3 | 4 | 5;
  dist[roundedNew] = (dist[roundedNew] || 0) + 1;

  const newCount = dist[1] + dist[2] + dist[3] + dist[4] + dist[5];
  const totalScore =
    dist[1] * 1 + dist[2] * 2 + dist[3] * 3 + dist[4] * 4 + dist[5] * 5;

  const newAverage = newCount > 0 ? Math.round((totalScore / newCount) * 100) / 100 : 0;

  return {
    distribution: dist,
    newAverage,
    newCount
  };
}
