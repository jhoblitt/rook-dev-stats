// The AI-use section's charts and its side-by-side comparison, from the
// statistics library's results. Every figure of the comparison is the
// library's, over the two sub-selections; nothing here computes one.

import { type BucketModel, type LineSeries, type Panel, type Shape } from './charts';
import { COLOURS, FAMILY_LINES, type FamilyLine } from './colours';
import type { Dataset, Named } from './data';
import { DISCLOSED, NOT_DISCLOSED, dayOf } from './filters';
import { bucketPhrase, formatCount, formatMean, formatShare } from './format';
import { curveQuantiles } from './review';
import { outcomeCurve } from './stats/curve';
import { type DisclosureCounts, type Distribution, distribution, mergedWithin } from './stats/measures';
import type { Weekly } from './stats/weekly';

const plural = (n: number, noun: string) => `${formatCount(n)} ${noun}${n === 1 ? '' : 's'}`;

/** A model value, a share in percent, written as the page writes shares. */
export function percent(v: number): string {
  return formatShare(v / 100);
}

/** The value axis reads in percent, so a share is drawn as one. */
function shareLine(
  key: string,
  label: string,
  mark: { color: string; shape: Shape; dashed?: boolean },
  values: readonly (number | null)[],
): LineSeries {
  const l: LineSeries = {
    key,
    label,
    color: mark.color,
    shape: mark.shape,
    values: values.map((v) => (v === null ? null : v * 100)),
    missing: values.map((v) => (v === null ? 'no PRs opened' : null)),
  };
  if (mark.dashed) l.dashed = true;
  return l;
}

/** The share of the PRs opened in each bucket that disclose, as one line in the disclosed colour. */
export function shareModel(shares: Weekly<number | null>): BucketModel {
  return {
    step: shares.step,
    buckets: shares.week,
    bars: [],
    lines: [shareLine('disclosed', DISCLOSED, { color: COLOURS.disclosed, shape: 'circle' }, shares.values['disclosed'] ?? [])],
  };
}

/** The family id for a disclosure that names no tool: a different thing from a tool, so drawn last. */
const UNSPECIFIED = 'unspecified';

export interface FamilyChart {
  /** A line for each family named in the selection, then "unspecified". */
  model: BucketModel;
  /** The one panel every line is drawn in. */
  panels: Panel[];
}

/** A family the tools table gained after `FAMILY_LINES` was drawn up: neutral, and dashed. */
const OTHER_FAMILY: FamilyLine = { color: COLOURS.statistic, shape: 'circle', dashed: true };

/**
 * The share of the PRs opened in each bucket that name each tool family, a
 * line for each family named in the selection, all in one panel on one scale:
 * most named first, ties by name, and "unspecified" last. Each family is drawn
 * as `FAMILY_LINES` gives it.
 */
export function familiesModel(shares: Weekly<number | null>, families: readonly Named[], counts: DisclosureCounts): FamilyChart {
  const used = families
    .map((_, i) => i)
    .filter((i) => (counts.families[i] ?? 0) > 0)
    .sort(
      (a, b) =>
        Number(families[a]?.id === UNSPECIFIED) - Number(families[b]?.id === UNSPECIFIED) ||
        (counts.families[b] ?? 0) - (counts.families[a] ?? 0) ||
        (families[a]?.name ?? '').localeCompare(families[b]?.name ?? '', 'en'),
    );
  const lines = used.map((i) => {
    const f = families[i] as Named;
    return shareLine(f.id, f.name, FAMILY_LINES[f.id] ?? OTHER_FAMILY, shares.values[f.id] ?? []);
  });
  return {
    model: { step: shares.step, buckets: shares.week, bars: [], lines },
    panels: [{ keys: lines.map((l) => l.key), unit: '% of PRs opened' }],
  };
}

/**
 * The text alternative of a chart of shares by bucket: each line's range and
 * the bucket where it peaked, then the buckets with no PRs opened.
 */
export function describeShares(model: BucketModel): string {
  if (model.buckets.length === 0) return '';
  const first = model.buckets[0] as number;
  const last = model.buckets.at(-1) as number;
  const out = [`By ${model.step}, ${plural(model.buckets.length, model.step)} from ${dayOf(first)} to ${dayOf(last)}.`];
  for (const l of model.lines) {
    const known = l.values.flatMap((v, i) => (v === null ? [] : [{ v, i }]));
    if (known.length === 0) continue;
    let peak = known[0] as { v: number; i: number };
    for (const k of known) if (k.v > peak.v) peak = k;
    const low = Math.min(...known.map((k) => k.v));
    const label = l.label.charAt(0).toUpperCase() + l.label.slice(1);
    const where = bucketPhrase(model.buckets[peak.i] as number, model.step);
    out.push(`${label}: from ${percent(low)} to ${percent(peak.v)}, highest in ${where}.`);
  }
  const none = model.lines[0]?.values.filter((v) => v === null).length ?? 0;
  if (none > 0) out.push(`No PRs opened in ${plural(none, model.step)}.`);
  const partial = model.partial?.filter((c) => c !== null).length ?? 0;
  if (partial > 0) out.push(`${plural(partial, model.step)} cut short by the period or the data.`);
  return out.join(' ');
}

/** The rows that do not disclose and those that do, each in the order given. */
export function byDisclosure(data: Dataset, rows: Uint32Array): { notDisclosed: Uint32Array; disclosed: Uint32Array } {
  const none = data.meta.disclosure.indexOf('none');
  const p = data.prs;
  return {
    notDisclosed: rows.filter((r) => p.disclosure[r] === none),
    disclosed: rows.filter((r) => p.disclosure[r] !== none),
  };
}

/** One group's figure, written, and what it rests on: "of 843 PRs", "from the 610 opened at least 30 days ago". */
export interface Cell {
  text: string;
  /** Null where there is nothing to rest on. */
  basis: string | null;
}

/** The days by which the comparison reads the share merged. */
export const HORIZONS = [7, 30, 90] as const;
/** Fewer PRs of a group followed to a horizon than this, and the share there is not given. */
export const MIN_FOLLOWED = 30;

type HorizonKey = `merged${(typeof HORIZONS)[number]}`;

/** One figure for both groups: not disclosed first, disclosed second. */
export interface ComparisonRow {
  key: 'lines' | 'files' | 'firstCommit' | HorizonKey | 'botReviews';
  label: string;
  cells: readonly [Cell, Cell];
}

const NO_PRS: Cell = { text: 'no PRs', basis: null };
const NOTHING: Cell = { text: 'no PR to measure', basis: null };

function spread(d: Distribution): string {
  return `median ${formatCount(d.median)} · 90th percentile ${formatCount(d.p90)}`;
}

const of = (n: number) => `of ${plural(n, 'PR')}`;

/**
 * Of the PRs opened at least `h` days before the data was fetched, the share
 * merged within `h` days of opening: every one of them has a known outcome
 * at `h`, so the share and the count beside it are about the same PRs. With
 * fewer than `MIN_FOLLOWED` of them the cell says so instead.
 */
function mergedBy(data: Dataset, rows: Uint32Array, h: number): Cell {
  const { followed, share } = mergedWithin(data, rows, h);
  const since = `opened at least ${h} days ago`;
  if (share === null || followed < MIN_FOLLOWED) {
    return { text: 'too few to say', basis: followed === 0 ? `none ${since}` : `only ${formatCount(followed)} ${since}` };
  }
  return { text: formatShare(share), basis: `from the ${formatCount(followed)} ${since}` };
}

function groupCells(data: Dataset, rows: Uint32Array): Record<ComparisonRow['key'], Cell> {
  const keys = Object.keys(LABELS) as ComparisonRow['key'][];
  if (rows.length === 0) return Object.fromEntries(keys.map((k) => [k, NO_PRS])) as Record<ComparisonRow['key'], Cell>;
  const lines = distribution(data, rows, 'lines') as Distribution;
  const files = distribution(data, rows, 'files') as Distribution;
  const bots = distribution(data, rows, 'botReviews') as Distribution;
  const first = outcomeCurve(data, rows, 'firstCommitToOpened');
  const fq = curveQuantiles(first, 'firstCommitToOpened');
  const horizon = (h: number) => mergedBy(data, rows, h);
  return {
    lines: { text: spread(lines), basis: of(lines.count) },
    files: { text: spread(files), basis: of(files.count) },
    firstCommit:
      first.days.length === 0 ? NOTHING : { text: `median ${fq.median} · 90th percentile ${fq.p90}`, basis: of(first.counts.done) },
    merged7: horizon(7),
    merged30: horizon(30),
    merged90: horizon(90),
    botReviews: { text: `${formatShare(bots.nonzero)} had one · mean ${formatMean(bots.mean)} a PR`, basis: of(bots.count) },
  };
}

const LABELS: Record<ComparisonRow['key'], string> = {
  lines: 'Lines changed',
  files: 'Files changed',
  firstCommit: 'First commit to opened',
  merged7: 'Merged within 7 days of opening',
  merged30: 'Merged within 30 days of opening',
  merged90: 'Merged within 90 days of opening',
  botReviews: 'With a bot review',
};

/**
 * The PRs that do not disclose against those that do, figure by figure: size,
 * first commit to opened, the share merged by fixed days, and bot reviews.
 * `rows` are the PRs opened in the period. No median time to merge: the
 * groups differ in age, and a median late on the curve rests on a few of the
 * oldest PRs of a group. The shares merged by a fixed day are plain counts
 * among the PRs old enough, not curve values, so each says whose it is.
 */
export function comparison(data: Dataset, rows: Uint32Array): ComparisonRow[] {
  const { notDisclosed, disclosed } = byDisclosure(data, rows);
  const a = groupCells(data, notDisclosed);
  const b = groupCells(data, disclosed);
  return (Object.keys(LABELS) as ComparisonRow['key'][]).map((key) => ({ key, label: LABELS[key], cells: [a[key], b[key]] }));
}

/** The comparison as sentences, for its text alternative. */
export function comparisonSummary(rows: readonly ComparisonRow[]): string {
  const cell = (c: Cell) => (c.basis === null ? c.text : `${c.text} (${c.basis})`);
  return rows.map((r) => `${r.label}: ${NOT_DISCLOSED} ${cell(r.cells[0])}; ${DISCLOSED} ${cell(r.cells[1])}.`).join(' ');
}
