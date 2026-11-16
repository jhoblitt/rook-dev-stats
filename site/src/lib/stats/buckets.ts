// The time steps of the calendar charts: an ISO week (Monday 00:00 UTC) for a
// period of up to 53 weeks, a calendar month beyond.

import { DAY } from '../filters';

/** Epoch seconds, `start` inclusive and `end` exclusive, as `periodRange` gives. */
export interface Period {
  start: number;
  end: number;
}

export type Step = 'week' | 'month';

const WEEK = 7 * DAY;

export function stepFor(period: Period): Step {
  return period.end - period.start <= 53 * WEEK ? 'week' : 'month';
}

/** The first instant of the bucket holding `t`. */
export function bucketStart(t: number, step: Step): number {
  if (step === 'week') {
    const day = Math.floor(t / DAY);
    // Day 0, 1970-01-01, was a Thursday: three days after a Monday.
    const sinceMonday = (((day + 3) % 7) + 7) % 7;
    return (day - sinceMonday) * DAY;
  }
  const d = new Date(t * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000;
}

/** The first instant after the bucket that starts at `start`. */
export function bucketEnd(start: number, step: Step): number {
  if (step === 'week') return start + WEEK;
  const d = new Date(start * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000;
}

export interface Buckets {
  period: Period;
  step: Step;
  /** The first instant of each bucket that overlaps the period, ascending. */
  starts: number[];
}

export function buckets(period: Period): Buckets {
  const step = stepFor(period);
  const starts: number[] = [];
  for (let s = bucketStart(period.start, step); s < period.end; s = bucketEnd(s, step)) starts.push(s);
  return { period, step, starts };
}

/**
 * The index of the bucket holding `t`, or -1 when `t` is outside the period:
 * a bucket that straddles an end of the period counts only its part inside.
 */
export function bucketOf(b: Buckets, t: number): number {
  if (!(t >= b.period.start && t < b.period.end)) return -1;
  const starts = b.starts;
  if (b.step === 'week') return Math.floor((t - (starts[0] as number)) / WEEK);
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((starts[mid] as number) <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
