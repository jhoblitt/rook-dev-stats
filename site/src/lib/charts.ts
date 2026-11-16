// What the shared chart parts draw, and the legend, table and text summary
// each derives from it. A section turns a statistics result into one of these
// models; the parts never compute a statistic. Colours come from colours.ts.

import { COLOURS } from './colours';
import { DAY, dayOf } from './filters';
import { bucketName, formatCount, formatDays, formatShare } from './format';
import { type Period, type Step, bucketEnd } from './stats/buckets';

/** A line's marker, so lines are told apart by shape as well as colour. */
export type Shape = 'circle' | 'square' | 'triangle' | 'diamond';

export const NOT_YET_KNOWN = 'not yet known';

export interface BarSeries {
  key: string;
  label: string;
  /** A CSS colour from colours.ts. */
  color: string;
  values: readonly number[];
}

export interface LineSeries {
  key: string;
  label: string;
  color: string;
  shape: Shape;
  /** Drawn dashed: a second neutral statistic beside a solid one. */
  dashed?: boolean;
  /** Null where there is no value, which is drawn as a gap, never as zero. */
  values: readonly (number | null)[];
  /** Why each missing value is missing, e.g. "not reached: 78% merged"; else the bucket's note. */
  missing?: readonly (string | null)[];
  /** The buckets where the value can no longer be reached, marked above the plot. */
  unreached?: readonly boolean[];
  /** Carried for the readout and the table only: never drawn, so it has no key and no legend entry. */
  undrawn?: boolean;
}

/** How much of a bucket the data covers, in whole days of the bucket's days. */
export interface Coverage {
  days: number;
  of: number;
}

/** Bars stacked per bucket, with lines over them, on one value axis. */
export interface BucketModel {
  step: Step;
  /** Each bucket's first instant, epoch seconds. */
  buckets: readonly number[];
  /** Stacked from the baseline up, in this order. */
  bars: readonly BarSeries[];
  /** What a whole stack counts; with two bars or more it is shown as a total. */
  stackLabel?: string;
  lines: readonly LineSeries[];
  /** Why every value of a bucket is missing, e.g. "no PRs opened". */
  notes?: readonly (string | null)[];
  /** The buckets washed behind the marks, named in the legend by `shadeLabel`. */
  shade?: readonly boolean[];
  shadeLabel?: string;
  /** The buckets the period or the fetch cuts short; null for a whole one. */
  partial?: readonly (Coverage | null)[];
  /** What else a partial bucket's name says, e.g. that its ratios divide partial counts. */
  partialNote?: string;
}

/** One panel of a bucket chart: the series it draws, by key, and what its value axis measures. */
export interface Panel {
  keys: readonly string[];
  unit?: string | undefined;
  /** Said in place of `unit` where the chart is too narrow for it. */
  narrowUnit?: string;
  /** The least number of labelled value ticks, so a compact panel's values can be read off its axis. */
  minTicks?: number;
}

export interface AreaLayer {
  key: string;
  label: string;
  /** A CSS colour: the layers are ordered, so they take steps of one ramp. */
  fill: string;
  values: readonly number[];
}

/** Layers stacked per bucket, each bucket a flat step: a stock measured once per bucket. */
export interface AreaModel {
  step: Step;
  buckets: readonly number[];
  /** Stacked from the baseline up, in this order. */
  layers: readonly AreaLayer[];
  /** What a whole stack counts. */
  totalLabel: string;
}

export interface CurveSeries {
  key: string;
  label: string;
  color: string;
  shape: Shape;
  /** The share from each of the model's days on. */
  values: readonly number[];
  /** What remains, 1 before the first day; every other outcome starts at 0. */
  remains: boolean;
}

/** Step curves of shares over days since a span began. */
export interface CurveModel {
  days: readonly number[];
  series: readonly CurveSeries[];
}

export interface LegendItem {
  label: string;
  mark: 'bar' | 'line' | 'area' | 'note' | 'unreached' | 'partial';
  color: string;
  shape?: Shape;
  dashed?: boolean;
}

export interface Table {
  columns: readonly string[];
  rows: readonly { head: string; cells: readonly string[] }[];
}

/** One line of a tooltip, or of a focused mark's accessible name. */
export interface Readout {
  label: string;
  value: string;
  /** The series colour its key is drawn in; null for a total, which has no mark. */
  color: string | null;
  mark: LegendItem['mark'] | 'total';
  shape?: Shape;
  dashed?: boolean;
  /** The part under the pointer or the focus. */
  strong?: boolean;
}

/** Readouts as one phrase, for an accessible name: "disclosed 1, not disclosed 2". */
export function readoutText(rows: readonly Readout[]): string {
  return rows.map((r) => `${r.label} ${r.value}`).join(', ');
}

const plural = (n: number, noun: string) => `${formatCount(n)} ${noun}${n === 1 ? '' : 's'}`;
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * How much of each bucket lies inside the period and before `fetchedThrough`;
 * null for a bucket covered whole. Days are whole days, rounded down.
 */
export function coverage(buckets: readonly number[], step: Step, period: Period, fetchedThrough: number): (Coverage | null)[] {
  return buckets.map((start) => {
    const end = bucketEnd(start, step);
    const from = Math.max(start, period.start);
    const to = Math.min(end, period.end, fetchedThrough);
    if (from === start && to === end) return null;
    return { days: Math.max(0, Math.floor((to - from) / DAY)), of: Math.round((end - start) / DAY) };
  });
}

/** A count model with its partial buckets marked. */
export function withCoverage(model: BucketModel, period: Period, fetchedThrough: number): BucketModel {
  return { ...model, partial: coverage(model.buckets, model.step, period, fetchedThrough) };
}

export function partialText(c: Coverage): string {
  return `partial: ${coveredText(c)}`;
}

/** How much of a bucket the data covers: "15 of 30 days". */
function coveredText(c: Coverage): string {
  return `${c.days === 0 ? 'under 1' : formatCount(c.days)} of ${formatCount(c.of)} days`;
}

/** A bucket's name, with how much of it the data covers when that is not all of it. */
export function bucketHead(model: BucketModel, i: number): string {
  const c = model.partial?.[i];
  const name = bucketName(model.buckets[i] as number, model.step);
  if (!c) return name;
  return `${name}, ${partialText(c)}${model.partialNote ? `; ${model.partialNote}` : ''}`;
}

/** The first index of the largest value; ties go to the earliest bucket. */
function peak(values: readonly number[]): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) if ((values[i] as number) > (values[best] as number)) best = i;
  return best;
}

function sum(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function span(step: Step, buckets: readonly number[], by = `By ${step}`): string {
  const first = buckets[0] as number;
  const last = buckets.at(-1) as number;
  return `${by}, ${plural(buckets.length, step)} from ${dayOf(first)} to ${dayOf(last)}.`;
}

export function stackTotals(model: BucketModel): number[] {
  return model.buckets.map((_, i) => model.bars.reduce((n, b) => n + (b.values[i] as number), 0));
}

function showsTotal(model: BucketModel): boolean {
  return model.bars.length >= 2 && model.stackLabel !== undefined;
}

/** Why line `l`'s value in bucket `i` is missing. */
function missingText(model: BucketModel, l: LineSeries, i: number): string {
  return l.missing?.[i] ?? model.notes?.[i] ?? NOT_YET_KNOWN;
}

export function bucketLegend(model: BucketModel): LegendItem[] {
  const items: LegendItem[] = [
    ...model.bars.map((b): LegendItem => ({ label: b.label, mark: 'bar', color: b.color })),
    ...model.lines.filter((l) => !l.undrawn).map((l): LegendItem => {
      const item: LegendItem = { label: l.label, mark: 'line', color: l.color, shape: l.shape };
      if (l.dashed) item.dashed = true;
      return item;
    }),
  ];
  if (model.shadeLabel !== undefined && model.shade?.some(Boolean)) {
    items.push({ label: model.shadeLabel, mark: 'note', color: COLOURS.notYetKnown });
  }
  if (model.lines.some((l) => l.unreached?.some(Boolean))) {
    items.push({ label: 'not reached', mark: 'unreached', color: COLOURS.statistic });
  }
  if (model.partial?.some((c) => c !== null)) {
    // With no bars, a partial bucket shows only as a lone hollow marker: its key is drawn so, after the first line's.
    const line = model.lines.find((l) => !l.undrawn);
    items.push(
      model.bars.length === 0 && line
        ? { label: `partial ${model.step}`, mark: 'partial', color: line.color, shape: line.shape }
        : { label: `partial ${model.step}`, mark: 'partial', color: COLOURS.partial },
    );
  }
  return items;
}

export function bucketTable(model: BucketModel, format: (v: number) => string): Table {
  const totals = stackTotals(model);
  const total = showsTotal(model);
  return {
    columns: [
      capital(model.step),
      ...model.bars.map((b) => b.label),
      ...(total ? [model.stackLabel as string] : []),
      ...model.lines.map((l) => l.label),
    ],
    rows: model.buckets.map((_, i) => ({
      head: bucketHead(model, i),
      cells: [
        ...model.bars.map((b) => format(b.values[i] as number)),
        ...(total ? [format(totals[i] as number)] : []),
        ...model.lines.map((l) => {
          const v = l.values[i];
          return v === null || v === undefined ? missingText(model, l, i) : format(v);
        }),
      ],
    })),
  };
}

/** Bucket `i` read out as the stack shows it, top segment first, then its total and the lines. */
export function bucketReadout(model: BucketModel, i: number, format: (v: number) => string): Readout[] {
  const rows: Readout[] = [...model.bars].reverse().map((b) => ({
    label: b.label,
    value: format(b.values[i] as number),
    color: b.color,
    mark: 'bar',
  }));
  if (showsTotal(model)) {
    rows.push({ label: model.stackLabel as string, value: format(stackTotals(model)[i] as number), color: null, mark: 'total' });
  }
  for (const l of model.lines) {
    const v = l.values[i];
    const row: Readout = {
      label: l.label,
      value: v === null || v === undefined ? missingText(model, l, i) : format(v),
      color: l.undrawn ? null : l.color,
      mark: 'line',
      shape: l.shape,
    };
    if (l.dashed) row.dashed = true;
    rows.push(row);
  }
  return rows;
}

/** One count series' total and its busiest bucket, as a sentence. */
function countSentence(model: BucketModel, label: string, values: readonly number[], parts = ''): string {
  const total = sum(values);
  if (total === 0) return `0 ${label}${parts}.`;
  const i = peak(values);
  const most = `at most ${formatCount(values[i] as number)} in a ${model.step}`;
  return `${formatCount(total)} ${label}${parts}, ${most} (${bucketName(model.buckets[i] as number, model.step)}).`;
}

/** The partial buckets, as a sentence; empty when every bucket is whole. */
function partialSentence(model: BucketModel): string {
  const parts = model.buckets.flatMap((start, i) => {
    const c = model.partial?.[i];
    return c ? [`${bucketName(start, model.step)}, ${coveredText(c)}`] : [];
  });
  return parts.length === 0 ? '' : `Partial: ${parts.join('; ')}.`;
}

/** The text alternative of a chart of counts: each series' total and busiest bucket, and the partial buckets. */
export function describeCounts(model: BucketModel): string {
  if (model.buckets.length === 0) return '';
  const out = [span(model.step, model.buckets)];
  if (showsTotal(model)) {
    const parts = model.bars.map((b) => `${formatCount(sum(b.values))} ${b.label}`).join(', ');
    out.push(countSentence(model, model.stackLabel as string, stackTotals(model), ` (${parts})`));
  } else {
    for (const b of model.bars) out.push(countSentence(model, b.label, b.values));
  }
  for (const l of model.lines) out.push(countSentence(model, l.label, l.values.map((v) => v ?? 0)));
  const partial = partialSentence(model);
  if (partial) out.push(partial);
  return out.join(' ');
}

/**
 * The text alternative of a chart of durations by bucket opened: each line's
 * known range and how often it is not yet known or not reached, then the
 * buckets with nothing to measure, counted apart.
 */
export function describeWaits(model: BucketModel): string {
  if (model.buckets.length === 0) return '';
  const out = [span(model.step, model.buckets, `By ${model.step} opened`)];
  for (const l of model.lines) {
    const known = l.values.filter((v): v is number => v !== null);
    const unknown = l.values.filter((v, i) => v === null && missingText(model, l, i) === NOT_YET_KNOWN).length;
    const unreached = l.unreached?.filter(Boolean).length ?? 0;
    const [lo, hi] = [formatDays(Math.min(...known)), formatDays(Math.max(...known))];
    const clauses = [
      known.length === 0
        ? 'no value known'
        : lo === hi
          ? `${lo} in ${plural(known.length, model.step)}`
          : `from ${lo} to ${hi}`,
      ...(unknown > 0 ? [`not yet known in ${plural(unknown, model.step)}`] : []),
      ...(unreached > 0 ? [`not reached in ${plural(unreached, model.step)}`] : []),
    ];
    out.push(`${l.label}: ${clauses.join(', ')}.`);
  }
  const notes = new Map<string, number>();
  for (const n of model.notes ?? []) if (n !== null) notes.set(n, (notes.get(n) ?? 0) + 1);
  for (const [note, count] of notes) out.push(`${capital(note)} in ${plural(count, model.step)}.`);
  const partial = partialSentence(model);
  if (partial) out.push(partial);
  return out.join(' ');
}

function areaTotals(model: AreaModel): number[] {
  return model.buckets.map((_, i) => model.layers.reduce((n, l) => n + (l.values[i] as number), 0));
}

export function areaLegend(model: AreaModel): LegendItem[] {
  return model.layers.map((l) => ({ label: l.label, mark: 'area', color: l.fill }));
}

export function areaTable(model: AreaModel): Table {
  const totals = areaTotals(model);
  return {
    columns: [capital(model.step), ...model.layers.map((l) => l.label), model.totalLabel],
    rows: model.buckets.map((start, i) => ({
      head: bucketName(start, model.step),
      cells: [...model.layers.map((l) => formatCount(l.values[i] as number)), formatCount(totals[i] as number)],
    })),
  };
}

/** Bucket `i` read out top layer first, `focus` the layer under the pointer or the focus, then the total. */
export function areaReadout(model: AreaModel, i: number, focus: number | null): Readout[] {
  const rows: Readout[] = [];
  for (let k = model.layers.length - 1; k >= 0; k--) {
    const l = model.layers[k] as AreaLayer;
    const row: Readout = { label: l.label, value: formatCount(l.values[i] as number), color: l.fill, mark: 'area' };
    if (k === focus) row.strong = true;
    rows.push(row);
  }
  rows.push({ label: model.totalLabel, value: formatCount(areaTotals(model)[i] as number), color: null, mark: 'total' });
  return rows;
}

/** The text alternative of a stacked area: the last bucket by layer, and the largest total. */
export function describeArea(model: AreaModel): string {
  if (model.buckets.length === 0) return '';
  const totals = areaTotals(model);
  const last = model.buckets.length - 1;
  const lastName = bucketName(model.buckets[last] as number, model.step);
  const layers = model.layers.map((l) => `${formatCount(l.values[last] as number)} ${l.label}`).join(', ');
  const i = peak(totals);
  return [
    span(model.step, model.buckets),
    `In the last, ${lastName}, ${formatCount(totals[last] as number)} ${model.totalLabel}: ${layers}.`,
    `At most ${formatCount(totals[i] as number)} ${model.totalLabel}, ${bucketName(model.buckets[i] as number, model.step)}.`,
  ].join(' ');
}

/** Each series' share at `day`: the curve is a step, holding its value until the next day. */
export function curveAt(model: CurveModel, day: number): number[] {
  let i = -1;
  while (i + 1 < model.days.length && (model.days[i + 1] as number) <= day) i++;
  return model.series.map((s) => (i === -1 ? (s.remains ? 1 : 0) : (s.values[i] as number)));
}

const MILESTONES = [1 / 24, 1, 2, 7, 14, 30, 60, 90, 180, 365, 730];

/** The days a curve's table reads it at: the usual marks up to its longest duration, and that. */
export function curveMilestones(model: CurveModel): number[] {
  const last = model.days.at(-1);
  if (last === undefined) return [];
  const out = MILESTONES.filter((m) => m <= last);
  if (out.at(-1) !== last) out.push(last);
  return out;
}

export function curveTable(model: CurveModel): Table {
  const rows = curveMilestones(model).map((day) => ({
    head: formatDays(day),
    cells: curveAt(model, day).map(formatShare),
  }));
  // The longest duration can read the same as the milestone before it; its row, the later, is kept.
  return {
    columns: ['After', ...model.series.map((s) => s.label)],
    rows: rows.filter((r, i) => r.head !== rows[i + 1]?.head),
  };
}

export function curveReadout(model: CurveModel, day: number): Readout[] {
  return curveAt(model, day).map((v, k) => {
    const s = model.series[k] as CurveSeries;
    return { label: s.label, value: formatShare(v), color: s.color, mark: 'line', shape: s.shape };
  });
}

export function curveLegend(model: CurveModel): LegendItem[] {
  return model.series.map((s) => ({ label: s.label, mark: 'line', color: s.color, shape: s.shape }));
}

/**
 * A curve's quantiles of its first outcome, already written: a duration,
 * "not yet known", or "not reached" with the outcome's share.
 */
export interface Quantiles {
  median: string;
  p90: string;
}

/** The text alternative of a curve: its quantiles, and every share at its longest duration. */
export function describeCurve(model: CurveModel, q: Quantiles): string {
  const last = model.days.at(-1);
  if (last === undefined) return '';
  const shares = curveAt(model, last)
    .map((v, k) => `${formatShare(v)} ${(model.series[k] as CurveSeries).label}`)
    .join(', ');
  // The log time axis starts at an hour, so what happened within it is the curve's starting height.
  const first = model.series[0] as CurveSeries;
  const early = curveAt(model, 1 / 24)[0] as number;
  const within = early > 0 ? ` Within 1 hour, ${formatShare(early)} ${first.label}.` : '';
  return `Median ${q.median}; 90th percentile ${q.p90}.${within} After ${formatDays(last)}, the longest measured: ${shares}.`;
}
