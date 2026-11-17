// The figures the methods page gives about the data, computed from what the
// site loads when the page is shown. Each is over the PRs open at some point
// in the period it is given, the last six months on the page, on
// every branch, split into the development branch, master, and the
// rest where the two differ in kind;
// event counts take only the events inside that period.

import { type Dataset, type TableYear, locateEvent, locateRow } from '../data';
import { DAY, type Filters, developmentBases } from '../filters';
import { isBot, isNamedDeleted, isPooledDeleted } from '../handles';
import { shownPeople } from '../people';
import { openedIn, select } from '../select';
import { defaultFilters } from '../state';
import type { Period } from '../stats/buckets';
import { nearestRank } from '../stats/measures';
import { authorRows, reviewerRows } from '../stats/people';

/** A count of PRs on the development branch and on every other branch. */
export interface Split {
  main: number;
  other: number;
}

/** A period as the filters name it, by its first and last day. */
export type Days = Pick<Filters, 'from' | 'to'>;

/** The PRs `days` selects on every branch: those open at some point in it. */
export function baseRows(data: Dataset, days: Days): Uint32Array {
  return select(data, { ...defaultFilters(data.meta), ...days, target: 'all' });
}

function openedDuring(data: Dataset, r: number, period: Period): boolean {
  const created = data.prs.created[r] as number;
  return created >= period.start && created < period.end;
}

function split(data: Dataset, rows: Uint32Array, keep: (r: number) => boolean): Split {
  const development = developmentBases(data.meta.bases);
  const out = { main: 0, other: 0 };
  for (const r of rows) {
    if (!keep(r)) continue;
    if (development[data.prs.base[r] as number] === 1) out.main++;
    else out.other++;
  }
  return out;
}

export interface Coverage {
  /** Open at some point in the period: `rows`. */
  active: number;
  /** Of those, opened in the period; the rest were opened before it. */
  openedInPeriod: number;
}

export function coverage(data: Dataset, rows: Uint32Array, period: Period): Coverage {
  let openedInPeriod = 0;
  for (const r of rows) if (openedDuring(data, r, period)) openedInPeriod++;
  return { active: rows.length, openedInPeriod };
}

/** Drafts never made ready, which have no response or approval time. */
export function neverReady(data: Dataset, rows: Uint32Array): Split {
  return split(data, rows, (r) => (data.prs.ready[r] as number) < 0);
}

/** PRs with commits whose first commit is unknown: dated after the opening. */
export function firstCommitUnknown(data: Dataset, rows: Uint32Array): Split {
  const p = data.prs;
  return split(data, rows, (r) => (p.commits[r] as number) > 0 && (p.first_commit[r] as number) < 0);
}

/** PRs with no commits, which have no first or last commit. */
export function noCommits(data: Dataset, rows: Uint32Array): Split {
  return split(data, rows, (r) => data.prs.commits[r] === 0);
}

/** The PRs of unknown standing. */
export function standingUnknown(data: Dataset, rows: Uint32Array): number {
  const p = data.prs;
  let unknown = 0;
  for (const r of rows) if ((p.standing[r] as number) < 0) unknown++;
  return unknown;
}

export function kindUnknown(data: Dataset, rows: Uint32Array): Split {
  return split(data, rows, (r) => data.prs.kind[r] === -1);
}

/** PRs by the strongest form of disclosure they make, under meta's names, `none` among them. */
export function disclosureForms(data: Dataset, rows: Uint32Array): Record<string, Split> {
  return Object.fromEntries(data.meta.disclosure.map((name, i) => [name, split(data, rows, (r) => data.prs.disclosure[r] === i)]));
}

export interface FamilyCount {
  id: string;
  name: string;
  count: Split;
}

/** PRs naming each tool family; a PR naming two counts under both. */
export function familyCounts(data: Dataset, rows: Uint32Array): FamilyCount[] {
  return data.meta.families.map((f, i) => ({
    id: f.id,
    name: f.name,
    count: split(data, rows, (r) => (data.prs.families[r] as readonly number[]).includes(i)),
  }));
}

/** Calls `fn` with each event of `rows` inside the period. */
function forPeriodEvents(data: Dataset, rows: Uint32Array, period: Period, fn: (e: number) => void) {
  const { start, end } = period;
  const keep = new Uint8Array(data.size);
  for (const r of rows) keep[r] = 1;
  const ev = data.events;
  for (let e = 0; e < ev.pr.length; e++) {
    const t = ev.at[e] as number;
    if (keep[ev.pr[e] as number] === 1 && t >= start && t < end) fn(e);
  }
}

const COMMENT_KINDS = ['comment_other', 'comment_author', 'command_author', 'command_other', 'bot_account'];

export interface CommentCounts {
  /** Every conversation comment, bot accounts' included. */
  comments: number;
  /** Comments by people that are bot commands. */
  commands: number;
  /** Of those, made by the PR's author. */
  commandsByAuthor: number;
  /** Comments by bot accounts. */
  botAccount: number;
}

export function commentCounts(data: Dataset, rows: Uint32Array, period: Period): CommentCounts {
  const kinds = data.meta.event_kinds;
  const [, , author, other, bot] = COMMENT_KINDS.map((k) => kinds.indexOf(k));
  const comment = new Set(COMMENT_KINDS.map((k) => kinds.indexOf(k)).filter((k) => k !== -1));
  const out = { comments: 0, commands: 0, commandsByAuthor: 0, botAccount: 0 };
  forPeriodEvents(data, rows, period, (e) => {
    const k = data.events.kind[e] as number;
    if (!comment.has(k)) return;
    out.comments++;
    if (k === author || k === other) out.commands++;
    if (k === author) out.commandsByAuthor++;
    if (k === bot) out.botAccount++;
  });
  return out;
}

/** The sources of a PR's kind, as the table's `kind_source` names them, and `unknown`. */
export const KIND_SOURCE_ROWS = ['labels', 'issues', 'original', 'unknown'] as const;
export type KindSourceRow = (typeof KIND_SOURCE_ROWS)[number];

function tableFor(tables: ReadonlyMap<number, TableYear>, year: number): TableYear {
  const t = tables.get(year);
  if (!t) throw new Error(`table-${year}.json is not loaded`);
  return t;
}

/** PRs by where their kind was decided. Needs the table of every year `rows` reach. */
export function kindSources(
  data: Dataset,
  tables: ReadonlyMap<number, TableYear>,
  rows: Uint32Array,
): Record<KindSourceRow, Split> {
  const source = (r: number): KindSourceRow => {
    const { year, index } = locateRow(data, r);
    return tableFor(tables, year).kind_source[index] || 'unknown';
  };
  return Object.fromEntries(KIND_SOURCE_ROWS.map((s) => [s, split(data, rows, (r) => source(r) === s)])) as Record<
    KindSourceRow,
    Split
  >;
}

export interface EventRefs {
  /** A name from meta's `event_kinds`. */
  kind: string;
  events: number;
  /** Events whose ref is empty: nothing of their own to link to. */
  missing: number;
}

/** Each kind of event in the period, in meta's order, with how many have no ref; kinds with no event are left out. */
export function eventRefs(
  data: Dataset,
  tables: ReadonlyMap<number, TableYear>,
  rows: Uint32Array,
  period: Period,
): EventRefs[] {
  const kinds = data.meta.event_kinds;
  const events = new Array<number>(kinds.length).fill(0);
  const missing = new Array<number>(kinds.length).fill(0);
  forPeriodEvents(data, rows, period, (e) => {
    const k = data.events.kind[e] as number;
    const { year, index } = locateEvent(data, e);
    events[k] = (events[k] as number) + 1;
    if (tableFor(tables, year).refs[index] === '') missing[k] = (missing[k] as number) + 1;
  });
  return kinds.flatMap((kind, k) => ((events[k] as number) > 0 ? [{ kind, events: events[k] as number, missing: missing[k] as number }] : []));
}

/** The report's default filters over `days`: PRs on the development branch open at some point in it. */
export function defaultRows(data: Dataset, days: Days): Uint32Array {
  return select(data, { ...defaultFilters(data.meta), ...days });
}

export interface PeopleFigures {
  /**
   * Rows of the Authors table, bot accounts left out as the page leaves them
   * out by default; the pooled deleted entry, which no row ranks, is not one.
   */
  authors: number;
  /** Bot accounts among the authors, which the table hides until asked. */
  botAuthors: number;
  /** Rows of the Reviewers table, bot accounts and the pooled deleted entry left out. */
  reviewers: number;
  /** Authors shown whose median to merge rests on too few PRs to be given. */
  authorsTooFew: number;
  /** The lines changed by the largest PR the Authors table counts, bot accounts not shown. */
  largestLines: number;
  /** Its share of all the lines changed the Authors table counts, bot accounts not shown; null with none. */
  largestShare: number | null;
  /** The pull requests the Authors table counts that deleted accounts opened. */
  deleted: DeletedAuthors;
}

export interface DeletedAuthors {
  /** Those credited to a name from their commits. */
  namedPrs: number;
  /** The distinct names they are credited to: rows of the Authors table. */
  names: number;
  /** Those of the pooled entry, whose commits gave no name. */
  pooledPrs: number;
}

/** What the People tables show for `rows` over `period`, computed as they compute it. */
export function peopleFigures(data: Dataset, rows: Uint32Array, period: Period): PeopleFigures {
  const opened = openedIn(data, rows, period);
  const authors = authorRows(data, opened);
  const reviewers = reviewerRows(data, rows, period);
  const ranked = <R extends { person: number }>(list: readonly R[]) => shownPeople(list, data.meta, false);
  const p = data.prs;
  let largestLines = 0;
  let total = 0;
  for (const r of opened) {
    if (isBot(data.meta, p.author[r] as number)) continue;
    const lines = (p.additions[r] as number) + (p.deletions[r] as number);
    total += lines;
    largestLines = Math.max(largestLines, lines);
  }
  const named = authors.filter((a) => isNamedDeleted(data.meta, a.person));
  return {
    authors: ranked(authors).length,
    botAuthors: authors.filter((a) => isBot(data.meta, a.person)).length,
    reviewers: ranked(reviewers).length,
    authorsTooFew: ranked(authors).filter((a) => a.merge.state === 'tooFew').length,
    largestLines,
    largestShare: total === 0 ? null : largestLines / total,
    deleted: {
      namedPrs: named.reduce((n, a) => n + a.opened, 0),
      names: named.length,
      pooledPrs: authors.find((a) => isPooledDeleted(data.meta, a.person))?.opened ?? 0,
    },
  };
}

/** How many of a group's most active authors its concentration is measured over. */
export const TOP_AUTHORS = 3;

export interface GroupProfile {
  prs: number;
  /** The share opened in the period; the rest were opened before it. */
  openedInPeriod: number | null;
  /** Lines added plus deleted, a nearest-rank median. */
  medianLines: number | null;
  /** Days from opening to the last fetch, a nearest-rank median. */
  medianAgeDays: number | null;
  /** The share opened by the group's `TOP_AUTHORS` most active authors. */
  topAuthors: number | null;
  /** The share of each kind, by meta's kind id, and `unknown`. */
  kinds: Record<string, number> | null;
}

function profile(data: Dataset, rows: Uint32Array, period: Period): GroupProfile {
  const n = rows.length;
  if (n === 0) return { prs: 0, openedInPeriod: null, medianLines: null, medianAgeDays: null, topAuthors: null, kinds: null };
  const p = data.prs;
  const meta = data.meta;
  let inPeriod = 0;
  const lines = new Float64Array(n);
  const ages = new Float64Array(n);
  const byAuthor = new Map<number, number>();
  const kinds: Record<string, number> = Object.fromEntries([...meta.kinds.map((k) => k.id), 'unknown'].map((k) => [k, 0]));
  rows.forEach((r, i) => {
    if (openedDuring(data, r, period)) inPeriod++;
    lines[i] = (p.additions[r] as number) + (p.deletions[r] as number);
    ages[i] = (meta.fetched_through - (p.created[r] as number)) / DAY;
    const author = p.author[r] as number;
    byAuthor.set(author, (byAuthor.get(author) ?? 0) + 1);
    const kind = meta.kinds[p.kind[r] as number]?.id ?? 'unknown';
    kinds[kind] = (kinds[kind] as number) + 1;
  });
  const top = [...byAuthor.values()].sort((a, b) => b - a).slice(0, TOP_AUTHORS);
  return {
    prs: n,
    openedInPeriod: inPeriod / n,
    medianLines: nearestRank(lines.sort(), 0.5),
    medianAgeDays: nearestRank(ages.sort(), 0.5),
    topAuthors: top.reduce((a, b) => a + b, 0) / n,
    kinds: Object.fromEntries(Object.entries(kinds).map(([k, c]) => [k, c / n])),
  };
}

/** The PRs that do not disclose and those that do, each described by what differs between them besides disclosure. */
export function disclosureGroups(
  data: Dataset,
  rows: Uint32Array,
  period: Period,
): { notDisclosed: GroupProfile; disclosed: GroupProfile } {
  const none = data.meta.disclosure.indexOf('none');
  return {
    notDisclosed: profile(data, rows.filter((r) => data.prs.disclosure[r] === none), period),
    disclosed: profile(data, rows.filter((r) => data.prs.disclosure[r] !== none), period),
  };
}

