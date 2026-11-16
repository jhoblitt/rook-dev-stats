// The open backlog at the end of each week (or month), in age bands, and the
// part of it waiting for a first response.

import type { Dataset } from '../data';
import { AGE_BANDS, type AgeBand, DAY } from '../filters';
import { type Period, type Step, bucketEnd, buckets, stepFor } from './buckets';
import type { Weekly } from './weekly';

/** Each band's ages in days since opening, the lower bound inclusive. */
const AGE_DAYS: Record<AgeBand, readonly [number, number]> = {
  lt7: [0, 7],
  '7-30': [7, 30],
  '30-90': [30, 90],
  gt90: [90, Infinity],
};

export interface Backlog {
  /** Each bucket's first instant in epoch seconds: a Monday, or the first of a month. */
  week: number[];
  step: Step;
  /** The PRs open at each bucket's end, by age band, aligned with `week`. */
  bands: Record<AgeBand, number[]>;
}

/** The first index whose value is at least `x`. */
function lowerBound(sorted: ArrayLike<number>, x: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((sorted[mid] as number) < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** A stretch of time a row was open: the instants t with from < t <= to. */
type Stretch = (r: number, from: number, to: number) => void;

/**
 * Walks a row's open stretches. A reopened row's closed stretches run from
 * each `closed` event to the `reopened` event after it; its last open
 * stretch ends at the final disposition.
 */
function openStretches(data: Dataset): (r: number, fn: Stretch) => void {
  const p = data.prs;
  const ev = data.events;
  const closedKind = data.meta.event_kinds.indexOf('closed');
  const reopenedKind = data.meta.event_kinds.indexOf('reopened');
  return (r, fn) => {
    const end = (p.closed[r] as number) < 0 ? Infinity : (p.closed[r] as number);
    let from = p.created[r] as number;
    let open = true;
    if ((p.reopened[r] as number) > 0) {
      for (let e = lowerBound(ev.pr, r); e < ev.pr.length && ev.pr[e] === r; e++) {
        const kind = ev.kind[e];
        if (open && kind === closedKind) {
          fn(r, from, ev.at[e] as number);
          open = false;
        } else if (!open && kind === reopenedKind) {
          from = ev.at[e] as number;
          open = true;
        }
      }
    }
    if (open) fn(r, from, end);
  };
}

/** A stretch of time a row was out of draft: the instants t with from <= t < to. */
type Ready = (from: number, to: number) => void;

/**
 * Walks a row's stretches out of draft. At an instant the row is out of draft
 * when its latest `ready` or `draft` event at or before it is a `ready`, or,
 * with neither yet, when it was opened ready. Events of the same second take
 * effect in their order in the events file, which keeps GitHub's timeline
 * order, so the later of the two wins.
 */
function readyStretches(data: Dataset): (r: number, fn: Ready) => void {
  const p = data.prs;
  const ev = data.events;
  const readyKind = data.meta.event_kinds.indexOf('ready');
  const draftKind = data.meta.event_kinds.indexOf('draft');
  return (r, fn) => {
    let ready = (p.opened_draft[r] as number) === 0;
    let from = -Infinity;
    for (let e = lowerBound(ev.pr, r); e < ev.pr.length && ev.pr[e] === r; e++) {
      const kind = ev.kind[e];
      if (ready && kind === draftKind) {
        fn(from, ev.at[e] as number);
        ready = false;
      } else if (!ready && kind === readyKind) {
        from = ev.at[e] as number;
        ready = true;
      }
    }
    if (ready) fn(from, Infinity);
  };
}

/**
 * The instant the backlog of the period's bucket starting at `bucket` is
 * measured: the bucket's end, or the period's end or `fetched_through` when
 * either comes first.
 */
export function backlogMoment(data: Dataset, period: Period, bucket: number): number {
  return Math.min(bucketEnd(bucket, stepFor(period)), period.end, data.meta.fetched_through);
}

/**
 * The rows open at each bucket's `backlogMoment`: opened before then and not
 * inside a closed stretch.
 */
export function backlog(data: Dataset, rows: Uint32Array, period: Period): Backlog {
  const b = buckets(period);
  if (rows.length === 0) return { week: [], step: b.step, bands: { lt7: [], '7-30': [], '30-90': [], gt90: [] } };
  const p = data.prs;
  const moments = Float64Array.from(b.starts, (s) => backlogMoment(data, period, s));
  // Per band, +1 where a row starts counting and -1 where it stops.
  const diff = AGE_BANDS.map(() => new Int32Array(moments.length + 1));

  // Counts row `r` at each moment in the stretch, in the band of its age then.
  const count: Stretch = (r, from, to) => {
    const created = p.created[r] as number;
    AGE_BANDS.forEach((band, k) => {
      const [young, old] = AGE_DAYS[band.id];
      // Times are whole seconds, so from < t <= to is from + 1 <= t < to + 1.
      const first = lowerBound(moments, Math.max(from + 1, created + young * DAY));
      const last = lowerBound(moments, Math.min(to + 1, created + old * DAY));
      if (first < last) {
        const d = diff[k] as Int32Array;
        d[first] = (d[first] as number) + 1;
        d[last] = (d[last] as number) - 1;
      }
    });
  };

  const walk = openStretches(data);
  for (let i = 0; i < rows.length; i++) walk(rows[i] as number, count);

  const bands = {} as Backlog['bands'];
  AGE_BANDS.forEach((band, k) => {
    const d = diff[k] as Int32Array;
    let running = 0;
    bands[band.id] = b.starts.map((_, w) => (running += d[w] as number));
  });
  return { week: b.starts, step: b.step, bands };
}

/**
 * The rows waiting for a first response at each bucket's `backlogMoment`,
 * under `waiting`: open then, out of draft then by their `ready` and `draft`
 * events, and with no first response yet. A row that is a draft at the
 * moment does not count, whatever came before; one never made ready never
 * counts; one closed unanswered stops counting when it closes, and counts
 * again if reopened; one put back into draft counts again from its next
 * `ready`.
 */
export function awaitingResponse(data: Dataset, rows: Uint32Array, period: Period): Weekly<number> {
  const b = buckets(period);
  if (rows.length === 0) return { week: [], step: b.step, values: { waiting: [] } };
  const p = data.prs;
  const moments = Float64Array.from(b.starts, (s) => backlogMoment(data, period, s));
  const diff = new Int32Array(moments.length + 1);
  const readyWalk = readyStretches(data);

  // The moments in each open stretch that are also in a stretch out of draft
  // and before the answer. Both kinds of stretch are disjoint, so each moment
  // is counted at most once.
  const count: Stretch = (r, from, to) => {
    const answered = p.first_response[r] as number;
    const until = Math.min(to + 1, answered < 0 ? Infinity : answered);
    readyWalk(r, (readyFrom, readyTo) => {
      // Waiting at t when from < t <= to, readyFrom <= t < readyTo, and t < answered.
      const first = lowerBound(moments, Math.max(from + 1, readyFrom));
      const last = lowerBound(moments, Math.min(until, readyTo));
      if (first < last) {
        diff[first] = (diff[first] as number) + 1;
        diff[last] = (diff[last] as number) - 1;
      }
    });
  };

  const walk = openStretches(data);
  for (let i = 0; i < rows.length; i++) walk(rows[i] as number, count);

  let running = 0;
  return { week: b.starts, step: b.step, values: { waiting: b.starts.map((_, w) => (running += diff[w] as number)) } };
}

/**
 * The rows open at instant `at` whose age then falls in `band`. With `at`
 * the `backlogMoment` of a bucket, these are the PRs behind that band of the
 * bucket's bar.
 */
export function backlogRows(data: Dataset, rows: Uint32Array, band: AgeBand, at: number): Uint32Array {
  const p = data.prs;
  const [young, old] = AGE_DAYS[band];
  const walk = openStretches(data);
  let open = false;
  const openAt: Stretch = (_r, from, to) => {
    if (from < at && at <= to) open = true;
  };
  const out = new Uint32Array(rows.length);
  let n = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] as number;
    const created = p.created[r] as number;
    if (!(created + young * DAY <= at && at < created + old * DAY)) continue;
    open = false;
    walk(r, openAt);
    if (open) out[n++] = r;
  }
  return out.slice(0, n);
}
