// Per-PR measures of a selection, summarised so that two selections can be
// set side by side: a PR's size and its bot reviews, how many disclose and
// with which tool, and how many merged within a fixed number of days.

import { type Dataset, PR_STATE } from '../data';
import { DAY } from '../filters';

/** A whole-number measure of one PR: lines added plus deleted, files changed, bot reviews. */
export type Measure = 'lines' | 'files' | 'botReviews';

export interface Distribution {
  /** The PRs measured. */
  count: number;
  mean: number;
  median: number;
  /** The 90th percentile. */
  p90: number;
  /** The share of the PRs whose value is above zero. */
  nonzero: number;
}

function valueOf(data: Dataset, measure: Measure): (r: number) => number {
  const p = data.prs;
  switch (measure) {
    case 'lines':
      return (r) => (p.additions[r] as number) + (p.deletions[r] as number);
    case 'files':
      return (r) => p.files[r] as number;
    case 'botReviews':
      return (r) => p.bot_reviews[r] as number;
  }
}

/** The least value at or under which a share `q` of the sorted values lie: a nearest-rank quantile. */
export function nearestRank(sorted: ArrayLike<number>, q: number): number {
  // q × n can round just above a whole number it equals.
  const rank = Math.max(1, Math.ceil(q * sorted.length - 1e-9));
  return sorted[rank - 1] as number;
}

/** A measure over the rows; null with no rows. */
export function distribution(data: Dataset, rows: Uint32Array, measure: Measure): Distribution | null {
  if (rows.length === 0) return null;
  const value = valueOf(data, measure);
  const values = new Float64Array(rows.length);
  let sum = 0;
  let nonzero = 0;
  for (let i = 0; i < rows.length; i++) {
    const v = value(rows[i] as number);
    values[i] = v;
    sum += v;
    if (v > 0) nonzero++;
  }
  values.sort();
  return {
    count: rows.length,
    mean: sum / rows.length,
    median: nearestRank(values, 0.5),
    p90: nearestRank(values, 0.9),
    nonzero: nonzero / rows.length,
  };
}

export interface MergedWithin {
  /** The rows opened at least the horizon before the data was fetched: every one has a known outcome at it. */
  followed: number;
  /** Those of them merged within the horizon of opening, the horizon itself included. */
  merged: number;
  /** `merged` of `followed`; null when none is followed. */
  share: number | null;
}

/**
 * Of the rows opened at least `days` before the data was fetched, how many
 * merged within `days` of opening. A plain count, not an outcome curve read
 * at that day: the curve is over every row, the young ones included up to
 * their age, so its share is not about the PRs the count beside it names.
 */
export function mergedWithin(data: Dataset, rows: Uint32Array, days: number): MergedWithin {
  const p = data.prs;
  const latest = data.meta.fetched_through - days * DAY;
  let followed = 0;
  let merged = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] as number;
    const created = p.created[r] as number;
    if (created > latest) continue;
    followed++;
    const closed = p.closed[r] as number;
    if (p.state[r] === PR_STATE.merged && closed >= 0 && closed - created <= days * DAY) merged++;
  }
  return { followed, merged, share: followed === 0 ? null : merged / followed };
}

export interface DisclosureCounts {
  /** The rows counted. */
  rows: number;
  /** Those disclosing AI use in any form. */
  disclosed: number;
  /** Those naming each of meta's `families`, by its index; a PR naming two counts under both. */
  families: number[];
}

/** How many of the rows disclose, and how many name each tool family. */
export function disclosureCounts(data: Dataset, rows: Uint32Array): DisclosureCounts {
  const p = data.prs;
  const none = data.meta.disclosure.indexOf('none');
  const families = data.meta.families.map(() => 0);
  let disclosed = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] as number;
    if (p.disclosure[r] === none) continue;
    disclosed++;
    for (const f of p.families[r] as readonly number[]) if (f < families.length) families[f] = (families[f] as number) + 1;
  }
  return { rows: rows.length, disclosed, families };
}
