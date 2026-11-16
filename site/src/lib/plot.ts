// Geometry the chart parts share, kept out of the components so it can be
// tested without a DOM.

import { symbol, symbolCircle, symbolDiamond, symbolSquare, symbolTriangle } from 'd3-shape';
import type { Shape } from './charts';
import { bucketTick } from './format';
import type { Step } from './stats/buckets';

const SYMBOLS = { circle: symbolCircle, square: symbolSquare, triangle: symbolTriangle, diamond: symbolDiamond };

/** A marker centred on 0,0; `size` is its area in square pixels, 64 being about 8px across. */
export function markerPath(shape: Shape, size = 64): string {
  return symbol(SYMBOLS[shape], size)() ?? '';
}

/**
 * A bar `w` wide from `y` down to `y + h`, its data end at `y` rounded by
 * `r` and its baseline square. The radius shrinks to fit a short or narrow
 * bar; an empty bar draws nothing.
 */
export function barPath(x: number, y: number, w: number, h: number, r: number): string {
  if (h <= 0 || w <= 0) return '';
  const base = y + h;
  const k = Math.min(r, h, w / 2);
  if (k <= 0) return `M${x},${base}V${y}H${x + w}V${base}Z`;
  return (
    `M${x},${base}V${y + k}A${k},${k} 0 0 1 ${x + k},${y}` +
    `H${x + w - k}A${k},${k} 0 0 1 ${x + w},${y + k}V${base}Z`
  );
}

/** An axis tick: where it sits along its axis, in the plot's pixels, and its label. */
export interface Tick {
  at: number;
  label: string;
  /** The selected bucket's tick, set in bold. */
  strong?: boolean;
}

/** An hour in days: the left (or bottom) edge of a log duration axis. */
export const HOUR = 1 / 24;

const ROUND_DURATIONS = [
  { days: HOUR, label: '1 hour' },
  { days: 1, label: '1 day' },
  { days: 7, label: '1 week' },
  { days: 30, label: '1 month' },
  { days: 90, label: '3 months' },
  { days: 365, label: '1 year' },
  { days: 2 * 365, label: '2 years' },
  { days: 5 * 365, label: '5 years' },
  { days: 10 * 365, label: '10 years' },
];

/**
 * A log duration axis's domain in days: from one hour, where anything shorter
 * is drawn, to the longest duration, and at least to a day.
 */
export function logDays(longest: number): [number, number] {
  return [HOUR, Math.max(1, longest)];
}

/** The round durations that fall on a log duration axis, labelled with their units. */
export function durationTicks(min: number, max: number): { days: number; label: string }[] {
  return ROUND_DURATIONS.filter((t) => t.days >= min - 1e-9 && t.days <= max + 1e-9);
}

/** The ticks that keep at least `gap` pixels from the last one kept, so labels do not run together. */
export function spaceTicks(ticks: readonly Tick[], gap: number): Tick[] {
  const out: Tick[] = [];
  for (const t of ticks) {
    const prev = out.at(-1);
    if (prev === undefined || Math.abs(t.at - prev.at) >= gap) out.push(t);
  }
  return out;
}

/** Label every n-th bucket, so labels `minLabel` pixels wide do not run together. */
export function tickStride(bucketStep: number, minLabel: number): number {
  return bucketStep <= 0 ? 1 : Math.max(1, Math.ceil(minLabel / bucketStep));
}

/** A labelled bucket of a time axis: its index, and its label. */
export interface BucketTick {
  i: number;
  label: string;
}

/**
 * The buckets a bucket chart's time axis labels, `starts` being each
 * bucket's first instant and `at` where bucket `i`'s label is centred, in
 * pixels. `measure` gives a label's width in pixels.
 */
export function bucketTicks(
  starts: readonly number[],
  step: Step,
  at: (i: number) => number,
  measure: (label: string) => number = labelWidth,
): BucketTick[] {
  if (step === 'month') return monthTicks(starts, at, measure);
  const stride = tickStride(starts.length > 1 ? at(1) - at(0) : 0, TICK_SPACING);
  return starts.flatMap((start, i) => (i % stride === 0 ? [{ i, label: bucketTick(start, step) }] : []));
}

/** The pixels between two neighbouring labels of a time axis, at least. */
export const LABEL_GAP = 10;

/** The pixels from one tick of a time axis to the next, at least, on a grid finer than a year. */
export const TICK_SPACING = 52;

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The calendar grids a month axis may take, finest first, in months: every
 * month written in full, every month, quarters, half-years, years, and
 * every 2, 5 and 10 years.
 */
const MONTH_GRIDS = [
  { every: 1, full: true },
  { every: 1, full: false },
  { every: 3, full: false },
  { every: 6, full: false },
  { every: 12, full: false },
  { every: 24, full: false },
  { every: 60, full: false },
  { every: 120, full: false },
];

/**
 * The months a time axis labels, `months` being the first instant of each
 * month it spans, ascending and one month apart, and `at` where month `i`'s
 * label is centred. The labels sit on a calendar grid: on every month,
 * quarter or half-year, or on January of every year or every few years,
 * the finest whose labels keep `gap` pixels between them and, on a grid
 * finer than a year, whose ticks sit `TICK_SPACING` apart as the weeks' do.
 * A label carries its year on the first tick and on January (as the year
 * alone), and its month's name otherwise; on a grid of a year or more it is
 * the year alone.
 * When the first month is off the grid and its year has no tick, it gets
 * one, written in full, if that keeps the gap too.
 */
export function monthTicks(
  months: readonly number[],
  at: (i: number) => number,
  measure: (label: string) => number = labelWidth,
  gap = LABEL_GAP,
): BucketTick[] {
  const date = months.map((t) => new Date(t * 1000));
  const month = (i: number) => (date[i] as Date).getUTCMonth();
  const year = (i: number) => (date[i] as Date).getUTCFullYear();
  const full = (i: number) => `${MONTH_ABBR[month(i)] as string} ${year(i)}`;
  const apart = (a: BucketTick, b: BucketTick) => at(b.i) - at(a.i) - (measure(a.label) + measure(b.label)) / 2 >= gap;
  const fits = (ticks: readonly BucketTick[]) => ticks.every((t, k) => k === 0 || apart(ticks[k - 1] as BucketTick, t));

  let ticks: BucketTick[] = [];
  for (const grid of MONTH_GRIDS) {
    const on = (i: number) =>
      grid.every < 12 ? month(i) % grid.every === 0 : month(i) === 0 && year(i) % (grid.every / 12) === 0;
    const placed = months.flatMap((_, i) => (on(i) ? [i] : []));
    const label = (i: number, k: number) => {
      if (grid.full || (k === 0 && month(i) !== 0)) return full(i);
      return month(i) === 0 ? String(year(i)) : (MONTH_ABBR[month(i)] as string);
    };
    ticks = placed.map((i, k) => ({ i, label: label(i, k) }));
    const spaced = (t: BucketTick, k: number) => k === 0 || at(t.i) - at((ticks[k - 1] as BucketTick).i) >= TICK_SPACING;
    if ((grid.every >= 12 || ticks.every(spaced)) && fits(ticks)) break;
  }
  const first = ticks[0];
  if (months.length > 0 && first?.i !== 0 && (first === undefined || year(first.i) !== year(0))) {
    const lead = { i: 0, label: full(0) };
    if (first === undefined || apart(lead, first)) ticks.unshift(lead);
  }
  return ticks;
}

/**
 * The width in pixels of the axis labels' characters, 12px and bold, as
 * Chromium draws the page's font on Linux (system-ui); a character not
 * listed counts as the widest. Used where no canvas can measure text.
 */
export const MEASURED_GLYPHS: Readonly<Record<string, number>> = {
  ' ': 3.12,
  '0': 6.88,
  '1': 6.88,
  '2': 6.88,
  '3': 6.88,
  '4': 6.88,
  '5': 6.88,
  '6': 6.88,
  '7': 6.88,
  '8': 6.88,
  '9': 6.88,
  A: 8.08,
  D: 8.8,
  F: 6.47,
  J: 3.72,
  M: 11.16,
  N: 9.53,
  O: 9.45,
  S: 6.61,
  a: 7.03,
  b: 7.52,
  c: 6.03,
  e: 7.03,
  g: 7.52,
  l: 3.41,
  n: 7.66,
  o: 7.41,
  p: 7.52,
  r: 5.22,
  s: 5.92,
  t: 4.88,
  u: 7.66,
  v: 6.58,
  y: 6.58,
};

/** A label's width from `MEASURED_GLYPHS`. */
export function glyphWidth(label: string): number {
  let w = 0;
  for (const c of label) w += MEASURED_GLYPHS[c] ?? 11.16;
  return w;
}

const widths = new Map<string, number>();
let context: OffscreenCanvasRenderingContext2D | null | undefined;
let digit = 0;

/**
 * A time axis label's width in pixels: measured in the page's font, as the
 * axis sets it (12px, bold for the selected bucket's, so bold here), every
 * digit as wide as the widest, since the axis sets them as tabular figures
 * and a canvas cannot. Without a canvas (in tests) it is `glyphWidth`.
 */
export function labelWidth(label: string): number {
  let w = widths.get(label);
  if (w !== undefined) return w;
  if (context === undefined) {
    context = typeof OffscreenCanvas === 'undefined' ? null : new OffscreenCanvas(1, 1).getContext('2d');
    if (context) {
      const family = typeof document === 'undefined' ? 'system-ui, sans-serif' : getComputedStyle(document.body).fontFamily;
      context.font = `600 12px ${family}`;
      const ctx = context;
      digit = Math.max(...'0123456789'.split('').map((d) => ctx.measureText(d).width));
    }
  }
  if (context === null) return glyphWidth(label);
  const digits = label.replace(/[^0-9]/g, '').length;
  w = context.measureText(label.replace(/[0-9]/g, '')).width + digits * digit;
  widths.set(label, w);
  return w;
}

/** A time-axis plot's left margin, which its value labels take. */
export const PLOT_LEFT = 44;
/** A time-axis plot's right margin. */
export const PLOT_RIGHT = 8;
/** Below this width a panel says its shorter unit. */
export const NARROW = 480;

/** Where the buckets of a time axis sit: columns that tile the plot from `left` to `right`, in order. */
export interface TimeColumns {
  left: number;
  right: number;
  /** One column's width. */
  step: number;
  /** Column `i`'s left edge. */
  start(i: number): number;
  /** Column `i`'s centre, where its bucket is drawn and labelled. */
  centre(i: number): number;
}

/**
 * The columns of `n` buckets across a plot `width` wide. Every chart over the
 * period takes its columns from here, so in charts of one width a bucket is
 * at the same x.
 */
export function timeColumns(width: number, n: number): TimeColumns {
  const left = PLOT_LEFT;
  const right = width - PLOT_RIGHT;
  const step = (right - left) / Math.max(1, n);
  return { left, right, step, start: (i) => left + i * step, centre: (i) => left + (i + 0.5) * step };
}
