import type { Fetch } from '../data';
import events2026 from './data/events-2026.json';
import index from './data/index.json';
import meta from './data/meta.json';
import prs2026 from './data/prs-2026.json';
import table2026 from './data/table-2026.json';

export const FIXTURE = {
  'meta.json': meta,
  'index.json': index,
  'prs-2026.json': prs2026,
  'events-2026.json': events2026,
  'table-2026.json': table2026,
};

export const BASE = '/rook-dev-stats/data/';

/**
 * A fetch serving the fixture under BASE, with files replaced (a string is
 * served as is) or removed (undefined, a 404), recording each URL asked for.
 */
export function fixtureFetch(overrides: Record<string, unknown> = {}): { fetch: Fetch; requested: string[] } {
  const files: Record<string, unknown> = { ...FIXTURE, ...overrides };
  const requested: string[] = [];
  const fetch: Fetch = (url) => {
    requested.push(url);
    const body = url.startsWith(BASE) ? files[url.slice(BASE.length)] : undefined;
    if (body === undefined) return Promise.resolve(new Response('not found', { status: 404, statusText: 'Not Found' }));
    return Promise.resolve(new Response(typeof body === 'string' ? body : JSON.stringify(body)));
  };
  return { fetch, requested };
}

/**
 * A fetch of the fixture with `files` replaced, as `fixtureFetch`, holding
 * back each year's files until `release` is called for that year; meta.json
 * and index.json pass at once.
 */
export function heldByYear(files: Record<string, unknown> = {}) {
  const { fetch } = fixtureFetch(files);
  /** Every URL asked for, when it is asked for. */
  const requested: string[] = [];
  const waiting = new Map<number, (() => void)[]>();
  const held: Fetch = (url) => {
    requested.push(url);
    const year = /-(\d{4})\.json$/.exec(url)?.[1];
    if (year === undefined) return fetch(url);
    return new Promise((resolve) => {
      const list = waiting.get(Number(year)) ?? [];
      list.push(() => resolve(fetch(url)));
      waiting.set(Number(year), list);
    });
  };
  const release = (year: number) => (waiting.get(year) ?? []).splice(0).forEach((go) => go());
  return { fetch: held, requested, release, releaseAll: () => [...waiting.keys()].forEach(release) };
}

/** The number of the PR the earlier year holds. */
export const EARLIER_PR = 60010;

const YEAR = 365 * 86_400;
const PR_TIMES = ['created', 'ready', 'closed', 'first_commit', 'last_commit', 'first_response', 'first_approval'] as const;
const back = (t: number) => (t < 0 ? t : t - YEAR);

/**
 * The fixture with a year before it, for the specs about loading part of the
 * data: its window starts on 2025-01-01, and 2025's files hold #60010 alone,
 * a copy of #64010 (row 0 of 2026, merged 2026-06-10) with every time a
 * year earlier, so merged on 2025-06-10. Every PR of the fixture finished in
 * 2026 or is open, so the fixture alone has one year.
 */
export function withEarlierYear(): Record<string, unknown> {
  const events = events2026.pr.flatMap((row, e) => (row === 0 ? [e] : []));
  const prs = Object.fromEntries(
    Object.entries(prs2026).map(([column, values]) => {
      const first = values[0] as unknown;
      if (column === 'number') return [column, [EARLIER_PR]];
      if ((PR_TIMES as readonly string[]).includes(column)) return [column, [back(first as number)]];
      return [column, [first]];
    }),
  );
  const pick = <T>(column: readonly T[]) => events.map((e) => column[e] as T);
  const commits = (table2026.commits[0] ?? []).map(([sha, authored, committed]) => [
    sha,
    back(authored as number),
    back(committed as number),
  ]);
  return {
    'meta.json': { ...meta, window_start: Date.UTC(2025, 0, 1) / 1000, years: [2025, 2026] },
    'index.json': { numbers: [EARLIER_PR, ...index.numbers], years: [2025, ...index.years] },
    'prs-2025.json': prs,
    'events-2025.json': {
      pr: pick(events2026.pr),
      at: pick(events2026.at).map(back),
      kind: pick(events2026.kind),
      sub: pick(events2026.sub),
      actor: pick(events2026.actor),
    },
    'table-2025.json': {
      titles: [table2026.titles[0]],
      authors: [table2026.authors[0]],
      commits: [commits],
      refs: pick(table2026.refs),
      issues: [table2026.issues[0]],
      backport_of: [table2026.backport_of[0]],
      kind_source: [table2026.kind_source[0]],
    },
  };
}

/**
 * The fixture with a run of years before it, from `first` to 2025, for the
 * specs about which title files the PR table fetches: each holds `perYear`
 * copies of #64010 (row 0 of 2026, opened 2025-11-03 and merged 2026-06-10)
 * with every time moved back by whole years into the year it is in, so a
 * later year's copies were opened later. A year's copies are numbered from
 * 10000 + 1000 × (year − first), and their titles name it: "copy 3 of
 * 2024". The window starts on `first`-01-01.
 */
export function withYears(first: number, perYear: number): Record<string, unknown> {
  const shift = (t: number, k: number) => {
    if (t < 0) return t;
    const d = new Date(t * 1000);
    d.setUTCFullYear(d.getUTCFullYear() - k);
    return d.getTime() / 1000;
  };
  const events = events2026.pr.flatMap((row, e) => (row === 0 ? [e] : []));
  const files: Record<string, unknown> = {};
  const numbers: number[] = [];
  const years: number[] = [];
  for (let year = first; year < 2026; year++) {
    const k = 2026 - year;
    const copies = Array.from({ length: perYear }, (_, j) => j);
    const nums = copies.map((j) => 10000 + 1000 * (year - first) + j);
    numbers.push(...nums);
    years.push(...nums.map(() => year));
    files[`prs-${year}.json`] = Object.fromEntries(
      Object.entries(prs2026).map(([column, values]) => {
        const v = values[0] as unknown;
        if (column === 'number') return [column, nums];
        if ((PR_TIMES as readonly string[]).includes(column)) return [column, copies.map(() => shift(v as number, k))];
        return [column, copies.map(() => v)];
      }),
    );
    const each = <T>(column: readonly T[], f: (v: T) => T = (v) => v) =>
      copies.flatMap(() => events.map((e) => f(column[e] as T)));
    files[`events-${year}.json`] = {
      pr: copies.flatMap((j) => events.map(() => j)),
      at: each(events2026.at, (t) => shift(t, k)),
      kind: each(events2026.kind),
      sub: each(events2026.sub),
      actor: each(events2026.actor),
    };
    const commits = (table2026.commits[0] ?? []).map(([sha, authored, committed]) => [
      sha,
      shift(authored as number, k),
      shift(committed as number, k),
    ]);
    files[`table-${year}.json`] = {
      titles: copies.map((j) => `copy ${j} of ${year}`),
      authors: copies.map(() => table2026.authors[0]),
      commits: copies.map(() => commits),
      refs: each(table2026.refs),
      issues: copies.map(() => table2026.issues[0]),
      backport_of: copies.map(() => table2026.backport_of[0]),
      kind_source: copies.map(() => table2026.kind_source[0]),
    };
  }
  const all = Array.from({ length: 2026 - first + 1 }, (_, i) => first + i);
  return {
    ...files,
    'meta.json': { ...meta, window_start: Date.UTC(first, 0, 1) / 1000, years: all },
    'index.json': { numbers: [...numbers, ...index.numbers], years: [...years, ...index.years] },
  };
}
