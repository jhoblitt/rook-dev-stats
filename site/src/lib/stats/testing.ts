// Builds small datasets for the statistics specs: each row names only the
// columns a case is about, the rest take a neutral default.

import events2026 from '../__fixtures__/data/events-2026.json';
import rawMeta from '../__fixtures__/data/meta.json';
import prs2026 from '../__fixtures__/data/prs-2026.json';
import { type Dataset, type Meta, type PrColumns, combine, parseMeta, parseYear } from '../data';

export const META: Meta = parseMeta(rawMeta);

/**
 * The shared fixture as one dataset: its one year, 2026, in which every PR
 * finished or is still open. Rows 0–1, #64010 and #65220, were opened in 2025.
 */
export function fixture(): Dataset {
  return combine(META, [parseYear(2026, prs2026, events2026, META)]);
}

/** Epoch seconds of an ISO 8601 time. */
export function at(iso: string): number {
  return Date.parse(iso) / 1000;
}

type Lists = 'families' | 'components';
export type Row = { created: number } & Partial<Record<Exclude<keyof PrColumns, Lists | 'created'>, number>> &
  Partial<Record<Lists, number[]>>;

export interface Event {
  pr: number;
  at: number;
  /** A name from meta's `event_kinds`. */
  kind: string;
  sub?: number;
  actor?: number;
}

/**
 * A dataset of one year. Defaults: ready at `created`, open, on `main`, in
 * the window, not disclosed, by meta's first person, and every optional
 * time `-1`.
 */
export function dataset(rows: readonly Row[], events: readonly Event[] = [], meta: Partial<Meta> = {}): Dataset {
  const m: Meta = { ...META, ...meta };
  const f64 = (get: (r: Row, i: number) => number) => Float64Array.from(rows, get);
  const i32 = (get: (r: Row, i: number) => number) => Int32Array.from(rows, get);
  const u8 = (get: (r: Row, i: number) => number) => Uint8Array.from(rows, get);
  const prs: PrColumns = {
    number: i32((r, i) => r.number ?? 1000 + i),
    created: f64((r) => r.created),
    ready: f64((r) => r.ready ?? r.created),
    closed: f64((r) => r.closed ?? -1),
    state: u8((r) => r.state ?? 0),
    base: i32((r) => r.base ?? 0),
    draft: u8((r) => r.draft ?? 0),
    opened_draft: u8((r) => r.opened_draft ?? 0),
    reopened: i32((r) => r.reopened ?? 0),
    in_window: u8((r) => r.in_window ?? 1),
    additions: i32((r) => r.additions ?? 0),
    deletions: i32((r) => r.deletions ?? 0),
    files: i32((r) => r.files ?? 1),
    commits: i32((r) => r.commits ?? 1),
    first_commit: f64((r) => r.first_commit ?? -1),
    last_commit: f64((r) => r.last_commit ?? -1),
    first_response: f64((r) => r.first_response ?? -1),
    first_approval: f64((r) => r.first_approval ?? -1),
    human_reviews: i32((r) => r.human_reviews ?? 0),
    bot_reviews: i32((r) => r.bot_reviews ?? 0),
    bot_commands: i32((r) => r.bot_commands ?? 0),
    disclosure: u8((r) => r.disclosure ?? 0),
    families: rows.map((r) => r.families ?? []),
    components: rows.map((r) => r.components ?? []),
    standing: i32((r) => r.standing ?? -1),
    kind: i32((r) => r.kind ?? -1),
    author: i32((r) => r.author ?? 0),
    backport_link: u8((r) => r.backport_link ?? 0),
  };
  const sorted = [...events].sort((a, b) => a.pr - b.pr || a.at - b.at);
  const kind = (name: string) => {
    const k = m.event_kinds.indexOf(name);
    if (k === -1) throw new Error(`no event kind ${name}`);
    return k;
  };
  return {
    meta: m,
    size: rows.length,
    prs,
    events: {
      pr: Int32Array.from(sorted, (e) => e.pr),
      at: Float64Array.from(sorted, (e) => e.at),
      kind: Uint8Array.from(sorted, (e) => kind(e.kind)),
      sub: Int32Array.from(sorted, (e) => e.sub ?? -1),
      actor: Int32Array.from(sorted, (e) => e.actor ?? -1),
    },
    years: [{ year: 2026, first: 0, count: rows.length, firstEvent: 0, eventCount: sorted.length }],
    linksUnrecorded: [],
  };
}

/** Every row of a dataset, as a selection. */
export function all(data: Dataset): Uint32Array {
  return Uint32Array.from({ length: data.size }, (_, i) => i);
}

/**
 * A seeded pseudo-random generator (mulberry32) giving numbers in [0, 1), so
 * a failing property case can be replayed from its seed.
 */
export function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
