// Each PR as a dot: when it opened, and how long it took to merge or close,
// or how long it has been open. The plot is drawn on a canvas so that the
// full history's 75,000 PRs stay responsive; everything here is the pure
// part of it: the points, their placement, a grid to find the one under the
// pointer, and the words and table that stand in for the canvas.

import { scaleLinear, scaleLog } from 'd3-scale';
import type { Readout, Table } from './charts';
import { COLOURS } from './colours';
import { type Dataset, PR_STATE } from './data';
import { DAY, DISCLOSED, NOT_DISCLOSED, dayOf } from './filters';
import { bucketTick, formatCount, formatDays } from './format';
import { HOUR, type Tick, durationTicks, labelWidth, logDays, monthTicks, spaceTicks } from './plot';
import { type Period, bucketEnd, bucketStart, stepFor } from './stats/buckets';

export const DOT_KIND = { merged: 0, closed: 1, open: 2 } as const;

/** The dots, in drawing order: the PRs not disclosing first, so the disclosing are drawn over them. */
export interface Dots {
  /** Each dot's dataset row. */
  rows: Uint32Array;
  created: Float64Array;
  /** Days from opening to the final disposition, or, open, to now. */
  days: Float64Array;
  /** A `DOT_KIND`. */
  kind: Uint8Array;
  /** 1 for a PR that discloses AI use. */
  disclosed: Uint8Array;
  /** Finished PRs with no time of final disposition, which are left off. */
  unknown: number;
  /** The largest of `days`, 0 with no dots. */
  longest: number;
}

export function dots(data: Dataset, rows: Uint32Array): Dots {
  const p = data.prs;
  const none = data.meta.disclosure.indexOf('none');
  const now = data.meta.fetched_through;
  const n = rows.length;
  const out = {
    rows: new Uint32Array(n),
    created: new Float64Array(n),
    days: new Float64Array(n),
    kind: new Uint8Array(n),
    disclosed: new Uint8Array(n),
  };
  let k = 0;
  let unknown = 0;
  let longest = 0;
  for (const pass of [0, 1]) {
    for (let i = 0; i < n; i++) {
      const r = rows[i] as number;
      const disclosed = p.disclosure[r] === none ? 0 : 1;
      if (disclosed !== pass) continue;
      const created = p.created[r] as number;
      const state = p.state[r];
      let end: number;
      let kind: number;
      if (state === PR_STATE.open) {
        end = now;
        kind = DOT_KIND.open;
      } else {
        end = p.closed[r] as number;
        kind = state === PR_STATE.merged ? DOT_KIND.merged : DOT_KIND.closed;
        if (end < 0) {
          unknown++;
          continue;
        }
      }
      const days = Math.max(0, end - created) / DAY;
      out.rows[k] = r;
      out.created[k] = created;
      out.days[k] = days;
      out.kind[k] = kind;
      out.disclosed[k] = disclosed;
      if (days > longest) longest = days;
      k++;
    }
  }
  return {
    rows: out.rows.slice(0, k),
    created: out.created.slice(0, k),
    days: out.days.slice(0, k),
    kind: out.kind.slice(0, k),
    disclosed: out.disclosed.slice(0, k),
    unknown,
    longest,
  };
}

export interface DotLayout {
  width: number;
  height: number;
  /** The plot's box, in pixels. */
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** Epoch seconds to x. */
  x: (t: number) => number;
  /** Days to y, on a log scale from one hour; anything shorter sits at the hour. */
  y: (days: number) => number;
  xTicks: Tick[];
  yTicks: Tick[];
}

const LEFT = 68;
const RIGHT = 16;
const TOP = 24;
const BOTTOM = 24;

/** The first instants of the months, or for a period of eight weeks or less the Mondays, inside it. */
function timeTicks(period: Period): { t: number; label: string }[] {
  const step = period.end - period.start > 56 * DAY ? 'month' : 'week';
  const out: { t: number; label: string }[] = [];
  let t = bucketStart(period.start, step);
  if (t < period.start) t = bucketEnd(t, step);
  for (; t < period.end; t = bucketEnd(t, step)) out.push({ t, label: bucketTick(t, step) });
  return out;
}

/** The first instants of the months inside the period. */
function monthStarts(period: Period): number[] {
  const out: number[] = [];
  let t = bucketStart(period.start, 'month');
  if (t < period.start) t = bucketEnd(t, 'month');
  for (; t < period.end; t = bucketEnd(t, 'month')) out.push(t);
  return out;
}

/**
 * The plot's geometry. Over a period of more than 53 weeks, which the bucket
 * charts count by month, the months are ticked on a calendar grid as theirs
 * are (`monthTicks`); over a shorter one, every month or week is ticked as
 * room allows. `measure` gives a tick label's width in pixels.
 */
export function dotLayout(
  period: Period,
  longest: number,
  width: number,
  height: number,
  measure: (label: string) => number = labelWidth,
): DotLayout {
  const months = monthStarts(period);
  const left = LEFT;
  const right = Math.max(left + 1, width - RIGHT);
  const top = TOP;
  const bottom = Math.max(top + 1, height - BOTTOM);
  const xs = scaleLinear().domain([period.start, period.end]).range([left, right]);
  const [lo, hi] = logDays(longest);
  const ys = scaleLog().domain([lo, hi]).range([bottom, top]).clamp(true);
  return {
    width,
    height,
    left,
    right,
    top,
    bottom,
    x: (t) => xs(t),
    y: (days) => ys(Math.max(days, HOUR)),
    xTicks:
      stepFor(period) === 'month'
        ? monthTicks(months, (i) => xs(months[i] as number), measure).map((t) => ({ at: xs(months[t.i] as number), label: t.label }))
        : spaceTicks(
            timeTicks(period).map((t) => ({ at: xs(t.t), label: t.label })),
            64,
          ),
    yTicks: spaceTicks(
      durationTicks(lo, hi).map((t) => ({ at: ys(t.days), label: t.label })),
      14,
    ),
  };
}

/** Each dot's place in the plot's pixels. */
export function project(d: Dots, layout: DotLayout): { xs: Float32Array; ys: Float32Array } {
  const n = d.rows.length;
  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = layout.x(d.created[i] as number);
    ys[i] = layout.y(d.days[i] as number);
  }
  return { xs, ys };
}

/** The dots bucketed into square cells, so the one under the pointer is found among its neighbours only. */
export interface DotIndex {
  cell: number;
  cols: number;
  cellRows: number;
  /** Cell c's dots are `items[start[c]]` up to `items[start[c + 1]]`, in drawing order. */
  start: Uint32Array;
  items: Uint32Array;
  xs: Float32Array;
  ys: Float32Array;
}

export function indexDots(xs: Float32Array, ys: Float32Array, width: number, height: number, cell = 16): DotIndex {
  const cols = Math.max(1, Math.ceil(width / cell));
  const cellRows = Math.max(1, Math.ceil(height / cell));
  const cellOf = (i: number) => {
    const c = Math.min(cols - 1, Math.max(0, Math.floor((xs[i] as number) / cell)));
    const r = Math.min(cellRows - 1, Math.max(0, Math.floor((ys[i] as number) / cell)));
    return r * cols + c;
  };
  const start = new Uint32Array(cols * cellRows + 1);
  for (let i = 0; i < xs.length; i++) start[cellOf(i) + 1] = (start[cellOf(i) + 1] as number) + 1;
  for (let c = 1; c < start.length; c++) start[c] = (start[c] as number) + (start[c - 1] as number);
  const next = start.slice();
  const items = new Uint32Array(xs.length);
  for (let i = 0; i < xs.length; i++) {
    const c = cellOf(i);
    items[next[c] as number] = i;
    next[c] = (next[c] as number) + 1;
  }
  return { cell, cols, cellRows, start, items, xs, ys };
}

/** The dot nearest (px, py) within `radius` pixels, the one drawn last on a tie; -1 for none. */
export function nearestDot(index: DotIndex, px: number, py: number, radius: number): number {
  const { cell, cols, cellRows, start, items, xs, ys } = index;
  const c0 = Math.max(0, Math.floor((px - radius) / cell));
  const c1 = Math.min(cols - 1, Math.floor((px + radius) / cell));
  const r0 = Math.max(0, Math.floor((py - radius) / cell));
  const r1 = Math.min(cellRows - 1, Math.floor((py + radius) / cell));
  let best = -1;
  let bestD = radius * radius;
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const cellId = r * cols + c;
      for (let k = start[cellId] as number; k < (start[cellId + 1] as number); k++) {
        const i = items[k] as number;
        const dx = (xs[i] as number) - px;
        const dy = (ys[i] as number) - py;
        const dd = dx * dx + dy * dy;
        if (dd < bestD || (dd === bestD && i > best)) {
          best = i;
          bestD = dd;
        }
      }
    }
  }
  return best;
}

function countKinds(d: Dots, disclosed: number | null): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < d.rows.length; i++) {
    if (disclosed !== null && d.disclosed[i] !== disclosed) continue;
    out[d.kind[i] as 0 | 1 | 2]++;
  }
  return out;
}

const plural = (n: number, noun: string) => `${formatCount(n)} ${noun}${n === 1 ? '' : 's'}`;

/** The text alternative of the plot: how many dots of each kind, and the range they span. */
export function describeDots(d: Dots): string {
  const n = d.rows.length;
  if (n === 0) return '';
  const [merged, closed, open] = countKinds(d, null);
  const disclosed = d.disclosed.reduce((a, b) => a + b, 0);
  const out = [
    `${plural(n, 'PR')} opened in the period: ${formatCount(merged)} merged, ${formatCount(closed)} closed unmerged and ${formatCount(open)} still open; ${formatCount(disclosed)} disclose AI use.`,
  ];
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    if (d.kind[i] === DOT_KIND.open) continue;
    lo = Math.min(lo, d.days[i] as number);
    hi = Math.max(hi, d.days[i] as number);
  }
  const finished = lo <= hi ? `Their days from opening to merging or closing run from ${formatDays(lo)} to ${formatDays(hi)}; ` : '';
  let oldest = -1;
  for (let i = 0; i < n; i++) if (d.kind[i] === DOT_KIND.open) oldest = Math.max(oldest, d.days[i] as number);
  const opens = oldest >= 0 ? `an open PR is drawn at its age, up to ${formatDays(oldest)}.` : 'none is still open.';
  out.push(finished ? `${finished}${opens}` : opens.charAt(0).toUpperCase() + opens.slice(1));
  if (d.unknown > 0) out.push(`${plural(d.unknown, 'finished PR')} with no time of merging or closing ${d.unknown === 1 ? 'is' : 'are'} left off.`);
  return out.join(' ');
}

/** The dots counted by disclosure and state: the plot's table view; the PR table lists each. */
export function dotsTable(d: Dots): Table {
  const row = (head: string, disclosed: number | null) => {
    const k = countKinds(d, disclosed);
    return { head, cells: [...k, k[0] + k[1] + k[2]].map(formatCount) };
  };
  return {
    columns: ['PRs', 'merged', 'closed unmerged', 'still open', 'all'],
    rows: [row(NOT_DISCLOSED, 0), row(DISCLOSED, 1), row('all', null)],
  };
}

const KIND_LABELS = ['to merge', 'to close unmerged', 'open so far'];

/** One dot, read out: the PR's number, when it opened, how long it took or has taken, and its disclosure. */
export function dotReadout(data: Dataset, d: Dots, i: number): { title: string; rows: Readout[] } {
  const r = d.rows[i] as number;
  const disclosed = d.disclosed[i] === 1;
  return {
    title: `#${data.prs.number[r]}`,
    rows: [
      { label: 'opened', value: dayOf(d.created[i] as number), color: null, mark: 'total' },
      { label: KIND_LABELS[d.kind[i] as number] as string, value: formatDays(d.days[i] as number), color: null, mark: 'total' },
      {
        label: 'AI use',
        value: disclosed ? 'disclosed' : 'not disclosed',
        color: disclosed ? COLOURS.disclosed : COLOURS.notDisclosed,
        mark: 'line',
        shape: 'circle',
      },
    ],
  };
}
