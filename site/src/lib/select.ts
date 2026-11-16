// Filters to a selection of rows. The selection is of PRs; an event is in it
// when its PR is.

import type { Dataset, Meta } from './data';
import {
  type Filters,
  SIZE_BANDS,
  STANDING_BANDS,
  UNKNOWN_KIND,
  developmentBases,
  inTarget,
  periodRange,
} from './filters';
import { personIndex } from './handles';
import { type Period, bucketOf, buckets } from './stats/buckets';
import { HUMAN_REVIEWS, kindTable } from './stats/events';

/**
 * The rows the filters select, ascending. The period keeps every PR active in
 * it: opened before its end and not finished before its start, so a PR opened
 * earlier and still worked on counts in the calendar charts. A person the
 * data does not name selects nothing.
 */
export function select(data: Dataset, filters: Filters): Uint32Array {
  const p = data.prs;
  const meta = data.meta;
  const { start, end } = periodRange(filters);
  const author = filters.author === null ? null : personIndex(meta, filters.author);
  const reviewer = filters.reviewer === null ? null : personIndex(meta, filters.reviewer);
  if (author === -1 || reviewer === -1) return new Uint32Array(0);
  const reviewed = reviewer === null ? null : reviewedBy(data, reviewer, start, end);
  const development = developmentBases(meta.bases);
  // A branch meta does not name is -1, which no row has.
  const base = filters.base === null ? -1 : meta.bases.indexOf(filters.base);
  const linked = filters.backportLink === null ? -1 : filters.backportLink === 'linked' ? 1 : 0;
  const component = filters.component === null ? -1 : meta.components.findIndex((c) => c.id === filters.component);
  const kind = kindValue(meta, filters.kind);
  const size = SIZE_BANDS.find((b) => b.id === filters.size);
  const standing = STANDING_BANDS.find((b) => b.id === filters.standing);
  const none = meta.disclosure.indexOf('none');

  const out = new Uint32Array(data.size);
  let n = 0;
  for (let r = 0; r < data.size; r++) {
    if (!((p.created[r] as number) < end)) continue;
    const closed = p.closed[r] as number;
    if (closed >= 0 && closed < start) continue;
    if (filters.target === 'main' && development[p.base[r] as number] !== 1) continue;
    if (filters.target === 'backports' && development[p.base[r] as number] === 1) continue;
    if (filters.base !== null && p.base[r] !== base) continue;
    if (linked !== -1 && p.backport_link[r] !== linked) continue;
    if (filters.component !== null && !(p.components[r] as readonly number[]).includes(component)) continue;
    if (size) {
      const lines = (p.additions[r] as number) + (p.deletions[r] as number);
      if (lines < size.min || lines > size.max) continue;
    }
    if (standing) {
      const s = p.standing[r] as number;
      if (s < standing.min || s > standing.max) continue;
    }
    if (filters.disclosure === 'disclosed' && p.disclosure[r] === none) continue;
    if (filters.disclosure === 'not-disclosed' && p.disclosure[r] !== none) continue;
    if (kind !== null && p.kind[r] !== kind) continue;
    if (filters.excludeDrafts && p.draft[r] === 1) continue;
    if (filters.reopenedOnly && !((p.reopened[r] as number) > 0)) continue;
    if (author !== null && p.author[r] !== author) continue;
    if (reviewed !== null && reviewed[r] !== 1) continue;
    out[n++] = r;
  }
  return out.slice(0, n);
}

/** A choice of the Branch filter: a base branch and how many PRs on it are active in the period. */
export interface BranchChoice {
  base: string;
  count: number;
}

/**
 * The Branch filter's choices: every base branch the target holds, each with
 * its PRs active in the period whatever the other filters, most first and
 * then by name. A branch with none in the period is kept, so the choice
 * never vanishes under a short period.
 */
export function branchChoices(data: Dataset, filters: Pick<Filters, 'from' | 'to' | 'target'>): BranchChoice[] {
  const p = data.prs;
  const { start, end } = periodRange(filters);
  const counts = new Int32Array(data.meta.bases.length);
  for (let r = 0; r < data.size; r++) {
    if (!((p.created[r] as number) < end)) continue;
    const closed = p.closed[r] as number;
    if (closed >= 0 && closed < start) continue;
    const b = p.base[r] as number;
    counts[b] = (counts[b] as number) + 1;
  }
  return data.meta.bases
    .map((base, i) => ({ base, count: counts[i] as number }))
    .filter((c) => inTarget(filters.target, c.base))
    .sort((a, b) => b.count - a.count || (a.base < b.base ? -1 : a.base > b.base ? 1 : 0));
}

/**
 * A flag per row, set for the PRs on which `person`, an index into meta's
 * `people`, commented or reviewed between `start` and `end` without being
 * their author: the events that name an actor, which the author's own never
 * do. Every deleted account's comments and reviews name the pooled `ghost`
 * entry, which can be the author's index without being the author, so the
 * author's is not compared.
 */
function reviewedBy(data: Dataset, person: number, start: number, end: number): Uint8Array {
  const ev = data.events;
  const responses = kindTable(data, { comment_other: 1, ...Object.fromEntries(HUMAN_REVIEWS.map((k) => [k, 1])) });
  const mask = new Uint8Array(data.size);
  for (let e = 0; e < ev.pr.length; e++) {
    if (ev.actor[e] !== person || responses[ev.kind[e] as number] !== 1) continue;
    const t = ev.at[e] as number;
    if (t >= start && t < end) mask[ev.pr[e] as number] = 1;
  }
  return mask;
}

/**
 * The `kind` value the Kind filter keeps: null for every kind, -1 for the
 * unknown ones, and -2, which no row has, for a kind meta does not name.
 */
function kindValue(meta: Meta, id: string | null): number | null {
  if (id === null) return null;
  if (id === UNKNOWN_KIND.id) return -1;
  const i = meta.kinds.findIndex((k) => k.id === id);
  return i === -1 ? -2 : i;
}

/**
 * The rows of a selection opened in the window during the period: those the
 * outcome curves and the charts by week opened are about.
 */
export function openedIn(data: Dataset, rows: Uint32Array, period: Period): Uint32Array {
  const p = data.prs;
  return rows.filter((r) => {
    const created = p.created[r] as number;
    return p.in_window[r] === 1 && created >= period.start && created < period.end;
  });
}

/**
 * The rows of a selection opened in the window during the bucket that starts
 * at `bucket`, a week or a month by the period's step: the PRs behind a bar
 * of the weekly `opened` series. No rows when `bucket` starts none of the
 * period's buckets.
 */
export function openedInBucket(data: Dataset, rows: Uint32Array, period: Period, bucket: number): Uint32Array {
  const b = buckets(period);
  const w = b.starts.indexOf(bucket);
  if (w === -1) return new Uint32Array(0);
  const p = data.prs;
  return rows.filter((r) => p.in_window[r] === 1 && bucketOf(b, p.created[r] as number) === w);
}
