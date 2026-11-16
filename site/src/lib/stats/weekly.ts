// Series over the period's weeks, or months when the period is long. Series
// by calendar week count what happened in each week; series by week opened
// describe the PRs opened in the window that week.

import { type Dataset, PR_STATE } from '../data';
import { type Buckets, type Period, type Step, bucketOf, buckets } from './buckets';
import { type Quantile, type Span, outcomeCurve, spanQuantile } from './curve';
import { HUMAN_REVIEWS, kindTable, rowMask } from './events';

/** Counts by calendar week, except `opened`, which counts by week opened. */
export type CountSeries = 'opened' | 'merged' | 'closed' | 'reviews' | 'reviewers' | 'commands';

/**
 * By week opened: the days by which each quantile of the PRs reached the
 * span's first outcome (responded, approved, merged or done).
 */
export interface WaitingSeries {
  kind: 'waitingByWeekOpened';
  span: Span;
  /** Each in (0, 1]: 0.5 for the median, 0.9 for the slowest tenth. */
  quantiles: readonly number[];
}

export type WeeklySeries = CountSeries | 'disclosureShare' | WaitingSeries;

export interface Weekly<V> {
  /** Each bucket's first instant in epoch seconds: a Monday, or the first of a month. */
  week: number[];
  step: Step;
  /** Named values, each aligned with `week`. */
  values: Record<string, V[]>;
}

/**
 * - `opened`: PRs opened, as `disclosed` and `not-disclosed`.
 * - `merged`, `closed`: final dispositions, merged and closed unmerged.
 * - `reviews`: `human` and `bot` reviews.
 * - `reviewers`: the distinct people making the human reviews.
 * - `commands`: bot commands from anyone, under each command's id.
 * - `disclosureShare`: the share of the week's opened PRs that disclose,
 *   as `disclosed` and under each tool family's id; null for a week with
 *   none opened.
 * - a `WaitingSeries`: each quantile under its number, e.g. `0.5`, as a
 *   `Quantile`: known, not yet known, not reached, or none for a week
 *   with no PR to measure.
 *
 * Only what falls inside the period counts: a week straddling its start or
 * end counts its part inside. An empty selection gives no weeks.
 */
export function weekly(data: Dataset, rows: Uint32Array, period: Period, series: CountSeries): Weekly<number>;
export function weekly(data: Dataset, rows: Uint32Array, period: Period, series: 'disclosureShare'): Weekly<number | null>;
export function weekly(data: Dataset, rows: Uint32Array, period: Period, series: WaitingSeries): Weekly<Quantile>;
export function weekly(
  data: Dataset,
  rows: Uint32Array,
  period: Period,
  series: WeeklySeries,
): Weekly<number> | Weekly<number | null> | Weekly<Quantile>;
export function weekly(
  data: Dataset,
  rows: Uint32Array,
  period: Period,
  series: WeeklySeries,
): Weekly<number> | Weekly<number | null> | Weekly<Quantile> {
  const b = buckets(period);
  const names = seriesNames(data, series);
  if (rows.length === 0) {
    return { week: [], step: b.step, values: Object.fromEntries(names.map((name) => [name, []])) };
  }
  // Each kind of series fills its columns with one kind of value, as the overloads say.
  const columns = compute(data, rows, b, series) as (number | null)[][];
  return { week: b.starts, step: b.step, values: Object.fromEntries(names.map((name, i) => [name, columns[i] ?? []])) };
}

function seriesNames(data: Dataset, series: WeeklySeries): string[] {
  if (typeof series === 'object') return series.quantiles.map(String);
  switch (series) {
    case 'opened':
      return ['disclosed', 'not-disclosed'];
    case 'merged':
      return ['merged'];
    case 'closed':
      return ['closed'];
    case 'reviews':
      return ['human', 'bot'];
    case 'reviewers':
      return ['reviewers'];
    case 'commands':
      return data.meta.commands.map((c) => c.id);
    case 'disclosureShare':
      return ['disclosed', ...data.meta.families.map((f) => f.id)];
  }
}

/** The series' columns, in the order of `seriesNames`. */
function compute(data: Dataset, rows: Uint32Array, b: Buckets, series: WeeklySeries): (number | null | Quantile)[][] {
  if (typeof series === 'object') return waiting(data, rows, b, series);
  const p = data.prs;
  switch (series) {
    case 'opened': {
      const none = data.meta.disclosure.indexOf('none');
      const out = zeros(2, b);
      forOpened(data, rows, b, (r, w) => count(out, p.disclosure[r] === none ? 1 : 0, w));
      return out;
    }
    case 'merged':
    case 'closed': {
      const state = series === 'merged' ? PR_STATE.merged : PR_STATE.closed;
      const out = zeros(1, b);
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i] as number;
        if (p.state[r] !== state) continue;
        const w = bucketOf(b, p.closed[r] as number);
        if (w !== -1) count(out, 0, w);
      }
      return out;
    }
    case 'reviews': {
      const table = kindTable(data, { ...Object.fromEntries(HUMAN_REVIEWS.map((k) => [k, 0])), bot_review: 1 });
      const out = zeros(2, b);
      forEvents(data, rows, b, (e, w) => {
        const column = table[data.events.kind[e] as number] as number;
        if (column !== -1) count(out, column, w);
      });
      return out;
    }
    case 'reviewers':
      return [reviewers(data, rows, b)];
    case 'commands': {
      const table = kindTable(data, { command_author: 1, command_other: 1 });
      const commands = data.meta.commands.length;
      const out = zeros(commands, b);
      forEvents(data, rows, b, (e, w) => {
        const sub = data.events.sub[e] as number;
        if (table[data.events.kind[e] as number] === 1 && sub >= 0 && sub < commands) count(out, sub, w);
      });
      return out;
    }
    case 'disclosureShare':
      return disclosureShare(data, rows, b);
  }
}

function zeros(n: number, b: Buckets): number[][] {
  return Array.from({ length: n }, () => b.starts.map(() => 0));
}

function count(out: number[][], column: number, w: number) {
  const c = out[column] as number[];
  c[w] = (c[w] as number) + 1;
}

/** Calls `fn` for each row opened in the window during the period, with its bucket. */
function forOpened(data: Dataset, rows: Uint32Array, b: Buckets, fn: (r: number, w: number) => void) {
  const p = data.prs;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] as number;
    if (p.in_window[r] !== 1) continue;
    const w = bucketOf(b, p.created[r] as number);
    if (w !== -1) fn(r, w);
  }
}

/** Calls `fn` for each event of the rows inside the period, with its bucket. */
function forEvents(data: Dataset, rows: Uint32Array, b: Buckets, fn: (e: number, w: number) => void) {
  const mask = rowMask(data, rows);
  const ev = data.events;
  for (let e = 0; e < ev.pr.length; e++) {
    if (mask[ev.pr[e] as number] !== 1) continue;
    const w = bucketOf(b, ev.at[e] as number);
    if (w !== -1) fn(e, w);
  }
}

// Each (bucket, person) pair is one number in a set: actors are 31-bit.
const ACTORS = 2 ** 31;

function reviewers(data: Dataset, rows: Uint32Array, b: Buckets): number[] {
  const table = kindTable(data, Object.fromEntries(HUMAN_REVIEWS.map((k) => [k, 1])));
  const seen = new Set<number>();
  forEvents(data, rows, b, (e, w) => {
    const actor = data.events.actor[e] as number;
    if (table[data.events.kind[e] as number] === 1 && actor >= 0) seen.add(w * ACTORS + actor);
  });
  const out = b.starts.map(() => 0);
  for (const pair of seen) {
    const w = Math.floor(pair / ACTORS);
    out[w] = (out[w] as number) + 1;
  }
  return out;
}

function disclosureShare(data: Dataset, rows: Uint32Array, b: Buckets): (number | null)[][] {
  const p = data.prs;
  const none = data.meta.disclosure.indexOf('none');
  const families = data.meta.families.length;
  const opened = b.starts.map(() => 0);
  // Column 0 is the PRs disclosing; column 1 + f those naming family f.
  const out = zeros(1 + families, b);
  forOpened(data, rows, b, (r, w) => {
    opened[w] = (opened[w] as number) + 1;
    if (p.disclosure[r] === none) return;
    count(out, 0, w);
    for (const f of p.families[r] as readonly number[]) if (f < families) count(out, 1 + f, w);
  });
  return out.map((column) => column.map((n, w) => (opened[w] === 0 ? null : n / (opened[w] as number))));
}

function waiting(data: Dataset, rows: Uint32Array, b: Buckets, series: WaitingSeries): Quantile[][] {
  // Partition the rows opened in each bucket into one array, bucket by bucket.
  const sizes = new Uint32Array(b.starts.length + 1);
  forOpened(data, rows, b, (_r, w) => (sizes[w + 1] = (sizes[w + 1] as number) + 1));
  for (let w = 1; w < sizes.length; w++) sizes[w] = (sizes[w] as number) + (sizes[w - 1] as number);
  const offsets = sizes.slice();
  const byWeek = new Uint32Array(sizes[sizes.length - 1] as number);
  forOpened(data, rows, b, (r, w) => {
    byWeek[offsets[w] as number] = r;
    offsets[w] = (offsets[w] as number) + 1;
  });

  const out = series.quantiles.map(() => b.starts.map((): Quantile => ({ state: 'none' })));
  for (let w = 0; w < b.starts.length; w++) {
    const week = byWeek.subarray(sizes[w], sizes[w + 1]);
    if (week.length === 0) continue;
    const curve = outcomeCurve(data, week, series.span);
    series.quantiles.forEach((q, i) => ((out[i] as Quantile[])[w] = spanQuantile(curve, series.span, q)));
  }
  return out;
}
