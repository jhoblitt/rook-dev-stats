// The methods page's figures as the prose shows them: each `{{name}}` in a
// section's Markdown is a sentence-sized value or a table, written here
// from the numbers `figures.ts` computes. A figure is text or a table of
// text, never markup.

import type { Dataset, Meta, TableYear } from '../data';
import { DISCLOSED, NOT_DISCLOSED, dayOf, periodRange } from '../filters';
import { formatCount, formatDays, formatShare } from '../format';
import { LANE_CAP } from '../lanes';
import { HORIZONS, MIN_FOLLOWED } from '../llm';
import { REVIEWS_RECORDED_FROM } from '../review';
import { openedIn } from '../select';
import { MIN_PRS } from '../stats/people';
import { RECENT_MONTHS, recentFilters } from '../state';
import {
  type CommentCounts,
  type Coverage,
  type Days,
  type EventRefs,
  type FamilyCount,
  type GroupProfile,
  KIND_SOURCE_ROWS,
  type PeopleFigures,
  TOP_AUTHORS,
  type KindSourceRow,
  type Split,
  baseRows,
  commentCounts,
  coverage,
  defaultRows,
  disclosureForms,
  disclosureGroups,
  eventRefs,
  familyCounts,
  firstCommitUnknown,
  kindSources,
  noCommits,
  kindUnknown,
  neverReady,
  peopleFigures,
  standingUnknown,
} from './figures';

/** The figures computed from the PR and event files. */
export interface DataFigures {
  /** The period every figure is over. */
  period: Days;
  coverage: Coverage;
  neverReady: Split;
  firstCommitUnknown: Split;
  noCommits: Split;
  standingUnknown: { unknown: number; openedBefore: number };
  kindUnknown: Split;
  disclosure: Record<string, Split>;
  families: FamilyCount[];
  comments: CommentCounts;
  /** The People tables over the period with every other filter as the report opens. */
  people: PeopleFigures;
  /**
   * The PRs the AI-use section compares over the period with every other
   * filter as the report opens, those
   * on the development branch opened in the period, split by disclosure.
   */
  groups: { notDisclosed: GroupProfile; disclosed: GroupProfile };
  /** How many PRs that comparison holds. */
  compared: number;
  /** Every PR those filters select, split by disclosure, for the share of each group opened in the period. */
  viewGroups: { notDisclosed: GroupProfile; disclosed: GroupProfile };
  /** How many PRs those filters select. */
  viewSize: number;
}

/** The figures that also need each year's table file. */
export interface TableFigures {
  kindSources: Record<KindSourceRow, Split>;
  eventRefs: EventRefs[];
}

/** The figures over `days`, which the page gives as the last six months. */
export function dataFigures(data: Dataset, days: Days): DataFigures {
  const period = periodRange(days);
  const rows = baseRows(data, days);
  const view = defaultRows(data, days);
  const compared = openedIn(data, view, period);
  return {
    period: { from: days.from, to: days.to },
    coverage: coverage(data, rows, period),
    neverReady: neverReady(data, rows),
    firstCommitUnknown: firstCommitUnknown(data, rows),
    noCommits: noCommits(data, rows),
    standingUnknown: standingUnknown(data, rows, data.meta.window_start),
    kindUnknown: kindUnknown(data, rows),
    disclosure: disclosureForms(data, rows),
    families: familyCounts(data, rows),
    comments: commentCounts(data, rows, period),
    people: peopleFigures(data, view, period),
    groups: disclosureGroups(data, compared, period),
    compared: compared.length,
    viewGroups: disclosureGroups(data, view, period),
    viewSize: view.length,
  };
}

export function tableFigures(data: Dataset, tables: ReadonlyMap<number, TableYear>, days: Days): TableFigures {
  const period = periodRange(days);
  const rows = baseRows(data, days);
  return { kindSources: kindSources(data, tables, rows), eventRefs: eventRefs(data, tables, rows, period) };
}

/** Something the page loads and computes once it is shown. */
export type Loadable<T> = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; value: T };

/** What a figure shows: its value, or why there is none yet. */
export type View<T> = { state: 'loading' } | { state: 'error' } | { state: 'ready'; value: T };

/** A figure from what it needs: meta alone, the PR and event files, or the table files too. */
type Figure<T> =
  | { needs: 'meta'; show: (m: Meta) => T }
  | { needs: 'data'; show: (m: Meta, d: DataFigures) => T }
  | { needs: 'tables'; show: (m: Meta, d: DataFigures, t: TableFigures) => T };

const total = (s: Split) => s.main + s.other;
/** A share of a whole, or a dash for a share of nothing. */
const share = (n: number, of: number) => (of === 0 ? '–' : formatShare(n / of));
const disclosed = (d: DataFigures) =>
  Object.entries(d.disclosure).reduce((n, [form, s]) => (form === 'none' ? n : n + total(s)), 0);
const refsOf = (t: TableFigures, kind: string) => t.eventRefs.find((r) => r.kind === kind) ?? { events: 0, missing: 0 };
const forcePushes = (t: TableFigures) => refsOf(t, 'force_push');
const count = (f: (d: DataFigures) => number): Figure<string> => ({ needs: 'data', show: (_m, d) => formatCount(f(d)) });
/** A constant of the method, written from the code that applies it. */
const constant = (text: string): Figure<string> => ({ needs: 'meta', show: () => text });
/** "7, 30 and 90". */
const listed = (items: readonly string[]) =>
  items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1) as string}`;

/** Every value a sentence can name, by the name it is written under. */
export const INLINE_FIGURES: Record<string, Figure<string>> = {
  asOf: { needs: 'meta', show: (m) => dayOf(m.fetched_through) },
  windowStart: { needs: 'meta', show: (m) => dayOf(m.window_start) },
  periodStart: { needs: 'meta', show: (m) => recentFilters(m).from },
  'prs.active': count((d) => d.coverage.active),
  'prs.openedInPeriod': count((d) => d.coverage.openedInPeriod),
  'prs.openedBeforePeriod': count((d) => d.coverage.active - d.coverage.openedInPeriod),
  'prs.neverReady': count((d) => total(d.neverReady)),
  'commits.firstUnknown': count((d) => total(d.firstCommitUnknown)),
  'commits.none': count((d) => total(d.noCommits)),
  'standing.unknown': count((d) => d.standingUnknown.unknown),
  'standing.unknownBeforeWindow': count((d) => d.standingUnknown.openedBefore),
  'standing.unknownInWindow': count((d) => d.standingUnknown.unknown - d.standingUnknown.openedBefore),
  'kind.unknown': count((d) => total(d.kindUnknown)),
  'kind.unknownShare': { needs: 'data', show: (_m, d) => share(total(d.kindUnknown), d.coverage.active) },
  'disclosure.disclosed': count(disclosed),
  'disclosure.share': { needs: 'data', show: (_m, d) => share(disclosed(d), d.coverage.active) },
  'comments.total': count((d) => d.comments.comments),
  'comments.commands': count((d) => d.comments.commands),
  'comments.commandShare': { needs: 'data', show: (_m, d) => share(d.comments.commands, d.comments.comments) },
  'comments.commandsByAuthor': count((d) => d.comments.commandsByAuthor),
  'comments.botAccount': count((d) => d.comments.botAccount),
  'refs.forcePushes': { needs: 'tables', show: (_m, _d, t) => formatCount(forcePushes(t).events) },
  'refs.forcePushesWithoutCommit': { needs: 'tables', show: (_m, _d, t) => formatCount(forcePushes(t).missing) },
  'refs.merges': { needs: 'tables', show: (_m, _d, t) => formatCount(refsOf(t, 'merged').events) },
  'refs.mergesWithoutCommit': { needs: 'tables', show: (_m, _d, t) => formatCount(refsOf(t, 'merged').missing) },
  'refs.forcePushShareWithoutCommit': {
    needs: 'tables',
    show: (_m, _d, t) => share(forcePushes(t).missing, forcePushes(t).events),
  },
  'const.minPrs': constant(formatCount(MIN_PRS)),
  'const.horizons': constant(listed(HORIZONS.map(formatCount))),
  'const.minFollowed': constant(formatCount(MIN_FOLLOWED)),
  'const.topAuthors': constant(formatCount(TOP_AUTHORS)),
  'const.recentMonths': constant(formatCount(RECENT_MONTHS)),
  'const.laneCap': constant(formatCount(LANE_CAP)),
  'view.prs': count((d) => d.viewSize),
  'view.openedBefore': count((d) => d.viewSize - d.compared),
  'view.notDisclosedInPeriod': {
    needs: 'data',
    show: (_m, d) => (d.viewGroups.notDisclosed.openedInPeriod === null ? '–' : formatShare(d.viewGroups.notDisclosed.openedInPeriod)),
  },
  'view.disclosedInPeriod': {
    needs: 'data',
    show: (_m, d) => (d.viewGroups.disclosed.openedInPeriod === null ? '–' : formatShare(d.viewGroups.disclosed.openedInPeriod)),
  },
  'const.reviewsRecordedFrom': constant(dayOf(REVIEWS_RECORDED_FROM)),
  'people.authors': count((d) => d.people.authors),
  'people.botAuthors': count((d) => d.people.botAuthors),
  'people.reviewers': count((d) => d.people.reviewers),
  'people.authorsTooFew': count((d) => d.people.authorsTooFew),
  'people.largestLines': count((d) => d.people.largestLines),
  'people.largestShare': {
    needs: 'data',
    show: (_m, d) => (d.people.largestShare === null ? '–' : formatShare(d.people.largestShare)),
  },
  'people.deletedNamedPrs': count((d) => d.people.deleted.namedPrs),
  'people.deletedNames': count((d) => d.people.deleted.names),
  'people.deletedPooledPrs': count((d) => d.people.deleted.pooledPrs),
};

export interface TableModel {
  caption: string;
  /** The column heads; the first heads the row labels. */
  head: string[];
  rows: string[][];
}

const SPLIT_HEAD = ['development branch', 'other branches', 'all'];
const splitCells = (s: Split) => [formatCount(s.main), formatCount(s.other), formatCount(total(s))];
/** The period the figures are over, as the captions name it. */
const periodOf = (d: DataFigures) => `the last ${RECENT_MONTHS} months, ${d.period.from} to ${d.period.to}`;
const ofActive = (m: Meta, d: DataFigures, what: string, note?: string) =>
  `${what}, of the ${formatCount(d.coverage.active)} pull requests open at some point in ${periodOf(d)}, as of ${dayOf(m.fetched_through)}${note === undefined ? '' : `. ${note}`}`;

const KIND_SOURCE_LABELS: Record<KindSourceRow, string> = {
  checklist: 'the PR’s checklist',
  tracker: 'a tracker ticket’s type',
  labels: 'a kind label',
  original: 'the PR it backports',
  unknown: 'unknown: no source decided',
};

/** The disclosure forms, strongest first, under meta's names. */
const DISCLOSURE_LABELS: Record<string, string> = {
  trailer: 'a disclosing trailer, such as Assisted-by:',
  coauthor: 'Co-authored-by: naming a tool',
  description: 'disclosure phrasing in the description or a commit message',
  none: NOT_DISCLOSED,
};
const DISCLOSURE_ORDER = ['trailer', 'coauthor', 'description', 'none'];

/** What each event kind is, for the table of what links where. */
export const EVENT_LABELS: Record<string, string> = {
  comment_other: 'a comment by another person',
  comment_author: 'a comment by the PR’s author',
  command_author: 'a bot command by the PR’s author',
  command_other: 'a bot command by another person',
  bot_account: 'a comment by a bot account',
  review_approved: 'an approving review',
  review_changes: 'a review requesting changes',
  review_commented: 'a review that only comments',
  bot_review: 'a review by a bot account',
  review_author: 'a review by the PR’s author',
  ready: 'marked ready for review',
  draft: 'converted to a draft',
  force_push: 'a force-push',
  closed: 'closed',
  reopened: 'reopened',
  merged: 'merged',
};

/** Every table a section can show on a line of its own, by name. */
export const TABLE_FIGURES: Record<string, Figure<TableModel>> = {
  'table.kindSources': {
    needs: 'tables',
    show: (m, d, t) => ({
      caption: ofActive(m, d, 'Where each pull request’s kind came from'),
      head: ['decided by', ...SPLIT_HEAD],
      rows: KIND_SOURCE_ROWS.map((s) => [KIND_SOURCE_LABELS[s], ...splitCells(t.kindSources[s])]),
    }),
  },
  'table.disclosureForms': {
    needs: 'data',
    show: (m, d) => {
      const forms = Object.keys(d.disclosure);
      const ordered = [...DISCLOSURE_ORDER.filter((f) => forms.includes(f)), ...forms.filter((f) => !DISCLOSURE_ORDER.includes(f))];
      return {
        caption: ofActive(m, d, 'Pull requests by the strongest form of disclosure they make'),
        head: ['form', ...SPLIT_HEAD],
        rows: ordered.map((f) => [DISCLOSURE_LABELS[f] ?? f, ...splitCells(d.disclosure[f] as Split)]),
      };
    },
  },
  'table.families': {
    needs: 'data',
    show: (m, d) => ({
      caption: ofActive(m, d, 'Pull requests naming each tool family', 'A pull request naming two families counts under both.'),
      head: ['family', ...SPLIT_HEAD],
      rows: d.families.map((f) => [f.name, ...splitCells(f.count)]),
    }),
  },
  'table.disclosureGroups': {
    needs: 'data',
    show: (m, d) => {
      const { notDisclosed: a, disclosed: b } = d.groups;
      const cells = (f: (g: GroupProfile) => string) => [f(a), f(b)];
      const pct = (v: number | null | undefined) => (v === null || v === undefined ? '–' : formatShare(v));
      const kinds = [...m.kinds.map((k) => ({ id: k.id, name: k.name })), { id: 'unknown', name: 'Unknown' }];
      return {
        caption: `The ${formatCount(d.compared)} pull requests on the development branch opened in ${periodOf(d)}, those the AI-use section compares over those months with every other filter as the report opens, by disclosure, as of ${dayOf(m.fetched_through)}`,
        head: ['', NOT_DISCLOSED, DISCLOSED],
        rows: [
          ['pull requests', ...cells((g) => formatCount(g.prs))],
          ['median lines changed', ...cells((g) => (g.medianLines === null ? '–' : formatCount(g.medianLines)))],
          ['median time since opened, at the last fetch', ...cells((g) => (g.medianAgeDays === null ? '–' : formatDays(g.medianAgeDays)))],
          [`opened by the group's ${formatCount(TOP_AUTHORS)} most active authors`, ...cells((g) => pct(g.topAuthors))],
          ...kinds.map((k) => [`kind: ${k.name.toLowerCase()}`, ...cells((g) => pct(g.kinds?.[k.id]))]),
        ],
      };
    },
  },
  'table.eventRefs': {
    needs: 'tables',
    show: (m, d, t) => ({
      caption: `Events in ${periodOf(d)}, on the ${formatCount(d.coverage.active)} pull requests open at some point in them, and those with no address of their own, as of ${dayOf(m.fetched_through)}`,
      head: ['event', 'events', 'no address'],
      rows: t.eventRefs.map((r) => [
        EVENT_LABELS[r.kind] ?? r.kind,
        formatCount(r.events),
        `${formatCount(r.missing)} (${share(r.missing, r.events)})`,
      ]),
    }),
  },
};

function view<T>(f: Figure<T>, meta: Meta, data: Loadable<DataFigures>, tables: Loadable<TableFigures>): View<T> {
  if (f.needs === 'meta') return { state: 'ready', value: f.show(meta) };
  if (data.state !== 'ready') return { state: data.state };
  if (f.needs === 'data') return { state: 'ready', value: f.show(meta, data.value) };
  if (tables.state !== 'ready') return { state: tables.state };
  return { state: 'ready', value: f.show(meta, data.value, tables.value) };
}

function lookup<T>(figures: Record<string, Figure<T>>, what: string, name: string): Figure<T> {
  const f = figures[name];
  if (!f) throw new Error(`no ${what} figure is named "${name}"`);
  return f;
}

/** A value written into a sentence. Throws for a name no figure has. */
export function inlineView(name: string, meta: Meta, data: Loadable<DataFigures>, tables: Loadable<TableFigures>): View<string> {
  return view(lookup(INLINE_FIGURES, 'inline', name), meta, data, tables);
}

/** A table on a line of its own. Throws for a name no table has. */
export function tableView(
  name: string,
  meta: Meta,
  data: Loadable<DataFigures>,
  tables: Loadable<TableFigures>,
): View<TableModel> {
  return view(lookup(TABLE_FIGURES, 'table', name), meta, data, tables);
}
