// The reader's filters and selection, kept in the URL hash so any view can be
// linked:
//
//   #/<route>?target=backports&base=reef&backport=unlinked&from=2026-06-01&to=2026-08-31
//     &component=rgw&kind=bugfix
//     &size=11-100&standing=first&disclosure=disclosed&drafts=exclude&reopened=only
//     &author=<login>&reviewer=<login>&week=2026-06-01&band=lt7&pr=66600&sort=-size
//     &authorsort=-lines&reviewersort=first&bots=show
//   #/?target=main&section=review
//   #/methods?target=main&section=disclosure
//
// <route> is empty for the report or `methods`. The target is always written;
// the period only when it differs from the default, the whole window, so a
// link to the default view keeps following the data as it grows. Parsing
// never throws: what is unknown, malformed or outside the data falls back to
// its default.

import { type Readable, writable } from 'svelte/store';
import type { Meta } from './data';
import {
  AGE_BANDS,
  type AgeBand,
  BACKPORT_LINKS,
  DISCLOSURES,
  type Filters,
  SIZE_BANDS,
  STANDING_BANDS,
  TARGETS,
  UNKNOWN_KIND,
  dayOf,
  dayStart,
  findChoice,
  inTarget,
  isMonday,
  periodRange,
} from './filters';
import { findLogin } from './handles';
import { isMethodsAnchor } from './methods/anchors';
import { reportSection } from './report-sections';
import { bucketEnd, bucketStart, stepFor } from './stats/buckets';
import {
  AUTHOR_COLUMNS,
  type AuthorColumn,
  DEFAULT_AUTHOR_SORT,
  DEFAULT_REVIEWER_SORT,
  DEFAULT_SORT,
  REVIEWER_COLUMNS,
  type ReviewerColumn,
  type Sort,
  parseSort,
  parseSortOf,
  sameSort,
  sortParam,
} from './sort';

export const ROUTES = ['report', 'methods'] as const;
export type Route = (typeof ROUTES)[number];

export interface AppState {
  route: Route;
  filters: Filters;
  /**
   * The first day of the selected bucket, `YYYY-MM-DD`: a Monday, or the
   * first of a month when the period steps by month. It overlaps the period.
   */
  week: string | null;
  /** The selected age band, alone or within the selected week. */
  band: AgeBand | null;
  /** The number of the PR whose timeline is open. */
  pr: number | null;
  /** The PR table's order. */
  sort: Sort;
  /** The Authors table's order. */
  authorSort: Sort<AuthorColumn>;
  /** The Reviewers table's order. */
  reviewerSort: Sort<ReviewerColumn>;
  /** Whether the People tables list bot accounts. */
  bots: boolean;
  /** The section of the page to show: a report section's name, or a methods section's or subheading's id. */
  section: string | null;
}

const KEYS = [
  'target',
  'base',
  'backport',
  'from',
  'to',
  'component',
  'kind',
  'size',
  'standing',
  'disclosure',
  'drafts',
  'reopened',
  'author',
  'reviewer',
  'week',
  'band',
  'pr',
  'sort',
  'authorsort',
  'reviewersort',
  'bots',
  'section',
] as const;
type Key = (typeof KEYS)[number];

/** The hash's fields as written, before validation against the data. */
export interface RawState {
  route: string;
  /** The first value of each known parameter. */
  params: Partial<Record<Key, string>>;
}

export function parseHash(hash: string): RawState {
  const body = hash.startsWith('#') ? hash.slice(1) : hash;
  const q = body.indexOf('?');
  const route = (q === -1 ? body : body.slice(0, q)).replace(/^\/+|\/+$/g, '');
  const search = new URLSearchParams(q === -1 ? '' : body.slice(q + 1));
  const params: RawState['params'] = {};
  for (const key of KEYS) {
    const value = search.get(key);
    if (value !== null) params[key] = value;
  }
  return { route, params };
}

/** How many calendar months the recent period, `recentFilters`, reaches back from the last fetched day. */
export const RECENT_MONTHS = 6;

/**
 * The `YYYY-MM-DD` day `months` calendar months before `day`; when that
 * month is too short for the day, its last day.
 */
export function monthsBefore(day: string, months: number): string {
  const start = dayStart(day);
  if (start === null) throw new Error(`not a day: ${day}`);
  const d = new Date(start * 1000);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() - months;
  const length = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return dayOf(Date.UTC(year, month, Math.min(d.getUTCDate(), length)) / 1000);
}

/** The first and last days a period may name: from the window's start to the last fetch. */
export function dataDays(meta: Meta): { first: string; last: string } {
  return { first: dayOf(meta.window_start), last: dayOf(meta.fetched_through) };
}

/** What the report opens on: the whole window, on the development branch, with no other filter. */
export function defaultFilters(meta: Meta): Filters {
  const { first, last } = dataDays(meta);
  return {
    from: first,
    to: last,
    target: 'main',
    base: null,
    backportLink: null,
    component: null,
    size: null,
    standing: null,
    disclosure: null,
    kind: null,
    excludeDrafts: false,
    reopenedOnly: false,
    author: null,
    reviewer: null,
  };
}

/**
 * The default filters over the last six calendar months of the data, ending
 * on the last fetched day, or over the whole window when it is shorter: the
 * filter bar's "Last 6 months", and the period of the methods page's figures.
 */
export function recentFilters(meta: Meta): Filters {
  const d = defaultFilters(meta);
  const back = monthsBefore(d.to, RECENT_MONTHS);
  return { ...d, from: back > d.from ? back : d.from };
}

export function defaultState(meta: Meta): AppState {
  return {
    route: 'report',
    filters: defaultFilters(meta),
    week: null,
    band: null,
    pr: null,
    sort: DEFAULT_SORT,
    authorSort: DEFAULT_AUTHOR_SORT,
    reviewerSort: DEFAULT_REVIEWER_SORT,
    bots: false,
    section: null,
  };
}

function isRoute(s: string): s is Route {
  return (ROUTES as readonly string[]).includes(s);
}

/**
 * Each end of the period that is a real day inside the data, from the
 * window's start to the last fetch, is kept, the other falls back to its
 * default; a period that ends before it starts is the default. An address
 * naming an end and no start was written when the report opened on the last
 * six months, and `hashFromState` writes no such address now, so its start
 * is still the recent period's: such a link keeps the period it had.
 */
function validPeriod(
  from: string | undefined,
  to: string | undefined,
  meta: Meta,
): Pick<Filters, 'from' | 'to'> {
  const days = dataDays(meta);
  const first = dayStart(days.first) as number;
  const last = dayStart(days.last) as number;
  const inData = (day: string | undefined): string | null => {
    if (day === undefined) return null;
    const start = dayStart(day);
    return start !== null && start >= first && start <= last ? day : null;
  };
  const [start, end] = [inData(from), inData(to)];
  const d = start === null && end !== null ? recentFilters(meta) : defaultFilters(meta);
  const period = { from: start ?? d.from, to: end ?? d.to };
  return period.from <= period.to ? period : { from: d.from, to: d.to };
}

/** A bucket of the period's step, a week or a month, that overlaps the period. */
function validWeek(week: string | undefined, filters: Filters): string | null {
  if (week === undefined) return null;
  const first = dayStart(week);
  if (first === null) return null;
  const period = periodRange(filters);
  const step = stepFor(period);
  const isStart = step === 'week' ? isMonday(week) : bucketStart(first, step) === first;
  return isStart && first < period.end && bucketEnd(first, step) > period.start ? week : null;
}

const PR_NUMBER = /^[1-9]\d{0,8}$/;

/** Whether `section` names a section of the page at `route`; each page has its own. */
function isSectionOf(route: Route, section: string): boolean {
  return route === 'methods' ? isMethodsAnchor(section) : reportSection(section) !== undefined;
}

export function validateState(raw: RawState, meta: Meta): AppState {
  const d = defaultFilters(meta);
  const p = raw.params;
  const component = p.component;
  const kind = p.kind;
  const base = p.base;
  const target = findChoice(TARGETS, p.target) ?? d.target;
  const filters: Filters = {
    ...validPeriod(p.from, p.to, meta),
    target,
    // A branch the target does not hold, as after the target changed, is none.
    base: base !== undefined && meta.bases.includes(base) && inTarget(target, base) ? base : null,
    backportLink: findChoice(BACKPORT_LINKS, p.backport),
    component: component !== undefined && meta.components.some((c) => c.id === component) ? component : null,
    size: findChoice(SIZE_BANDS, p.size),
    standing: findChoice(STANDING_BANDS, p.standing),
    disclosure: findChoice(DISCLOSURES, p.disclosure),
    kind: kind === UNKNOWN_KIND.id || (kind !== undefined && meta.kinds.some((k) => k.id === kind)) ? kind : null,
    excludeDrafts: p.drafts === 'exclude',
    reopenedOnly: p.reopened === 'only',
    author: p.author === undefined ? null : findLogin(meta, p.author),
    reviewer: p.reviewer === undefined ? null : findLogin(meta, p.reviewer),
  };
  const route = isRoute(raw.route) ? raw.route : 'report';
  return {
    route,
    filters,
    week: validWeek(p.week, filters),
    band: findChoice(AGE_BANDS, p.band),
    pr: p.pr !== undefined && PR_NUMBER.test(p.pr) ? Number(p.pr) : null,
    sort: parseSort(p.sort),
    authorSort: parseSortOf(AUTHOR_COLUMNS, p.authorsort, DEFAULT_AUTHOR_SORT),
    reviewerSort: parseSortOf(REVIEWER_COLUMNS, p.reviewersort, DEFAULT_REVIEWER_SORT),
    bots: p.bots === 'show',
    section: p.section !== undefined && isSectionOf(route, p.section) ? p.section : null,
  };
}

export function stateFromHash(hash: string, meta: Meta): AppState {
  return validateState(parseHash(hash), meta);
}

/** The canonical hash for a state. */
export function hashFromState(state: AppState, meta: Meta): string {
  const enc = encodeURIComponent;
  const d = defaultFilters(meta);
  const f = state.filters;
  const parts = [`target=${enc(f.target)}`];
  if (f.base !== null) parts.push(`base=${enc(f.base)}`);
  if (f.backportLink !== null) parts.push(`backport=${enc(f.backportLink)}`);
  // An end written alone is read as the end of the recent period, so a
  // period with any end of its own names its start too.
  if (f.from !== d.from || f.to !== d.to) parts.push(`from=${enc(f.from)}`);
  if (f.to !== d.to) parts.push(`to=${enc(f.to)}`);
  if (f.component !== null) parts.push(`component=${enc(f.component)}`);
  if (f.kind !== null) parts.push(`kind=${enc(f.kind)}`);
  if (f.size !== null) parts.push(`size=${enc(f.size)}`);
  if (f.standing !== null) parts.push(`standing=${enc(f.standing)}`);
  if (f.disclosure !== null) parts.push(`disclosure=${enc(f.disclosure)}`);
  if (f.excludeDrafts) parts.push('drafts=exclude');
  if (f.reopenedOnly) parts.push('reopened=only');
  if (f.author !== null) parts.push(`author=${enc(f.author)}`);
  if (f.reviewer !== null) parts.push(`reviewer=${enc(f.reviewer)}`);
  if (state.week !== null) parts.push(`week=${enc(state.week)}`);
  if (state.band !== null) parts.push(`band=${enc(state.band)}`);
  if (state.pr !== null) parts.push(`pr=${state.pr}`);
  if (!sameSort(state.sort, DEFAULT_SORT)) parts.push(`sort=${enc(sortParam(state.sort))}`);
  if (!sameSort(state.authorSort, DEFAULT_AUTHOR_SORT)) parts.push(`authorsort=${enc(sortParam(state.authorSort))}`);
  if (!sameSort(state.reviewerSort, DEFAULT_REVIEWER_SORT)) {
    parts.push(`reviewersort=${enc(sortParam(state.reviewerSort))}`);
  }
  if (state.bots) parts.push('bots=show');
  if (state.section !== null && isSectionOf(state.route, state.section)) parts.push(`section=${enc(state.section)}`);
  return `#/${state.route === 'report' ? '' : state.route}?${parts.join('&')}`;
}

/** The hash of a page, keeping the reader's filters and selection but not the section. */
export function routeHash(state: AppState, route: Route, meta: Meta): string {
  return hashFromState({ ...state, route, section: null }, meta);
}

/** The address of a section or subheading of the methods page, keeping the reader's filters and selection. */
export function sectionHash(state: AppState, section: string, meta: Meta): string {
  return hashFromState({ ...state, route: 'methods', section }, meta);
}

/** The address of a section of the report, by its name, keeping the reader's filters and selection. */
export function reportSectionHash(state: AppState, name: string, meta: Meta): string {
  return hashFromState({ ...state, route: 'report', section: name }, meta);
}

/** Where the store reads and writes the hash; a fake in tests. */
export interface HashLocation {
  read(): string;
  /** Write the hash as a new history entry. */
  push(hash: string): void;
  /** Write the hash over the current history entry. */
  replace(hash: string): void;
  /** Call `onChange` when the hash changes by navigation; returns a stop function. */
  listen(onChange: () => void): () => void;
}

export function windowHashLocation(win: Window): HashLocation {
  return {
    read: () => win.location.hash,
    push: (hash) => win.history.pushState(null, '', hash),
    replace: (hash) => win.history.replaceState(null, '', hash),
    listen: (onChange) => {
      // Back and forward over pushState entries fire popstate; a typed or
      // clicked hash fires hashchange. The store ignores the duplicate.
      win.addEventListener('hashchange', onChange);
      win.addEventListener('popstate', onChange);
      return () => {
        win.removeEventListener('hashchange', onChange);
        win.removeEventListener('popstate', onChange);
      };
    },
  };
}

export interface WriteOptions {
  /** Overwrite the current history entry instead of adding one. */
  replace?: boolean;
}

export interface StateStore extends Readable<AppState> {
  set(next: AppState, opts?: WriteOptions): void;
  update(fn: (current: AppState) => AppState, opts?: WriteOptions): void;
  /** Stop following navigation. */
  destroy(): void;
}

/**
 * A store of the validated state, synchronised with the hash both ways. It
 * notifies only when the canonical hash changes.
 */
export function createStateStore(meta: Meta, loc: HashLocation): StateStore {
  const fromHash = (hash: string) => stateFromHash(hash, meta);
  const toHash = (state: AppState) => hashFromState(state, meta);
  let current = fromHash(loc.read());
  let currentHash = toHash(current);
  if (loc.read() !== currentHash) loc.replace(currentHash);
  const inner = writable(current);

  const accept = (next: AppState, hash: string) => {
    current = next;
    currentHash = hash;
    inner.set(next);
  };

  const write = (next: AppState, opts?: WriteOptions) => {
    const valid = fromHash(toHash(next));
    const hash = toHash(valid);
    if (hash === currentHash) return;
    if (opts?.replace) loc.replace(hash);
    else loc.push(hash);
    accept(valid, hash);
  };

  const stop = loc.listen(() => {
    const read = loc.read();
    const next = fromHash(read);
    const hash = toHash(next);
    if (read !== hash) loc.replace(hash);
    if (hash !== currentHash) accept(next, hash);
  });

  return {
    subscribe: inner.subscribe,
    set: write,
    update: (fn, opts) => write(fn(current), opts),
    destroy: stop,
  };
}
