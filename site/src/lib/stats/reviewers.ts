// Reviewer load as two numbers: how many people reviewed, and the share the
// busiest of them made. The People section names them.

import type { Dataset } from '../data';
import type { Period } from './buckets';
import { HUMAN_REVIEWS, kindTable, rowMask } from './events';

export interface ReviewLoad {
  /** The distinct people who made the human reviews. */
  reviewers: number;
  /** The share of those reviews the `top` busiest people made; null when there is no review to share. */
  share: number | null;
}

/** Who carried the human reviews made on the rows during the period, as two numbers. */
export function reviewLoad(data: Dataset, rows: Uint32Array, period: Period, top: number): ReviewLoad {
  const table = kindTable(data, Object.fromEntries(HUMAN_REVIEWS.map((k) => [k, 1])));
  const mask = rowMask(data, rows);
  const ev = data.events;
  const byActor = new Map<number, number>();
  let total = 0;
  for (let e = 0; e < ev.pr.length; e++) {
    const t = ev.at[e] as number;
    if (mask[ev.pr[e] as number] !== 1 || table[ev.kind[e] as number] !== 1 || t < period.start || t >= period.end) {
      continue;
    }
    total++;
    const actor = ev.actor[e] as number;
    if (actor >= 0) byActor.set(actor, (byActor.get(actor) ?? 0) + 1);
  }
  if (total === 0) return { reviewers: byActor.size, share: null };
  const busiest = [...byActor.values()].sort((a, b) => b - a).slice(0, top);
  return { reviewers: byActor.size, share: busiest.reduce((n, c) => n + c, 0) / total };
}

/**
 * The share of the human reviews made on the rows during the period that the
 * `top` busiest people made; null when there is no review to share.
 */
export function reviewerShare(data: Dataset, rows: Uint32Array, period: Period, top: number): number | null {
  return reviewLoad(data, rows, period, top).share;
}
