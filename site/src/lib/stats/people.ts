// Figures per person over a selection: what each author's PRs came to, and
// what each reviewer did on other people's PRs. People are indexes into
// meta's `people`; the page names them as handles.ts writes them.

import { type Dataset, PR_STATE } from '../data';
import { DAY } from '../filters';
import type { Period } from './buckets';
import { type Quantile, type Span, outcomeCurve, spanQuantile } from './curve';
import { kindTable } from './events';
import { nearestRank } from './measures';

/** A median over fewer PRs than this is not shown. */
export const MIN_PRS = 5;

/**
 * A median, with the PRs behind it. `tooFew` when there are fewer than
 * `MIN_PRS`; otherwise a quantile of an outcome curve, known, not yet known
 * or not reached, or a known duration for a median of durations.
 */
export type Median = { prs: number } & (
  | { state: 'tooFew' }
  | Exclude<Quantile, { state: 'none' }>
);

export interface AuthorRow {
  person: number;
  /** The selected PRs this person opened in the period. */
  opened: number;
  merged: number;
  /** Closed without merging. */
  closed: number;
  open: number;
  /** The sum of those PRs' commit counts. */
  commits: number;
  additions: number;
  deletions: number;
  /** Lines added plus lines deleted. */
  lines: number;
  /** Days from ready to the first human response, from the outcome curve over these PRs. */
  response: Median;
  /** Days from opened to merged, from the outcome curve over these PRs. */
  merge: Median;
  /** Those of these PRs that disclose AI use. */
  disclosed: number;
}

/** The median of a span's outcome curve over `rows`. */
function curveMedian(data: Dataset, rows: Uint32Array, span: Span): Median {
  const curve = outcomeCurve(data, rows, span);
  const prs = Object.values<number>(curve.counts).reduce((n, c) => n + c, 0);
  if (prs < MIN_PRS) return { state: 'tooFew', prs };
  const q = spanQuantile(curve, span, 0.5);
  // A curve with PRs on it always has a quantile; `none` cannot follow from five.
  return q.state === 'none' ? { state: 'tooFew', prs } : { ...q, prs };
}

/** Groups the rows by `of(row)`, keeping each group in the rows' order. */
function groupBy(rows: Uint32Array, of: (r: number) => number): Map<number, Uint32Array> {
  const sizes = new Map<number, number>();
  for (let i = 0; i < rows.length; i++) {
    const k = of(rows[i] as number);
    sizes.set(k, (sizes.get(k) ?? 0) + 1);
  }
  const out = new Map<number, Uint32Array>();
  const filled = new Map<number, number>();
  for (const [k, n] of sizes) {
    out.set(k, new Uint32Array(n));
    filled.set(k, 0);
  }
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] as number;
    const k = of(r);
    const at = filled.get(k) as number;
    (out.get(k) as Uint32Array)[at] = r;
    filled.set(k, at + 1);
  }
  return out;
}

/**
 * One row per author of the rows given, in order of first appearance. The
 * page passes the selected PRs opened in the period, which `openedIn` keeps.
 */
export function authorRows(data: Dataset, rows: Uint32Array): AuthorRow[] {
  const p = data.prs;
  const none = data.meta.disclosure.indexOf('none');
  const out: AuthorRow[] = [];
  for (const [person, own] of groupBy(rows, (r) => p.author[r] as number)) {
    const row: AuthorRow = {
      person,
      opened: own.length,
      merged: 0,
      closed: 0,
      open: 0,
      commits: 0,
      additions: 0,
      deletions: 0,
      lines: 0,
      response: curveMedian(data, own, 'response'),
      merge: curveMedian(data, own, 'merge'),
      disclosed: 0,
    };
    for (let i = 0; i < own.length; i++) {
      const r = own[i] as number;
      const state = p.state[r];
      if (state === PR_STATE.merged) row.merged++;
      else if (state === PR_STATE.closed) row.closed++;
      else row.open++;
      row.commits += p.commits[r] as number;
      row.additions += p.additions[r] as number;
      row.deletions += p.deletions[r] as number;
      if (p.disclosure[r] !== none) row.disclosed++;
    }
    row.lines = row.additions + row.deletions;
    out.push(row);
  }
  return out;
}

export interface ReviewerRow {
  person: number;
  /** The selected PRs this person reviewed or commented on during the period. */
  prs: number;
  /** Reviews during the period, by verdict; a dismissed review counts as commenting. */
  approved: number;
  changes: number;
  commented: number;
  /** Comments during the period, outside a review. */
  comments: number;
  /**
   * The selected PRs whose first human response, made during the period and
   * before the PR was finally merged or closed, was this person's.
   */
  firstResponses: number;
  /**
   * Days from a PR being ready to this person's first comment or review on
   * it, over the PRs where that came during the period and before the PR
   * was finally merged or closed. A plain median of durations: each one
   * happened.
   */
  response: Median;
}

const COMMENT = 0;
const APPROVED = 1;
const CHANGES = 2;
const COMMENTED = 3;

/**
 * One row per person who reviewed or commented on a selected PR they did not
 * open, during the period, in order of first appearance. These are the
 * events that name an actor: a bot command, a comment by the PR's author and
 * a review-thread reply by the author name none.
 */
export function reviewerRows(data: Dataset, rows: Uint32Array, period: Period): ReviewerRow[] {
  const p = data.prs;
  const ev = data.events;
  const table = kindTable(data, {
    comment_other: COMMENT,
    review_approved: APPROVED,
    review_changes: CHANGES,
    review_commented: COMMENTED,
  });
  const selected = new Uint8Array(data.size);
  for (let i = 0; i < rows.length; i++) selected[rows[i] as number] = 1;

  const byPerson = new Map<number, ReviewerRow & { reviewed: Set<number>; waits: number[] }>();
  const of = (person: number) => {
    let row = byPerson.get(person);
    if (!row) {
      row = {
        person,
        prs: 0,
        approved: 0,
        changes: 0,
        commented: 0,
        comments: 0,
        firstResponses: 0,
        response: { state: 'tooFew', prs: 0 },
        reviewed: new Set(),
        waits: [],
      };
      byPerson.set(person, row);
    }
    return row;
  };
  const inPeriod = (t: number) => t >= period.start && t < period.end;
  // A response after the PR was finally merged or closed came too late to be
  // one, as on the rest of the page; one while it was closed, before a
  // reopening, still counts.
  const inTime = (r: number, t: number) => p.state[r] === PR_STATE.open || t <= (p.closed[r] as number);

  // Events are sorted by PR, then time: each PR's run is scanned once, and
  // a person's first event on it is the first one met.
  for (let e = 0; e < ev.pr.length; ) {
    const r = ev.pr[e] as number;
    let end = e;
    while (end < ev.pr.length && ev.pr[end] === r) end++;
    if (selected[r] === 1) {
      const ready = p.ready[r] as number;
      const seen = new Set<number>();
      let first = true;
      for (let i = e; i < end; i++) {
        const what = table[ev.kind[i] as number] as number;
        const person = ev.actor[i] as number;
        // An event that names an actor is by the data's rule never the
        // author's: the author's own carry none. Comparing with the author's
        // index would be wrong: every deleted account's comment or review
        // names the pooled `ghost` entry, which can be the author's index
        // without being the author.
        if (what === -1 || person < 0) continue;
        const t = ev.at[i] as number;
        const row = inPeriod(t) ? of(person) : null;
        if (row) {
          row.reviewed.add(r);
          if (what === COMMENT) row.comments++;
          else if (what === APPROVED) row.approved++;
          else if (what === CHANGES) row.changes++;
          else row.commented++;
        }
        // The PR's first human response is its first such event; the data's
        // `first_response` is that event's time, or ready when it came before.
        if (first) {
          first = false;
          const response = p.first_response[r] as number;
          if (row && response >= 0 && inTime(r, response)) row.firstResponses++;
        }
        if (!seen.has(person)) {
          seen.add(person);
          if (row && ready >= 0 && inTime(r, Math.max(t, ready))) row.waits.push(Math.max(0, t - ready) / DAY);
        }
      }
    }
    e = end;
  }

  return [...byPerson.values()].map(({ reviewed, waits, ...row }) => {
    const sorted = Float64Array.from(waits).sort();
    const response: Median =
      sorted.length < MIN_PRS
        ? { state: 'tooFew', prs: sorted.length }
        : { state: 'known', days: nearestRank(sorted, 0.5), prs: sorted.length };
    return { ...row, prs: reviewed.size, response };
  });
}
