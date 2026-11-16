// Outcome curves: by day N of a span, the share of PRs that reached each
// outcome. Outcomes compete, and a PR with none yet counts only up to its
// age, so unfinished PRs are kept rather than averaged away. This is the
// cumulative incidence (Aalen–Johansen) estimate.

import { type Dataset, PR_STATE } from '../data';
import { DAY } from '../filters';

/**
 * Each span's outcomes. When there are three, the last is what remains,
 * the share with no outcome yet; a span with one outcome is a complete fact.
 */
export const SPAN_OUTCOMES = {
  /** Opened to the final disposition, drafts included. */
  merge: ['merged', 'closed', 'open'],
  /** Ready to the first human response, or to finishing without one. */
  response: ['responded', 'finished', 'waiting'],
  /** Ready to the first human approval, or to finishing without one. */
  approval: ['approved', 'finished', 'waiting'],
  /** First approval to the final disposition, of PRs approved before it. */
  afterApproval: ['merged', 'closed', 'open'],
  /** Last commit to the final disposition. */
  afterLastCommit: ['merged', 'closed', 'open'],
  /** First commit to opened. */
  firstCommitToOpened: ['done'],
  /** Opened to the last commit, of finished PRs: an open PR's can still move. */
  openedToLastCommit: ['done'],
} as const satisfies Record<string, readonly string[]>;

export type Span = keyof typeof SPAN_OUTCOMES;
export type Outcome<S extends Span> = (typeof SPAN_OUTCOMES)[S][number];

export interface Curve<O extends string = string> {
  /**
   * Every distinct duration in days, ascending: where an outcome happened or
   * a PR with none yet left at its age. Before `days[0]` every outcome's
   * share is 0 and what remains is 1.
   */
  days: number[];
  /** Each outcome's share from that day on, aligned with `days`. */
  shares: Record<O, number[]>;
  /**
   * How many PRs on the curve reached each outcome; what remains counts the
   * PRs with none yet, which are still at risk whatever their age.
   */
  counts: Record<O, number>;
}

// A row is packed into one number, its duration in seconds times 8 plus its
// outcome, so a native numeric sort orders the rows by duration with
// outcomes before the PRs leaving at the same time, and allocates nothing
// per row.
const CODES = 8;
const LEFT = 7;
const OUT = -1;

function pack(from: number, to: number, code: number): number {
  return Math.max(0, to - from) * CODES + code;
}

/** Packs a row for a span, or gives OUT when the span cannot be measured on it. */
function keyFor(data: Dataset, span: Span): (r: number) => number {
  const p = data.prs;
  const now = data.meta.fetched_through;
  // From `start` to the final disposition: merged, closed, or open now.
  const disposition = (start: number, r: number): number => {
    if (start < 0) return OUT;
    const state = p.state[r];
    if (state === PR_STATE.open) return pack(start, now, LEFT);
    const end = p.closed[r] as number;
    if (end < 0) return OUT;
    return pack(start, end, state === PR_STATE.merged ? 0 : 1);
  };
  // From ready to the first of an event or finishing without it.
  const firstOf = (event: Float64Array) => (r: number): number => {
    const start = p.ready[r] as number;
    if (start < 0) return OUT;
    const t = event[r] as number;
    const open = p.state[r] === PR_STATE.open;
    const end = p.closed[r] as number;
    if (!open && end < 0) return OUT;
    if (t >= 0 && (open || t <= end)) return pack(start, t, 0);
    return open ? pack(start, now, LEFT) : pack(start, end, 1);
  };
  switch (span) {
    case 'merge':
      return (r) => disposition(p.created[r] as number, r);
    case 'response':
      return firstOf(p.first_response);
    case 'approval':
      return firstOf(p.first_approval);
    case 'afterApproval':
      return (r) => {
        const approved = p.first_approval[r] as number;
        // GitHub takes a review on a finished PR; the approval span counts
        // that PR as finished without an approval, so it has no span after.
        if (p.state[r] !== PR_STATE.open && approved > (p.closed[r] as number)) return OUT;
        return disposition(approved, r);
      };
    case 'afterLastCommit':
      return (r) => disposition(p.last_commit[r] as number, r);
    case 'firstCommitToOpened':
      return (r) => {
        const first = p.first_commit[r] as number;
        const created = p.created[r] as number;
        // A first commit after the opening means the history was rewritten.
        return first < 0 || first > created ? OUT : pack(first, created, 0);
      };
    case 'openedToLastCommit':
      return (r) => {
        const last = p.last_commit[r] as number;
        return p.state[r] === PR_STATE.open || last < 0 ? OUT : pack(p.created[r] as number, last, 0);
      };
  }
}

/**
 * The outcome curve of a span over the rows given. The page's curves are of
 * the PRs opened in the period, which `openedIn` keeps.
 */
export function outcomeCurve<S extends Span>(data: Dataset, rows: Uint32Array, span: S): Curve<Outcome<S>> {
  const names: readonly string[] = SPAN_OUTCOMES[span];
  // A span with three outcomes reports what remains as the last.
  const kinds = names.length === 1 ? 1 : names.length - 1;
  const key = keyFor(data, span);
  const keys = new Float64Array(rows.length);
  let n = 0;
  for (let i = 0; i < rows.length; i++) {
    const k = key(rows[i] as number);
    if (k !== OUT) keys[n++] = k;
  }
  const sorted = keys.subarray(0, n).sort();

  const days: number[] = [];
  const series: number[][] = names.map(() => []);
  const shares = new Float64Array(kinds);
  const count = new Float64Array(kinds);
  // PRs per outcome; a PR with none yet counts under what remains.
  const totals = new Float64Array(names.length);
  let remaining = 1;
  let atRisk = n;
  for (let i = 0; i < n; ) {
    const seconds = Math.floor((sorted[i] as number) / CODES);
    count.fill(0);
    let leaving = 0;
    for (; i < n && Math.floor((sorted[i] as number) / CODES) === seconds; i++, leaving++) {
      const code = (sorted[i] as number) - seconds * CODES;
      if (code !== LEFT) count[code] = (count[code] as number) + 1;
      const t = code === LEFT ? kinds : code;
      totals[t] = (totals[t] as number) + 1;
    }
    let outcomes = 0;
    for (let k = 0; k < kinds; k++) {
      const d = count[k] as number;
      outcomes += d;
      shares[k] = (shares[k] as number) + (remaining * d) / atRisk;
    }
    // S × n / n can round above S, so a time with no outcome leaves S alone.
    if (outcomes === atRisk) remaining = 0;
    else if (outcomes > 0) remaining = (remaining * (atRisk - outcomes)) / atRisk;
    atRisk -= leaving;
    days.push(seconds / DAY);
    for (let k = 0; k < kinds; k++) series[k]?.push(Math.min(1, shares[k] as number));
    if (names.length > kinds) series[kinds]?.push(remaining);
  }
  const out: Record<string, number[]> = {};
  const counts: Record<string, number> = {};
  names.forEach((name, k) => {
    out[name] = series[k] as number[];
    counts[name] = totals[k] as number;
  });
  return { days, shares: out as Record<Outcome<S>, number[]>, counts: counts as Record<Outcome<S>, number> };
}

// Floating-point sums of shares may fall short of a quantile they reach.
const EPSILON = 1e-9;

/**
 * The day an outcome's share first reaches `q`, in (0, 1]: 0.5 is the
 * median. Null when the curve has not reached it, which is "not yet known".
 */
export function quantileDays<O extends string>(curve: Curve<O>, outcome: O, q: number): number | null {
  const s = curve.shares[outcome];
  for (let i = 0; i < s.length; i++) if ((s[i] as number) >= q - EPSILON) return curve.days[i] as number;
  return null;
}

/** A quantile of a span's first outcome, with the reason when it has no value. */
export type Quantile =
  | { state: 'known'; days: number }
  /** Enough PRs are still waiting for the outcome's share to reach it. */
  | { state: 'notYetKnown' }
  /**
   * It can no longer be reached: the PRs that reached the outcome plus every
   * PR still waiting fall short of it. `share` is the outcome's share now.
   */
  | { state: 'notReached'; share: number }
  /** The curve has no PR on it. */
  | { state: 'none' };

/**
 * The day the span's first outcome (merged, responded, approved, done)
 * reaches the share `q`, telling a quantile that may still come from one that
 * no longer can. That is decided from counts, not from the curve's tail: the
 * curve's share still waiting falls to 0 once its slowest finished PR
 * outlasts a younger one still open, which may yet reach the outcome.
 */
export function spanQuantile<S extends Span>(curve: Curve<Outcome<S>>, span: S, q: number): Quantile {
  if (curve.days.length === 0) return { state: 'none' };
  const names: readonly Outcome<S>[] = SPAN_OUTCOMES[span];
  const first = names[0] as Outcome<S>;
  const days = quantileDays(curve, first, q);
  if (days !== null) return { state: 'known', days };
  const all = names.reduce((n, o) => n + curve.counts[o], 0);
  // With one outcome a span is complete, so nothing still waits.
  const waiting = names.length === 3 ? curve.counts[names[2] as Outcome<S>] : 0;
  if ((curve.counts[first] + waiting) / all >= q - EPSILON) return { state: 'notYetKnown' };
  return { state: 'notReached', share: curve.shares[first].at(-1) as number };
}
