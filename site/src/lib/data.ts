// The site data (Seam 4 of the plan), fetched at run time from `data/` under
// the site's base path: meta.json first, then the year files the period
// needs, and a year's table only when a view asks for it. Times are epoch
// seconds; -1 means none or unknown.

import { UNKNOWN_KIND } from './filters';
import { isNamedForm } from './handles';

export interface Named {
  id: string;
  name: string;
}

export interface Meta {
  repo: string;
  /** When the last fetch began. */
  fetched_through: number;
  window_start: number;
  /**
   * The years with a prs-, events- and table-<year>.json, ascending. A
   * year's files hold the PRs finally merged or closed in it (UTC), with all
   * their events whenever those happened; a PR still open is in the year of
   * `fetched_through`.
   */
  years: number[];
  bases: string[];
  components: Named[];
  families: Named[];
  commands: Named[];
  /** What a PR is: a bug fix, a feature, …; the `kind` column indexes it. */
  kinds: Named[];
  /** Holds `none`; every other value is a form of disclosure. */
  disclosure: string[];
  event_kinds: string[];
  /**
   * The login of every person an `author` or an `actor` index names, once
   * each. A deleted account is `ghost`, except as the author of a pull
   * request whose commits gave a name: then it is `ghost:` and that name.
   */
  people: string[];
  /** The indexes into `people` of the bot accounts, ascending. */
  people_bots: number[];
  /**
   * The indexes into `people` of the deleted accounts known by a name,
   * ascending; empty for data written before the rollup gave names.
   */
  people_deleted: number[];
}

/** The `state` column. */
export const PR_STATE = { open: 0, merged: 1, closed: 2 } as const;

type ColumnKind = 'int' | 'time' | 'small' | 'lists';
type Column<K extends ColumnKind> = K extends 'int'
  ? Int32Array
  : K extends 'time'
    ? Float64Array
    : K extends 'small'
      ? Uint8Array
      : readonly (readonly number[])[];
type Columns<Spec extends Record<string, ColumnKind>> = { readonly [C in keyof Spec]: Column<Spec[C]> };

// Times are kept as doubles so they outlive 2038; `small` holds flags and
// enums that fit a byte.
const PR_SPEC = {
  number: 'int',
  created: 'time',
  ready: 'time',
  closed: 'time',
  state: 'small',
  base: 'int',
  draft: 'small',
  opened_draft: 'small',
  reopened: 'int',
  in_window: 'small',
  additions: 'int',
  deletions: 'int',
  files: 'int',
  commits: 'int',
  first_commit: 'time',
  last_commit: 'time',
  first_response: 'time',
  first_approval: 'time',
  human_reviews: 'int',
  bot_reviews: 'int',
  bot_commands: 'int',
  disclosure: 'small',
  families: 'lists',
  components: 'lists',
  standing: 'int',
  /** An index into meta's `kinds`, or -1 for unknown. */
  kind: 'int',
  /** An index into meta's `people`. */
  author: 'int',
  /** 1 when the description links the PR it backports: the table's `backport_of` is set. */
  backport_link: 'small',
} as const satisfies Record<string, ColumnKind>;

/**
 * The columns of prs-<year>.json a file written before the rollup wrote them
 * may lack; such a file reads as 0 in every row.
 */
const LATER_PR_COLUMNS = ['backport_link'] as const;

const EVENT_SPEC = {
  pr: 'int',
  at: 'time',
  kind: 'small',
  sub: 'int',
  /**
   * An index into meta's `people` for a comment by someone other than the
   * author and for a human review by someone other than the author; -1 for
   * every other event.
   */
  actor: 'int',
} as const satisfies Record<string, ColumnKind>;

/** One column per field of prs-<year>.json, a row per PR. */
export type PrColumns = Columns<typeof PR_SPEC>;
/** One column per field of events-<year>.json; `pr` is a row of the same dataset. */
export type EventColumns = Columns<typeof EVENT_SPEC>;

export interface YearData {
  year: number;
  prs: PrColumns;
  /** `pr` is a row of this year's `prs`. */
  events: EventColumns;
  /** The prs file has `backport_link`; without it, every row reads as no link. */
  linksRecorded: boolean;
}

/** Where a year's rows and events sit in a dataset. */
export interface YearSpan {
  year: number;
  first: number;
  count: number;
  firstEvent: number;
  eventCount: number;
}

/** A year and an index into one of its files: a row of its table, or an entry of its `refs`. */
export interface YearIndex {
  year: number;
  index: number;
}

function locate(data: Dataset, what: 'row' | 'event', i: number): YearIndex {
  for (const s of data.years) {
    const [first, count] = what === 'row' ? [s.first, s.count] : [s.firstEvent, s.eventCount];
    if (Number.isInteger(i) && i >= first && i < first + count) return { year: s.year, index: i - first };
  }
  const total = what === 'row' ? data.size : data.events.pr.length;
  throw new RangeError(`${what} ${i} is not in the loaded data, which has ${total} ${what}s`);
}

/**
 * The year whose table holds a dataset row, and the row's index there:
 * `table(year).titles[index]`, `.commits[index]` and so on. Throws a
 * RangeError for a row outside the loaded data.
 */
export function locateRow(data: Dataset, row: number): YearIndex {
  return locate(data, 'row', row);
}

/**
 * The year whose table holds a dataset event's ref, and its index there:
 * `table(year).refs[index]`. Throws a RangeError for an event outside the
 * loaded data.
 */
export function locateEvent(data: Dataset, event: number): YearIndex {
  return locate(data, 'event', event);
}

/** The loaded years appended in order, so a row id is global across them. */
export interface Dataset {
  meta: Meta;
  /** The number of rows. */
  size: number;
  prs: PrColumns;
  events: EventColumns;
  years: YearSpan[];
  /** The loaded years whose prs file has no `backport_link`, so every row of them reads as no link. */
  linksUnrecorded: number[];
}

/** A commit of a PR: its SHA, then when it was authored and committed. */
export type Commit = readonly [sha: string, authored: number, committed: number];

/** Where a PR's kind was decided; `original` is the kind of the PR it backports. */
export const KIND_SOURCES = ['checklist', 'tracker', 'labels', 'original'] as const;
/** The empty string exactly when the kind is unknown. */
export type KindSource = (typeof KIND_SOURCES)[number] | '';

/**
 * table-<year>.json: what the PR table and the links back to GitHub need.
 * Every field but `refs` is aligned with that year's rows.
 */
export interface TableYear {
  titles: string[];
  authors: string[];
  commits: (readonly Commit[])[];
  /**
   * One per event of that year's events file, in its order: the comment,
   * review or event id, the SHA for `merged` and `force_push`, or the empty
   * string when there is none, as for `reopened`.
   */
  refs: string[];
  /** The tracker.ceph.com tickets each row references. */
  tickets: number[][];
  /** The number of the PR each row backports, or 0. */
  backport_of: number[];
  kind_source: KindSource[];
}

/** A data file that could not be fetched or does not have the expected shape. */
export class DataError extends Error {
  readonly file: string;
  readonly detail: string;
  /** The file did not arrive whole, so fetching it again may help; false when it arrived and could not be read. */
  readonly retriable: boolean;

  constructor(file: string, detail: string, retriable = false) {
    super(`${file}: ${detail}`);
    this.name = 'DataError';
    this.file = file;
    this.detail = detail;
    this.retriable = retriable;
  }
}

export interface LoadError {
  year: number;
  file: string;
  message: string;
  /** Fetching the year again may help: its file did not arrive whole. */
  retry: boolean;
}

export interface LoadResult {
  dataset: Dataset;
  /** The years that failed, each naming its file; the dataset holds the rest. */
  errors: LoadError[];
}

export type Fetch = (url: string) => Promise<Response>;

const prsFile = (year: number) => `prs-${year}.json`;
const eventsFile = (year: number) => `events-${year}.json`;
const tableFile = (year: number) => `table-${year}.json`;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((s) => typeof s === 'string');
}

function isNamedArray(v: unknown): v is Named[] {
  return Array.isArray(v) && v.every((n) => isRecord(n) && typeof n['id'] === 'string' && typeof n['name'] === 'string');
}

/** Words the Kind filter puts in the URL for itself, so no kind may take them as its id. */
const RESERVED_KIND_IDS = [UNKNOWN_KIND.id, 'all'];

export function parseMeta(raw: unknown, file = 'meta.json'): Meta {
  if (!isRecord(raw)) throw new DataError(file, 'is not an object');
  const field = <T>(name: string, ok: (v: unknown) => v is T, what: string): T => {
    const v = raw[name];
    if (!ok(v)) throw new DataError(file, `"${name}" is not ${what}`);
    return v;
  };
  const isTime = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
  const isIntegers = (v: unknown): v is number[] => Array.isArray(v) && v.every((y) => Number.isInteger(y));
  const meta: Meta = {
    repo: field('repo', (v): v is string => typeof v === 'string', 'a string'),
    fetched_through: field('fetched_through', isTime, 'a time in epoch seconds'),
    window_start: field('window_start', isTime, 'a time in epoch seconds'),
    years: [...field('years', isIntegers, 'a list of years')].sort((a, b) => a - b),
    bases: field('bases', isStringArray, 'a list of strings'),
    components: field('components', isNamedArray, 'a list of {id, name}'),
    families: field('families', isNamedArray, 'a list of {id, name}'),
    commands: field('commands', isNamedArray, 'a list of {id, name}'),
    kinds: field('kinds', isNamedArray, 'a list of {id, name}'),
    disclosure: field('disclosure', isStringArray, 'a list of strings'),
    event_kinds: field('event_kinds', isStringArray, 'a list of strings'),
    people: field('people', isStringArray, 'a list of logins'),
    people_bots: field('people_bots', isIntegers, 'a list of indexes'),
    people_deleted: raw['people_deleted'] === undefined ? [] : field('people_deleted', isIntegers, 'a list of indexes'),
  };
  const seen = new Set<string>();
  for (const login of meta.people) {
    if (seen.has(login)) throw new DataError(file, `"people" names "${login}" twice`);
    seen.add(login);
  }
  for (const list of ['people_bots', 'people_deleted'] as const) {
    const check = checkIndex(file, list, meta.people, 'people', false);
    meta[list].forEach((p, i) => check(p, `${i}`));
    meta[list] = [...meta[list]].sort((a, b) => a - b);
  }
  for (const p of meta.people_deleted) {
    const login = meta.people[p] as string;
    if (!isNamedForm(login)) throw new DataError(file, `"people_deleted" names "${login}", which is not "ghost:" and a name`);
    if (meta.people_bots.includes(p)) throw new DataError(file, `"people_deleted" names "${login}", which "people_bots" lists too`);
  }
  if (!meta.disclosure.includes('none')) throw new DataError(file, '"disclosure" has no "none"');
  const reserved = meta.kinds.find((k) => RESERVED_KIND_IDS.includes(k.id));
  if (reserved) {
    throw new DataError(file, `"kinds" has the id "${reserved.id}", which the Kind filter keeps for its own choice`);
  }
  if (meta.fetched_through < meta.window_start) {
    throw new DataError(file, '"fetched_through" is before "window_start"');
  }
  return meta;
}

const INT32_MAX = 2 ** 31 - 1;

function isValue(kind: ColumnKind, v: unknown): boolean {
  switch (kind) {
    case 'int':
      return Number.isInteger(v) && Math.abs(v as number) <= INT32_MAX;
    case 'time':
      return Number.isSafeInteger(v) && (v as number) >= -1;
    case 'small':
      return Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 255;
    case 'lists':
      return Array.isArray(v) && v.every((i) => Number.isInteger(i) && i >= 0);
  }
}

function toColumn(kind: ColumnKind, values: unknown[]) {
  switch (kind) {
    case 'int':
      return Int32Array.from(values as number[]);
    case 'time':
      return Float64Array.from(values as number[]);
    case 'small':
      return Uint8Array.from(values as number[]);
    case 'lists':
      return values as readonly (readonly number[])[];
  }
}

/**
 * Reads an object of equal-length columns; every column of `spec` must be
 * there but those named `later`, which read as 0 in every row when missing.
 */
function parseColumns<Spec extends Record<string, ColumnKind>>(
  raw: unknown,
  file: string,
  spec: Spec,
  later: readonly string[] = [],
): Columns<Spec> {
  if (!isRecord(raw)) throw new DataError(file, 'is not an object of columns');
  const names = Object.keys(spec);
  const first = names[0];
  let length = -1;
  const out: Record<string, unknown> = {};
  for (const name of names) {
    const kind = spec[name] as ColumnKind;
    const values = raw[name] === undefined && later.includes(name) ? new Array(Math.max(length, 0)).fill(0) : raw[name];
    if (!Array.isArray(values)) throw new DataError(file, `column "${name}" is missing`);
    if (length === -1) length = values.length;
    else if (values.length !== length) {
      throw new DataError(file, `column "${name}" has ${values.length} values where "${first}" has ${length}`);
    }
    const bad = values.findIndex((v) => !isValue(kind, v));
    if (bad !== -1) throw new DataError(file, `column "${name}" has a bad value at row ${bad}: ${JSON.stringify(values[bad])}`);
    out[name] = toColumn(kind, values);
  }
  return out as Columns<Spec>;
}

/**
 * A check that a value indexes `dictionary`, which meta calls `name`; -1 also
 * passes where `unknown` allows it. `at` names the row or event holding it.
 */
function checkIndex(file: string, column: string, dictionary: readonly unknown[], name: string, unknown: boolean) {
  return (value: number, at: string) => {
    if ((value >= 0 && value < dictionary.length) || (unknown && value === -1)) return;
    throw new DataError(file, `${columnName(file, column)} has ${value} at ${at}, outside "${name}" of ${dictionary.length} entries`);
  };
}

/** How an error names a field: a column of a year file, or a field of meta.json. */
function columnName(file: string, column: string): string {
  return file === 'meta.json' ? `"${column}"` : `column "${column}"`;
}

/** Reads a prs file; every index must be inside its dictionary in `meta`. */
export function parsePrs(raw: unknown, file: string, meta: Meta): PrColumns {
  const prs = parseColumns(raw, file, PR_SPEC, LATER_PR_COLUMNS);
  const scalars = [
    ['base', meta.bases, 'bases', false],
    ['disclosure', meta.disclosure, 'disclosure', false],
    ['kind', meta.kinds, 'kinds', true],
    ['author', meta.people, 'people', false],
  ] as const;
  for (const [column, dictionary, name, unknown] of scalars) {
    const check = checkIndex(file, column, dictionary, name, unknown);
    prs[column].forEach((v, r) => check(v, `row ${r}`));
  }
  for (const column of ['families', 'components'] as const) {
    const check = checkIndex(file, column, meta[column], column, false);
    prs[column].forEach((list, r) => list.forEach((v) => check(v, `row ${r}`)));
  }
  return prs;
}

const COMMAND_KINDS = ['command_author', 'command_other'];

/**
 * Reads an events file whose `pr` must be a row of a year with `rows` PRs,
 * whose `kind` must be in meta's `event_kinds`, whose `sub` must be in its
 * `commands` for a command, and whose `actor` must be in its `people` or -1.
 */
export function parseEvents(raw: unknown, file: string, rows: number, meta: Meta): EventColumns {
  const events = parseColumns(raw, file, EVENT_SPEC);
  const bad = events.pr.findIndex((r) => r < 0 || r >= rows);
  if (bad !== -1) {
    throw new DataError(file, `column "pr" names row ${events.pr[bad]} at ${bad}, but the year has ${rows} rows`);
  }
  const kind = checkIndex(file, 'kind', meta.event_kinds, 'event_kinds', false);
  const sub = checkIndex(file, 'sub', meta.commands, 'commands', false);
  const actor = checkIndex(file, 'actor', meta.people, 'people', true);
  const commands = COMMAND_KINDS.map((k) => meta.event_kinds.indexOf(k)).filter((k) => k !== -1);
  events.kind.forEach((k, i) => {
    kind(k, `event ${i}`);
    if (commands.includes(k)) sub(events.sub[i] as number, `event ${i}`);
    actor(events.actor[i] as number, `event ${i}`);
  });
  return events;
}

export function parseYear(year: number, prsRaw: unknown, eventsRaw: unknown, meta: Meta): YearData {
  const prs = parsePrs(prsRaw, prsFile(year), meta);
  return {
    year,
    prs,
    events: parseEvents(eventsRaw, eventsFile(year), prs.number.length, meta),
    linksRecorded: isRecord(prsRaw) && prsRaw['backport_link'] !== undefined,
  };
}

const SHA = /^[0-9a-f]{40}$/;
const ID = /^[1-9]\d*$/;
const SHA_REF_KINDS = ['merged', 'force_push'];

const isCommit = (c: unknown): boolean =>
  Array.isArray(c) &&
  c.length === 3 &&
  typeof c[0] === 'string' &&
  SHA.test(c[0]) &&
  isValue('time', c[1]) &&
  isValue('time', c[2]);

const isKindSource = (s: unknown): s is KindSource =>
  s === '' || (KIND_SOURCES as readonly unknown[]).includes(s);

/**
 * Reads a year's table: one entry per row of `year` in every column but
 * `refs`, which has one per event. A ref must have the form its event's
 * kind gives, and a kind source must be empty exactly when the row's kind
 * is unknown.
 */
export function parseTable(raw: unknown, file: string, year: YearData, meta: Meta): TableYear {
  if (!isRecord(raw)) throw new DataError(file, 'is not an object of columns');
  const rows = year.prs.number.length;
  const perRow = { length: rows, unit: 'row', of: `the year has ${rows} rows` };
  const perEvent = {
    length: year.events.kind.length,
    unit: 'event',
    of: `${eventsFile(year.year)} has ${year.events.kind.length} events`,
  };
  const column = <T>(name: string, per: typeof perRow, ok: (v: unknown, i: number) => boolean): T[] => {
    const v = raw[name];
    if (!Array.isArray(v)) throw new DataError(file, `column "${name}" is missing`);
    if (v.length !== per.length) throw new DataError(file, `column "${name}" has ${v.length} values where ${per.of}`);
    const bad = v.findIndex((x, i) => !ok(x, i));
    if (bad !== -1) {
      throw new DataError(file, `column "${name}" has a bad value at ${per.unit} ${bad}: ${JSON.stringify(v[bad])}`);
    }
    return v as T[];
  };
  const isString = (v: unknown) => typeof v === 'string';
  const shaKinds = SHA_REF_KINDS.map((k) => meta.event_kinds.indexOf(k)).filter((k) => k !== -1);

  const table: TableYear = {
    titles: column('titles', perRow, isString),
    authors: column('authors', perRow, isString),
    commits: column('commits', perRow, (v) => Array.isArray(v) && v.every(isCommit)),
    refs: column('refs', perEvent, (v, i) => {
      if (typeof v !== 'string') return false;
      return v === '' || (shaKinds.includes(year.events.kind[i] as number) ? SHA : ID).test(v);
    }),
    tickets: column('tickets', perRow, (v) => Array.isArray(v) && v.every((t) => Number.isSafeInteger(t) && t > 0)),
    backport_of: column('backport_of', perRow, (v) => Number.isSafeInteger(v) && (v as number) >= 0),
    kind_source: column('kind_source', perRow, isKindSource),
  };
  table.kind_source.forEach((source, r) => {
    const kind = year.prs.kind[r] as number;
    if ((source === '') !== (kind === -1)) {
      const named = kind === -1 ? 'unknown' : `"${meta.kinds[kind]?.id}"`;
      throw new DataError(file, `column "kind_source" is "${source}" at row ${r}, where the kind is ${named}`);
    }
  });
  return table;
}

type Typed = Int32Array | Float64Array | Uint8Array;

function joinTyped(kind: Exclude<ColumnKind, 'lists'>, cols: readonly Typed[]): Typed {
  const total = cols.reduce((n, c) => n + c.length, 0);
  const out = kind === 'int' ? new Int32Array(total) : kind === 'time' ? new Float64Array(total) : new Uint8Array(total);
  let at = 0;
  for (const c of cols) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

function concat<Spec extends Record<string, ColumnKind>>(spec: Spec, parts: readonly Columns<Spec>[]): Columns<Spec> {
  const out: Record<string, unknown> = {};
  for (const [name, kind] of Object.entries(spec)) {
    const cols = parts.map((p) => p[name]);
    out[name] =
      kind === 'lists' ? (cols as (readonly (readonly number[])[])[]).flat() : joinTyped(kind, cols as Typed[]);
  }
  return out as Columns<Spec>;
}

/** The years appended in the order given, with each event moved onto its global row. */
export function combine(meta: Meta, years: readonly YearData[]): Dataset {
  const spans: YearSpan[] = [];
  let size = 0;
  let eventSize = 0;
  for (const y of years) {
    const eventCount = y.events.pr.length;
    spans.push({ year: y.year, first: size, count: y.prs.number.length, firstEvent: eventSize, eventCount });
    size += y.prs.number.length;
    eventSize += eventCount;
  }
  const events = years.map((y, i) => {
    const first = spans[i]?.first ?? 0;
    return { ...y.events, pr: y.events.pr.map((row) => row + first) };
  });
  return {
    meta,
    size,
    prs: concat(PR_SPEC, years.map((y) => y.prs)),
    events: concat(EVENT_SPEC, events),
    years: spans,
    linksUnrecorded: years.filter((y) => !y.linksRecorded).map((y) => y.year),
  };
}

/**
 * The years whose files a period starting at `start` (epoch seconds) needs:
 * the year it starts in and every later one. A year's files hold the PRs
 * that finished in it, and a PR is active in a period only when it finished
 * on or after the period's start or is still open, which puts it in the
 * last year's files.
 */
export function yearsFor(meta: Meta, start: number): number[] {
  const first = new Date(start * 1000).getUTCFullYear();
  return meta.years.filter((y) => y >= first);
}

/** index.json: every PR's number, ascending, and at the same position the year whose files hold it. */
export interface PrIndex {
  numbers: Int32Array;
  years: Int32Array;
}

const INDEX_FILE = 'index.json';

export function parseIndex(raw: unknown, meta: Meta): PrIndex {
  if (!isRecord(raw)) throw new DataError(INDEX_FILE, 'is not an object of columns');
  const column = (name: string) => {
    const v = raw[name];
    if (!Array.isArray(v) || !v.every((n) => Number.isInteger(n) && Math.abs(n) <= INT32_MAX)) {
      throw new DataError(INDEX_FILE, `column "${name}" is missing or not a list of integers`);
    }
    return Int32Array.from(v as number[]);
  };
  const numbers = column('numbers');
  const years = column('years');
  if (years.length !== numbers.length) {
    throw new DataError(INDEX_FILE, `column "years" has ${years.length} values where "numbers" has ${numbers.length}`);
  }
  numbers.forEach((n, i) => {
    if (n < 1) throw new DataError(INDEX_FILE, `column "numbers" has ${n} at ${i}, which is not a PR number`);
    if (i > 0 && n <= (numbers[i - 1] as number)) {
      throw new DataError(INDEX_FILE, `column "numbers" is not strictly ascending at ${i}`);
    }
  });
  const known = new Set(meta.years);
  years.forEach((y, i) => {
    if (!known.has(y)) throw new DataError(INDEX_FILE, `column "years" has ${y} at ${i}, which meta's "years" does not list`);
  });
  return { numbers, years };
}

/** The year whose files hold PR `number`, or null when no year does. */
export function yearOfPr(index: PrIndex, number: number): number | null {
  const n = index.numbers;
  let lo = 0;
  let hi = n.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((n[mid] as number) < number) lo = mid + 1;
    else hi = mid;
  }
  return n[lo] === number ? (index.years[lo] as number) : null;
}

/** A PR found in a year of its own: that year alone as a dataset, and the PR's row in it. */
export interface Found {
  dataset: Dataset;
  row: number;
}

/**
 * The PRs a year's files hold, as the page names them: "PRs finished in
 * 2025", and for the year of the last fetch "PRs finished in 2026 or still
 * open".
 */
export function yearHolds(meta: Meta, year: number): string {
  const open = year === new Date(meta.fetched_through * 1000).getUTCFullYear();
  return `PRs finished in ${year}${open ? ' or still open' : ''}`;
}

async function fetchJson(fetchFn: Fetch, baseUrl: string, file: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchFn(`${baseUrl}${file}`);
  } catch (err) {
    throw new DataError(file, `could not be fetched (${err instanceof Error ? err.message : String(err)})`, true);
  }
  if (!res.ok) throw new DataError(file, `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`, true);
  try {
    return await res.json();
  } catch {
    // A body cut short reads as invalid JSON, so this is worth fetching again too.
    throw new DataError(file, 'is not valid JSON', true);
  }
}

/** `baseUrl` ends in a slash, e.g. `/rook-dev-stats/data/`. */
export async function loadMeta(baseUrl: string, fetchFn: Fetch): Promise<Meta> {
  return parseMeta(await fetchJson(fetchFn, baseUrl, 'meta.json'));
}

/**
 * Loads year files and tables. A year that loaded is never fetched again,
 * and asks for a year while it is being fetched share that fetch; a year
 * whose files could not be fetched is fetched again the next time it is
 * asked for. A table that failed stays failed until the page is reloaded.
 */
export class DataLoader {
  readonly meta: Meta;
  readonly #baseUrl: string;
  readonly #fetch: Fetch;
  readonly #years = new Map<number, Promise<YearData>>();
  readonly #tables = new Map<number, Promise<TableYear>>();

  constructor(meta: Meta, baseUrl: string, fetchFn: Fetch) {
    this.meta = meta;
    this.#baseUrl = baseUrl;
    this.#fetch = fetchFn;
  }

  /** The years that have loaded, for asking without waiting. */
  readonly #done = new Map<number, YearData>();

  #year(year: number): Promise<YearData> {
    let p = this.#years.get(year);
    if (!p) {
      p = Promise.all([
        fetchJson(this.#fetch, this.#baseUrl, prsFile(year)),
        fetchJson(this.#fetch, this.#baseUrl, eventsFile(year)),
      ]).then(
        ([prs, events]) => {
          const y = parseYear(year, prs, events, this.meta);
          this.#done.set(year, y);
          return y;
        },
        (err: unknown) => {
          // A year that failed is fetched again the next time it is asked for.
          if (this.#years.get(year) === p) this.#years.delete(year);
          throw err;
        },
      );
      this.#years.set(year, p);
    }
    return p;
  }

  /** Whether a year's files have loaded. */
  has(year: number): boolean {
    return this.#done.has(year);
  }

  /** The years asked for as one dataset, now, when every one has already loaded; else null. */
  loaded(years: readonly number[]): LoadResult | null {
    const wanted = [...new Set(years)].sort((a, b) => a - b);
    const have = wanted.map((y) => this.#done.get(y));
    if (have.some((y) => y === undefined)) return null;
    return { dataset: combine(this.meta, have as YearData[]), errors: [] };
  }

  /**
   * The years asked for, in ascending order, as one dataset; never rejects.
   * `arrived` is called with each year whose files have loaded, as it does,
   * one already loaded included.
   */
  async load(years: readonly number[], arrived?: (year: number) => void): Promise<LoadResult> {
    const wanted = [...new Set(years)].sort((a, b) => a - b);
    const settled = await Promise.allSettled(
      wanted.map((y) =>
        this.#year(y).then((data) => {
          arrived?.(y);
          return data;
        }),
      ),
    );
    const loaded: YearData[] = [];
    const errors: LoadError[] = [];
    settled.forEach((s, i) => {
      const year = wanted[i] as number;
      if (s.status === 'fulfilled') loaded.push(s.value);
      else if (s.reason instanceof DataError) {
        errors.push({ year, file: s.reason.file, message: s.reason.detail, retry: s.reason.retriable });
      } else errors.push({ year, file: prsFile(year), message: String(s.reason), retry: false });
    });
    return { dataset: combine(this.meta, loaded), errors };
  }

  #index: Promise<PrIndex> | null = null;

  /** index.json, fetched on first use: only a PR asked for by number outside the loaded years needs it. */
  index(): Promise<PrIndex> {
    this.#index ??= fetchJson(this.#fetch, this.#baseUrl, INDEX_FILE).then((raw) => parseIndex(raw, this.meta));
    return this.#index;
  }

  /** The year whose files hold PR `number`, from the index; null when no year does. */
  async yearOf(number: number): Promise<number | null> {
    return yearOfPr(await this.index(), number);
  }

  /**
   * A PR wherever it is: the index names its year, which is loaded alone.
   * Null for a number no year holds; rejects with a DataError when the
   * index or the year cannot be loaded.
   */
  async find(number: number): Promise<Found | null> {
    const year = await this.yearOf(number);
    if (year === null) return null;
    const { dataset, errors } = await this.load([year]);
    const failed = errors[0];
    if (failed) throw new DataError(failed.file, failed.message);
    const row = dataset.prs.number.indexOf(number);
    return row === -1 ? null : { dataset, row };
  }

  /** A year's table, fetched on first use. */
  table(year: number): Promise<TableYear> {
    let p = this.#tables.get(year);
    if (!p) {
      p = Promise.all([this.#year(year), fetchJson(this.#fetch, this.#baseUrl, tableFile(year))]).then(([y, raw]) =>
        parseTable(raw, tableFile(year), y, this.meta),
      );
      this.#tables.set(year, p);
    }
    return p;
  }
}
