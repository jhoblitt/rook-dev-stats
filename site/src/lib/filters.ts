// The filter bar's vocabulary: each filter's values, their labels, and the
// bounds of the bands. The ids are what the URL hash carries, so renaming
// one breaks the links already shared.

export interface Choice<Id extends string> {
  id: Id;
  label: string;
}

/** A band over a whole-number column: `min` through `max`, both inclusive. */
export interface Band<Id extends string> extends Choice<Id> {
  min: number;
  max: number;
}

export const TARGETS = [
  { id: 'master', label: 'master' },
  { id: 'backports', label: 'backports and other branches' },
  { id: 'all', label: 'all' },
] as const satisfies readonly Choice<string>[];
export type Target = (typeof TARGETS)[number]['id'];

/** The names of rook/rook's development branch. */
const DEVELOPMENT_BRANCHES: readonly string[] = ['master'];

/**
 * Whether a base branch is the development branch: what the `master` target
 * keeps and every place that tells the development branch from the other
 * branches asks. A release or feature branch is not.
 */
export function isDevelopmentBranch(base: string): boolean {
  return DEVELOPMENT_BRANCHES.includes(base);
}

/** A flag per name in meta's `bases`, set for the development branch's, for a loop over the `base` column. */
export function developmentBases(bases: readonly string[]): Uint8Array {
  return Uint8Array.from(bases, (b) => (isDevelopmentBranch(b) ? 1 : 0));
}

/** Whether a target keeps the PRs on a base branch: the Branch filter's choices under it. */
export function inTarget(target: Target, base: string): boolean {
  return target === 'all' || (target === 'master') === isDevelopmentBranch(base);
}

/**
 * By the `backport_link` column: whether the PR names the one it backports,
 * by Mergify's sentence, a "backport of" line or a title suffix. Old
 * backports seldom do, so no link does not mean no backport.
 */
export const BACKPORT_LINKS = [
  { id: 'linked', label: 'links its original' },
  { id: 'unlinked', label: 'no link' },
] as const satisfies readonly Choice<string>[];
export type BackportLink = (typeof BACKPORT_LINKS)[number]['id'];

/** By lines added plus lines deleted. */
export const SIZE_BANDS = [
  { id: 'le10', label: 'up to 10', min: 0, max: 10 },
  { id: '11-100', label: '11–100', min: 11, max: 100 },
  { id: '101-1000', label: '101–1,000', min: 101, max: 1000 },
  { id: 'gt1000', label: 'over 1,000', min: 1001, max: Infinity },
] as const satisfies readonly Band<string>[];
export type SizeBand = (typeof SIZE_BANDS)[number]['id'];

/** By the `standing` column, the author's PRs before this one; `-1` is unknown. */
export const STANDING_BANDS = [
  { id: 'first', label: '0 (first PR)', min: 0, max: 0 },
  { id: '1-9', label: '1–9', min: 1, max: 9 },
  { id: '10-99', label: '10–99', min: 10, max: 99 },
  { id: 'ge100', label: '100 or more', min: 100, max: Infinity },
  { id: 'unknown', label: 'unknown', min: -1, max: -1 },
] as const satisfies readonly Band<string>[];
export type StandingBand = (typeof STANDING_BANDS)[number]['id'];

/** The names of the two disclosure groups, which say what was disclosed, wherever a label names a group. */
export const DISCLOSED = 'AI use disclosed';
export const NOT_DISCLOSED = 'AI use not disclosed';

/** Disclosed is any `disclosure` other than meta's `none`. */
export const DISCLOSURES = [
  { id: 'disclosed', label: DISCLOSED },
  { id: 'not-disclosed', label: NOT_DISCLOSED },
] as const satisfies readonly Choice<string>[];
export type Disclosure = (typeof DISCLOSURES)[number]['id'];

/** The Kind filter's choice for the PRs whose kind is unknown (`kind` -1); the others are meta's `kinds`. */
export const UNKNOWN_KIND = { id: 'unknown', label: 'unknown' } as const satisfies Choice<string>;

/**
 * The open backlog's age bands: the bands a chart selection can name beside
 * its week. Their bounds belong to the backlog statistic.
 */
export const AGE_BANDS = [
  { id: 'lt7', label: 'under 7 days' },
  { id: '7-30', label: '7–30 days' },
  { id: '30-90', label: '30–90 days' },
  { id: 'gt90', label: 'over 90 days' },
] as const satisfies readonly Choice<string>[];
export type AgeBand = (typeof AGE_BANDS)[number]['id'];

export interface Filters {
  /** The period's first day, `YYYY-MM-DD` in UTC. */
  from: string;
  /** The period's last day, inclusive. */
  to: string;
  target: Target;
  /** A name from meta's `bases` that the target holds, or null for any branch. */
  base: string | null;
  backportLink: BackportLink | null;
  /** A component id from meta, or null for every component. */
  component: string | null;
  size: SizeBand | null;
  standing: StandingBand | null;
  disclosure: Disclosure | null;
  /** A kind id from meta, `UNKNOWN_KIND.id`, or null for every kind. */
  kind: string | null;
  /** Leave out the PRs that are a draft now. */
  excludeDrafts: boolean;
  /** Keep only the PRs reopened at least once. */
  reopenedOnly: boolean;
  /**
   * Keep only the PRs this person opened; an entry of meta's `people`, a
   * login or a deleted account's `ghost:` and name, or null for anyone.
   */
  author: string | null;
  /**
   * Keep only the PRs this login reviewed or commented on during the period,
   * not being their author; a login from meta's `people`, or null for anyone.
   */
  reviewer: string | null;
}

export function findChoice<Id extends string>(choices: readonly Choice<Id>[], id: string | undefined): Id | null {
  return choices.find((c) => c.id === id)?.id ?? null;
}

export const DAY = 86_400;
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The UTC day of an epoch second, as `YYYY-MM-DD`. */
export function dayOf(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

/** 00:00 UTC on a `YYYY-MM-DD` day in epoch seconds, or null when it is not a real day. */
export function dayStart(day: string): number | null {
  const m = ISO_DAY.exec(day);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return dayOf(ms / 1000) === day ? ms / 1000 : null;
}

/** The period as epoch seconds, `start` inclusive and `end` exclusive. */
export function periodRange(filters: Pick<Filters, 'from' | 'to'>): { start: number; end: number } {
  const start = dayStart(filters.from);
  const last = dayStart(filters.to);
  if (start === null || last === null) throw new Error(`not a period: ${filters.from} to ${filters.to}`);
  return { start, end: last + DAY };
}

/** Whether a `YYYY-MM-DD` day is a Monday, the first day of an ISO week. */
export function isMonday(day: string): boolean {
  const start = dayStart(day);
  return start !== null && new Date(start * 1000).getUTCDay() === 1;
}
