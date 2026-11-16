// The PR table: which rows it lists, its columns and how each is written,
// and how it orders them by a `Sort` (sort.ts). The ordering is a pure
// function so another view can list the same PRs in the same order.

import { type Dataset, type KindSource, type Named, PR_STATE, type TableYear, locateRow } from './data';
import { AGE_BANDS, DAY, dayOf, dayStart, periodRange } from './filters';
import { bucketPhrase, formatCount, formatDays } from './format';
import { type Handle, personHandle } from './handles';
import { openedInBucket, select } from './select';
import type { Sort, SortColumn } from './sort';
import type { AppState } from './state';
import { backlogMoment, backlogRows } from './stats/backlog';
import { buckets } from './stats/buckets';

/** The table's columns, in the order shown: what a PR is about and whether it discloses first. */
export const TABLE_COLUMNS: readonly { id: SortColumn; label: string }[] = [
  { id: 'number', label: 'PR' },
  { id: 'title', label: 'Title' },
  { id: 'disclosure', label: 'AI use' },
  { id: 'author', label: 'Author' },
  { id: 'opened', label: 'Opened' },
  { id: 'state', label: 'State' },
  { id: 'kind', label: 'Kind' },
  { id: 'response', label: 'First response' },
  { id: 'open', label: 'Time open' },
  { id: 'size', label: 'Size' },
  { id: 'reopened', label: 'Reopened' },
];

/** A row's title from its year's table file; null until that file has loaded. */
export interface RowText {
  title(row: number): string | null;
}

const NO_TEXT: RowText = { title: () => null };

/** The handle of the PR's author, from the data itself. */
export function authorHandle(data: Dataset, r: number): Handle {
  return personHandle(data.meta, data.prs.author[r] as number);
}

const STATE_LABELS = ['open', 'merged', 'closed unmerged'];

/** Days from the PR becoming ready to its first human response, or why there is none. */
function responseWait(data: Dataset, r: number): number | 'never ready' | 'none yet' | 'none' {
  const p = data.prs;
  const ready = p.ready[r] as number;
  if (ready < 0) return 'never ready';
  const open = p.state[r] === PR_STATE.open;
  const t = p.first_response[r] as number;
  // A response after the PR finished, as GitHub allows, came too late to be one.
  if (t >= 0 && (open || t <= (p.closed[r] as number))) return Math.max(0, t - ready) / DAY;
  return open ? 'none yet' : 'none';
}

/** Days from opening to the final disposition, or to now while open; null when it is unknown. */
function timeOpen(data: Dataset, r: number): number | null {
  const p = data.prs;
  const created = p.created[r] as number;
  if (p.state[r] === PR_STATE.open) return Math.max(0, data.meta.fetched_through - created) / DAY;
  const closed = p.closed[r] as number;
  return closed < 0 ? null : Math.max(0, closed - created) / DAY;
}

function disclosureText(data: Dataset, r: number): string {
  const p = data.prs;
  if (p.disclosure[r] === data.meta.disclosure.indexOf('none')) return 'not disclosed';
  const names = (p.families[r] as readonly number[]).map((f) => data.meta.families[f]?.name).filter(Boolean);
  return names.length === 0 ? 'disclosed' : `disclosed: ${names.join(', ')}`;
}

function kindName(data: Dataset, r: number): string | null {
  return data.meta.kinds[data.prs.kind[r] as number]?.name ?? null;
}

/** A column's value for ordering: a number, a string, or null for none. */
function sortKey(data: Dataset, column: SortColumn, text: RowText): (r: number) => number | string | null {
  const p = data.prs;
  switch (column) {
    case 'number':
      return (r) => p.number[r] as number;
    case 'title':
      return (r) => text.title(r);
    case 'author':
      return (r) => authorHandle(data, r).text;
    case 'opened':
      return (r) => p.created[r] as number;
    case 'state':
      return (r) => STATE_LABELS[p.state[r] as number] ?? null;
    case 'kind':
      return (r) => kindName(data, r);
    case 'response':
      return (r) => {
        const w = responseWait(data, r);
        return typeof w === 'number' ? w : null;
      };
    case 'open':
      return (r) => timeOpen(data, r);
    case 'size':
      return (r) => (p.additions[r] as number) + (p.deletions[r] as number);
    case 'disclosure':
      return (r) => disclosureText(data, r);
    case 'reopened':
      return (r) => p.reopened[r] as number;
  }
}

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

/**
 * The items in the order of `key`, a new array; items that tie keep the
 * order they came in, and an item with no value goes last whichever way.
 * Strings compare as a reader would, without regard to case.
 */
export function orderBy<T>(items: ArrayLike<T>, key: (item: T) => number | string | null, descending: boolean): T[] {
  const keys = Array.from(items, (item) => key(item));
  const order = Array.from(keys, (_, i) => i);
  const sign = descending ? -1 : 1;
  order.sort((i, j) => {
    const a = keys[i] ?? null;
    const b = keys[j] ?? null;
    if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
    const c = typeof a === 'string' || typeof b === 'string' ? collator.compare(String(a), String(b)) : a - b;
    return sign * c;
  });
  return order.map((i) => items[i] as T);
}

/**
 * The rows in the order `sort` gives, a new array, as `orderBy` orders them.
 * Titles sort once `text` has them.
 */
export function sortRows(data: Dataset, rows: Uint32Array, sort: Sort, text: RowText = NO_TEXT): Uint32Array {
  return Uint32Array.from(orderBy(rows, sortKey(data, sort.column, text), sort.descending));
}

/** What decides the table's rows: the filters and any week or band chosen. */
export type TableScope = Pick<AppState, 'filters' | 'week' | 'band'>;

/** The bucket a band without a week stands for: the period's last, the backlog now. */
function bandBucket(state: TableScope): number {
  const period = periodRange(state.filters);
  if (state.week !== null) return dayStart(state.week) as number;
  return buckets(period).starts.at(-1) as number;
}

/**
 * The PRs the table lists: the selection, narrowed by a chosen week to the
 * PRs opened in it, or by a chosen age band to the PRs behind that band of
 * the backlog chart.
 */
export function tableRows(data: Dataset, state: TableScope): Uint32Array {
  return narrowRows(data, select(data, state.filters), state);
}

/** `tableRows` for a selection already made from the same filters. */
export function narrowRows(data: Dataset, rows: Uint32Array, state: TableScope): Uint32Array {
  const period = periodRange(state.filters);
  if (state.band !== null) return backlogRows(data, rows, state.band, backlogMoment(data, period, bandBucket(state)));
  if (state.week !== null) return openedInBucket(data, rows, period, dayStart(state.week) as number);
  return rows;
}

/**
 * The PR table's rows in the order it shows them: a selection narrowed as
 * `narrowRows` narrows it, sorted by `sort`. Titles are read only when the
 * sort is by title, so titles arriving reorder nothing else.
 */
export function tableOrder(data: Dataset, rows: Uint32Array, scope: TableScope, sort: Sort, text: RowText = NO_TEXT): Uint32Array {
  return sortRows(data, narrowRows(data, rows, scope), sort, sort.column === 'title' ? text : NO_TEXT);
}

/** The PR table's order in words, its column's label as written: "by Opened, descending". */
export function sortWords(sort: Sort): string {
  const label = TABLE_COLUMNS.find((c) => c.id === sort.column)?.label ?? sort.column;
  return `by ${label}, ${sort.descending ? 'descending' : 'ascending'}`;
}

/** The PR table's rows, in words, when no week or band narrows them. */
export const ALL_TABLE_ROWS = 'open at some point in the period';

/** What a chosen week or band narrows the table to, in words; null when nothing does. */
export function narrowing(data: Dataset, state: TableScope): string | null {
  if (state.week === null && state.band === null) return null;
  const step = buckets(periodRange(state.filters)).step;
  const bucket = bucketPhrase(bandBucket(state), step);
  if (state.band === null) return `opened in ${bucket}`;
  const band = AGE_BANDS.find((b) => b.id === state.band)?.label as string;
  return `open at the end of ${bucket}, aged ${band}`;
}

/**
 * What the table lists, counted: `rows` PRs, of which `opened` were opened in
 * the period (the PRs the charts by week opened count), or what a week or
 * band narrows them to.
 */
export function countText(rows: number, opened: number, narrowed: string | null): string {
  const prs = `${rows === 0 ? 'no' : formatCount(rows)} PR${rows === 1 ? '' : 's'}`;
  if (narrowed !== null) return `${prs} ${narrowed}`;
  return `${prs} ${ALL_TABLE_ROWS}, ${formatCount(opened)} of them opened in it`;
}

/** A row's cell as the table writes it; the number is drawn as a link by the table. */
export function cellText(data: Dataset, r: number, column: SortColumn, text: RowText): string {
  const p = data.prs;
  switch (column) {
    case 'number':
      return `#${p.number[r]}`;
    case 'title':
      return text.title(r) ?? '';
    case 'author':
      return authorHandle(data, r).text;
    case 'opened':
      return dayOf(p.created[r] as number);
    case 'state': {
      const label = STATE_LABELS[p.state[r] as number] as string;
      return p.draft[r] === 1 ? `${label}, draft` : label;
    }
    case 'kind':
      return kindName(data, r) ?? 'unknown';
    case 'response': {
      const w = responseWait(data, r);
      return typeof w === 'number' ? formatDays(w) : w;
    }
    case 'open': {
      const days = timeOpen(data, r);
      if (days === null) return 'unknown';
      return p.state[r] === PR_STATE.open ? `${formatDays(days)} so far` : formatDays(days);
    }
    case 'size': {
      const lines = (p.additions[r] as number) + (p.deletions[r] as number);
      const files = p.files[r] as number;
      return `${formatCount(lines)} line${lines === 1 ? '' : 's'}, ${formatCount(files)} file${files === 1 ? '' : 's'}`;
    }
    case 'disclosure':
      return disclosureText(data, r);
    case 'reopened': {
      const n = p.reopened[r] as number;
      return n === 0 ? 'no' : n === 1 ? 'once' : `${formatCount(n)} times`;
    }
  }
}

const SOURCE_TEXT: Record<Exclude<KindSource, ''>, string> = {
  checklist: 'from the PR’s checklist',
  tracker: 'from its tracker ticket',
  labels: 'from its labels',
  original: 'from the PR it backports',
};

/** A PR's kind and what decided it, as a reader would say it. */
export function kindDecided(kinds: readonly Named[], kind: number, source: KindSource): string {
  const name = kinds[kind]?.name;
  if (name === undefined) return 'unknown: nothing decided it';
  return source === '' ? name : `${name}, ${SOURCE_TEXT[source]}`;
}

/** Where a year's table file stands. */
export type TableLoad = { status: 'loading' } | { status: 'loaded'; table: TableYear } | { status: 'error'; message: string };

/** Titles from the year tables loaded so far; a row of a year not loaded has none. */
export function rowText(data: Dataset, tables: ReadonlyMap<number, TableLoad>): RowText {
  return {
    title: (r) => {
      const { year, index } = locateRow(data, r);
      const t = tables.get(year);
      return t?.status === 'loaded' ? (t.table.titles[index] ?? null) : null;
    },
  };
}

/** The years whose table files the rows need, ascending. */
export function yearsOfRows(data: Dataset, rows: Uint32Array): number[] {
  const mask = new Uint8Array(data.years.length);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] as number;
    data.years.forEach((s, k) => {
      if (r >= s.first && r < s.first + s.count) mask[k] = 1;
    });
  }
  return data.years.filter((_, k) => mask[k] === 1).map((s) => s.year);
}

/** The rows a virtual list draws, `start` to `end` exclusive: those in view and `overscan` either side. */
export function windowRows(
  scrollTop: number,
  viewport: number,
  rowHeight: number,
  count: number,
  overscan: number,
): { start: number; end: number } {
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const end = Math.min(count, Math.ceil((scrollTop + viewport) / rowHeight) + overscan);
  return { start: Math.min(start, end), end };
}

export function prUrl(repo: string, n: number): string {
  return `https://github.com/${repo}/pull/${n}`;
}

export function ticketUrl(n: number): string {
  return `https://tracker.ceph.com/issues/${n}`;
}
