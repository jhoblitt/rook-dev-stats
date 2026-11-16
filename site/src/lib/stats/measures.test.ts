import { describe, expect, it } from 'vitest';
import {
  disclosureCounts,
  distribution,
  mergedWithin,
  nearestRank,
} from './measures';
import { all, at, dataset } from './testing';

const T0 = at('2026-06-01T00:00:00Z');
const DAY = 86_400;

describe('distribution', () => {
  it('summarises lines changed: mean, nearest-rank median and 90th percentile, and the share above zero', () => {
    // Lines: 4, 70, 250, 1050. Median: rank ceil(0.5 × 4) = 2 → 70; p90: rank ceil(3.6) = 4 → 1050.
    const data = dataset([
      { created: T0, additions: 3, deletions: 1 },
      { created: T0, additions: 1000, deletions: 50 },
      { created: T0, additions: 60, deletions: 10 },
      { created: T0, additions: 200, deletions: 50 },
    ]);
    expect(distribution(data, all(data), 'lines')).toEqual({ count: 4, mean: 1374 / 4, median: 70, p90: 1050, nonzero: 1 });
  });

  it('reads files changed and bot reviews from their own columns', () => {
    const data = dataset([
      { created: T0, files: 2, bot_reviews: 1 },
      { created: T0, files: 30, bot_reviews: 0 },
      { created: T0, files: 4, bot_reviews: 3 },
    ]);
    const rows = all(data);
    expect(distribution(data, rows, 'files')).toEqual({ count: 3, mean: 12, median: 4, p90: 30, nonzero: 1 });
    expect(distribution(data, rows, 'botReviews')).toEqual({ count: 3, mean: 4 / 3, median: 1, p90: 3, nonzero: 2 / 3 });
  });

  it('keeps to the rows given', () => {
    const data = dataset([
      { created: T0, files: 2 },
      { created: T0, files: 30 },
    ]);
    expect(distribution(data, Uint32Array.of(1), 'files')?.median).toBe(30);
  });

  it('has nothing to say about no rows', () => {
    const data = dataset([{ created: T0 }]);
    expect(distribution(data, new Uint32Array(0), 'lines')).toBeNull();
  });
});

describe('nearestRank', () => {
  it('takes the least value at or under which the share lies', () => {
    const sorted = Int32Array.of(1, 2, 3, 4, 5, 6, 7, 8, 9, 10);
    expect(nearestRank(sorted, 0.5)).toBe(5);
    expect(nearestRank(sorted, 0.9)).toBe(9);
    expect(nearestRank(Float64Array.of(7), 0.9)).toBe(7);
  });
});

describe('mergedWithin', () => {
  // Fetched 40 days after T0; the horizon is 30 days.
  const fetched = T0 + 40 * DAY;
  const data = dataset(
    [
      // Opened 40 days ago, merged exactly 30 days after opening: counts.
      { created: T0, state: 1, closed: T0 + 30 * DAY },
      // Opened 40 days ago, merged a day too late: followed, not merged within.
      { created: T0, state: 1, closed: T0 + 31 * DAY },
      // Opened 40 days ago, closed unmerged after 5 days: followed, not merged.
      { created: T0, state: 2, closed: T0 + 5 * DAY },
      // Opened 40 days ago and still open: followed, not merged.
      { created: T0 },
      // Opened exactly 30 days ago, merged after 2 days: followed and merged.
      { created: fetched - 30 * DAY, state: 1, closed: fetched - 28 * DAY },
      // Opened 29 days ago, merged after a day: too young to be in either count.
      { created: fetched - 29 * DAY, state: 1, closed: fetched - 28 * DAY },
    ],
    [],
    { fetched_through: fetched },
  );

  it('counts the PRs opened at least that long ago, and those of them merged within that many days', () => {
    expect(mergedWithin(data, all(data), 30)).toEqual({ followed: 5, merged: 2, share: 0.4 });
  });

  it('keeps to the rows given, and counts nothing for none', () => {
    expect(mergedWithin(data, Uint32Array.of(1, 5), 30)).toEqual({ followed: 1, merged: 0, share: 0 });
    expect(mergedWithin(data, new Uint32Array(0), 30)).toEqual({ followed: 0, merged: 0, share: null });
  });

  it('follows more PRs at a shorter horizon', () => {
    // At 1 day all six are followed; the last merged after exactly a day.
    expect(mergedWithin(data, all(data), 1)).toEqual({ followed: 6, merged: 1, share: 1 / 6 });
  });
});

describe('disclosureCounts', () => {
  it('counts the rows disclosing and those naming each family, a PR naming two counted under both', () => {
    const data = dataset([
      { created: T0, disclosure: 3, families: [0] },
      { created: T0, disclosure: 2, families: [0, 1] },
      { created: T0, disclosure: 1, families: [2] },
      { created: T0 },
    ]);
    expect(disclosureCounts(data, all(data))).toEqual({ rows: 4, disclosed: 3, families: [2, 1, 1] });
    expect(disclosureCounts(data, Uint32Array.of(3))).toEqual({ rows: 1, disclosed: 0, families: [0, 0, 0] });
  });
});
