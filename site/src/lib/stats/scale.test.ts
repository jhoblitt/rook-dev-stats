import { describe, expect, it } from 'vitest';
import { type Dataset, type Meta, type PrColumns, yearsFor } from '../data';
import { dots } from '../dots';
import { DAY, type Filters, dayOf, periodRange } from '../filters';
import { openedIn, select } from '../select';
import { DEFAULT_SORT } from '../sort';
import { defaultFilters, recentFilters } from '../state';
import { sortRows } from '../table';
import { awaitingResponse, backlog } from './backlog';
import type { Period } from './buckets';
import { commandUse } from './commands';
import { outcomeCurve } from './curve';
import { authorRows, reviewerRows } from './people';
import { reviewLoad } from './reviewers';
import { META, all, random } from './testing';
import { weekly } from './weekly';

const ROWS = 100_000;
const EVENTS_PER_ROW = 20;
const START = Date.UTC(2026, 4, 15) / 1000;
const NOW = START + 183 * DAY;
const PERIOD = { start: START, end: NOW };

/** 100,000 PRs and 2,000,000 events spread over six months. */
function synthetic(): Dataset {
  const rnd = random(42);
  const time = (from: number) => from + Math.floor(rnd() * (NOW - from));
  const created = new Float64Array(ROWS);
  const closed = new Float64Array(ROWS);
  const state = new Uint8Array(ROWS);
  const response = new Float64Array(ROWS);
  for (let r = 0; r < ROWS; r++) {
    created[r] = time(START);
    state[r] = Math.floor(rnd() * 3);
    closed[r] = state[r] === 0 ? -1 : time(created[r] as number);
    response[r] = rnd() < 0.7 ? time(created[r] as number) : -1;
  }
  const prs: PrColumns = {
    number: Int32Array.from({ length: ROWS }, (_, i) => i + 1),
    created,
    ready: created,
    closed,
    state,
    base: new Int32Array(ROWS),
    draft: new Uint8Array(ROWS),
    opened_draft: new Uint8Array(ROWS),
    reopened: new Int32Array(ROWS),
    in_window: new Uint8Array(ROWS).fill(1),
    additions: new Int32Array(ROWS).fill(10),
    deletions: new Int32Array(ROWS),
    files: new Int32Array(ROWS).fill(1),
    commits: new Int32Array(ROWS).fill(1),
    first_commit: new Float64Array(ROWS).fill(-1),
    last_commit: new Float64Array(ROWS).fill(-1),
    first_response: response,
    first_approval: new Float64Array(ROWS).fill(-1),
    human_reviews: new Int32Array(ROWS),
    bot_reviews: new Int32Array(ROWS),
    bot_commands: new Int32Array(ROWS),
    disclosure: new Uint8Array(ROWS),
    families: Array.from({ length: ROWS }, () => []),
    components: Array.from({ length: ROWS }, () => []),
    standing: new Int32Array(ROWS),
    kind: new Int32Array(ROWS).fill(-1),
    author: Int32Array.from({ length: ROWS }, (_, i) => i % 500),
    backport_link: new Uint8Array(ROWS),
  };
  const n = ROWS * EVENTS_PER_ROW;
  const pr = new Int32Array(n);
  const at = new Float64Array(n);
  const kind = new Uint8Array(n);
  const actor = new Int32Array(n);
  for (let r = 0, e = 0; r < ROWS; r++) {
    let t = created[r] as number;
    for (let k = 0; k < EVENTS_PER_ROW; k++, e++) {
      t += Math.floor(rnd() * DAY);
      pr[e] = r;
      at[e] = t;
      kind[e] = Math.floor(rnd() * META.event_kinds.length);
      actor[e] = Math.floor(rnd() * 500);
    }
  }
  return {
    meta: { ...META, window_start: START, fetched_through: NOW },
    size: ROWS,
    prs,
    events: { pr, at, kind, sub: new Int32Array(n).fill(-1), actor },
    years: [{ year: 2026, first: 0, count: ROWS, firstEvent: 0, eventCount: n }],
    linksUnrecorded: [],
  };
}

function timed(fn: () => unknown): number {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

describe('at 100,000 PRs and 2,000,000 events', () => {
  const data = synthetic();
  const rows = all(data);

  it('computes an outcome curve well inside a second', () => {
    expect(timed(() => outcomeCurve(data, rows, 'response'))).toBeLessThan(1000);
  });

  it('computes a weekly series over the events well inside a second', () => {
    expect(timed(() => weekly(data, rows, PERIOD, 'reviewers'))).toBeLessThan(1000);
  });

  it('computes the waiting quantiles by week opened well inside a second', () => {
    const series = { kind: 'waitingByWeekOpened', span: 'merge', quantiles: [0.5, 0.9] } as const;
    expect(timed(() => weekly(data, rows, PERIOD, series))).toBeLessThan(1000);
  });

  it('computes the backlog well inside a second', () => {
    expect(timed(() => backlog(data, rows, PERIOD))).toBeLessThan(1000);
  });

  it("computes 500 authors' rows, two outcome curves each, well inside a second", () => {
    expect(timed(() => authorRows(data, rows))).toBeLessThan(1000);
  });

  it("computes 500 reviewers' rows well inside a second", () => {
    expect(timed(() => reviewerRows(data, rows, PERIOD))).toBeLessThan(1000);
  });
});

// The whole history's size: about 75,000 PRs and 1,000,000 events over
// fifteen years, filed by the year each finished in as the rollup files
// them. The bound on each step is the one above, a second, which is what a
// reader waits for a change of filter at most; the last six months' whole
// set of figures together gets the same second. The default view, the whole
// history on the development branch, gets the two seconds that every
// section of the fifteen years at once does.
describe('at the whole history, 75,000 PRs and 1,000,000 events over fifteen years', () => {
  const PRS = 75_000;
  const EVENTS = 1_000_000;
  const NOW = Date.UTC(2026, 10, 15, 6) / 1000;
  const FIRST = Date.UTC(2011, 10, 15) / 1000;
  const YEAR = 365 * DAY;
  const yearOf = (t: number) => new Date(t * 1000).getUTCFullYear();

  /** Every PR, numbered in the order opened, and its events, filed by the year it finished in. */
  function history(): { whole: Dataset; recent: Dataset; meta: Meta } {
    const rnd = random(7);
    const created = new Float64Array(PRS);
    const closed = new Float64Array(PRS);
    const state = new Uint8Array(PRS);
    const response = new Float64Array(PRS);
    const finish = new Int32Array(PRS);
    for (let i = 0; i < PRS; i++) {
      created[i] = FIRST + Math.floor((i / PRS) * (NOW - FIRST));
      // Most finish within weeks, a few take years, and some are never finished.
      const end = (created[i] as number) + Math.floor(rnd() ** 4 * 3 * YEAR);
      const open = end >= NOW || rnd() < 0.01;
      state[i] = open ? 0 : rnd() < 0.7 ? 1 : 2;
      closed[i] = open ? -1 : end;
      response[i] = rnd() < 0.8 ? Math.min(NOW - 1, (created[i] as number) + Math.floor(rnd() * 20 * DAY)) : -1;
      finish[i] = open ? yearOf(NOW) : yearOf(end);
    }
    const order = Int32Array.from({ length: PRS }, (_, i) => i).sort((a, b) => (finish[a] as number) - (finish[b] as number) || a - b);
    const perPr = Math.floor(EVENTS / PRS);
    const extra = EVENTS - perPr * PRS;

    const meta: Meta = {
      ...META,
      window_start: FIRST,
      fetched_through: NOW,
      years: [...new Set(finish)].sort((a, b) => a - b),
    };

    /** The rows given, in order, as one dataset of their years. */
    function build(rows: Int32Array): Dataset {
      const n = rows.length;
      const pick = <T extends Float64Array | Uint8Array | Int32Array>(col: T, make: (n: number) => T): T => {
        const out = make(n);
        for (let k = 0; k < n; k++) out[k] = col[rows[k] as number] as number;
        return out;
      };
      const f64 = (col: Float64Array) => pick(col, (m) => new Float64Array(m));
      const prs: PrColumns = {
        number: Int32Array.from(rows, (i) => i + 1),
        created: f64(created),
        ready: f64(created),
        closed: f64(closed),
        state: pick(state, (m) => new Uint8Array(m)),
        base: Int32Array.from(rows, (i) => (i % 5 === 0 ? 1 : 0)),
        draft: new Uint8Array(n),
        opened_draft: new Uint8Array(n),
        reopened: new Int32Array(n),
        in_window: new Uint8Array(n).fill(1),
        additions: Int32Array.from(rows, (i) => i % 900),
        deletions: Int32Array.from(rows, (i) => i % 70),
        files: new Int32Array(n).fill(1),
        commits: new Int32Array(n).fill(1),
        first_commit: new Float64Array(n).fill(-1),
        last_commit: new Float64Array(n).fill(-1),
        first_response: f64(response),
        first_approval: new Float64Array(n).fill(-1),
        human_reviews: new Int32Array(n),
        bot_reviews: new Int32Array(n),
        bot_commands: Int32Array.from(rows, (i) => i % 3),
        disclosure: Uint8Array.from(rows, (i) => (i % 11 === 0 ? 3 : 0)),
        families: Array.from(rows, (i) => (i % 11 === 0 ? [i % 3] : [])),
        components: Array.from(rows, (i) => [i % 4]),
        standing: Int32Array.from(rows, (i) => i % 120),
        kind: Int32Array.from(rows, (i) => i % 5),
        author: Int32Array.from(rows, (i) => i % 2000),
        backport_link: new Uint8Array(n),
      };
      const count = (i: number) => perPr + (i < extra ? 1 : 0);
      let total = 0;
      for (const i of rows) total += count(i);
      const pr = new Int32Array(total);
      const at = new Float64Array(total);
      const kind = new Uint8Array(total);
      const actor = new Int32Array(total);
      const years: Dataset['years'] = [];
      const ev = random(11);
      let e = 0;
      for (let r = 0; r < n; r++) {
        const i = rows[r] as number;
        const year = finish[i] as number;
        const last = years.at(-1);
        if (last?.year === year) {
          last.count++;
        } else {
          years.push({ year, first: r, count: 1, firstEvent: e, eventCount: 0 });
        }
        const from = created[i] as number;
        const to = (closed[i] as number) < 0 ? NOW : (closed[i] as number);
        let t = from;
        const k = count(i);
        for (let j = 0; j < k; j++, e++) {
          t += Math.floor(ev() * ((to - from) / k));
          pr[e] = r;
          at[e] = t;
          kind[e] = Math.floor(ev() * 9);
          actor[e] = kind[e] === 0 || (kind[e] as number) >= 5 ? Math.floor(ev() * 600) : -1;
        }
        (years.at(-1) as Dataset['years'][number]).eventCount += k;
      }
      return {
        meta,
        size: n,
        prs,
        events: { pr, at, kind, sub: new Int32Array(total).fill(-1), actor },
        years,
        linksUnrecorded: [],
      };
    }

    const start = periodRange(recentFilters(meta)).start;
    const wanted = new Set(yearsFor(meta, start));
    return { whole: build(order), recent: build(order.filter((i) => wanted.has(finish[i] as number))), meta };
  }

  const { whole, recent, meta } = history();
  const lastSix = recentFilters(meta);
  const all15: Filters = { ...lastSix, from: dayOf(FIRST), target: 'all' };

  /** The figures the report computes from a selection, as its sections do. */
  function figures(data: Dataset, filters: Filters) {
    const rows = select(data, filters);
    const period = periodRange(filters);
    const opened = openedIn(data, rows, period);
    const waiting = { kind: 'waitingByWeekOpened', span: 'merge', quantiles: [0.5, 0.9] } as const;
    for (const s of ['opened', 'merged', 'closed', 'reviews', 'reviewers', 'commands'] as const) weekly(data, rows, period, s);
    weekly(data, rows, period, 'disclosureShare');
    weekly(data, opened, period, waiting);
    backlog(data, rows, period);
    awaitingResponse(data, rows, period);
    outcomeCurve(data, opened, 'response');
    outcomeCurve(data, opened, 'merge');
    reviewLoad(data, rows, period, 3);
    commandUse(data, opened);
    dots(data, opened);
    authorRows(data, opened);
    reviewerRows(data, rows, period);
    sortRows(data, rows, DEFAULT_SORT);
    return rows;
  }

  it('is the size it says, and the last six months load their last year alone', () => {
    expect(whole.size).toBe(PRS);
    expect(whole.events.pr.length).toBe(EVENTS);
    expect(meta.years).toHaveLength(16);
    expect(lastSix.from).toBe('2026-05-15');
    expect(recent.years.map((y) => y.year)).toEqual([2026]);
    expect(recent.size).toBeLessThan(PRS / 5);
  });

  it("selects the last six months' PRs and computes all their figures well inside a second", () => {
    expect(select(recent, lastSix).length).toBeGreaterThan(1000);
    expect(timed(() => figures(recent, lastSix))).toBeLessThan(1000);
  });

  it('selects the same PRs whether the earlier years are loaded or not', () => {
    const numbers = (d: Dataset) => [...select(d, lastSix)].map((r) => d.prs.number[r]);
    expect(numbers(recent)).toEqual(numbers(whole));
  });

  it('selects over every loaded PR well inside a second, the reviewer filter included', () => {
    expect(timed(() => select(whole, all15))).toBeLessThan(1000);
    expect(timed(() => select(whole, { ...all15, reviewer: meta.people[4] as string }))).toBeLessThan(1000);
    expect(timed(() => select(whole, { ...lastSix, component: 'rgw', author: meta.people[2] as string }))).toBeLessThan(1000);
  });

  it('buckets fifteen years by month, about 180 of them', () => {
    const rows = select(whole, all15);
    expect(rows.length).toBe(PRS);
    const s = weekly(whole, rows, periodRange(all15), 'merged');
    expect(s.step).toBe('month');
    expect(s.week.length).toBe(181);
  });

  it.each([
    ['a weekly series over the events', (d: Dataset, rows: Uint32Array, p: Period) => weekly(d, rows, p, 'reviewers')],
    ['the waiting quantiles by month opened', (d: Dataset, rows: Uint32Array, p: Period) =>
      weekly(d, rows, p, { kind: 'waitingByWeekOpened', span: 'merge', quantiles: [0.5, 0.9] })],
    ['the backlog', (d: Dataset, rows: Uint32Array, p: Period) => backlog(d, rows, p)],
    ['the outcome curve', (d: Dataset, rows: Uint32Array) => outcomeCurve(d, rows, 'merge')],
    ["2,000 authors' rows", (d: Dataset, rows: Uint32Array) => authorRows(d, rows)],
    ["600 reviewers' rows", (d: Dataset, rows: Uint32Array, p: Period) => reviewerRows(d, rows, p)],
  ])('computes %s over fifteen years by month well inside a second', (_name, fn) => {
    const rows = select(whole, all15);
    expect(timed(() => fn(whole, rows, periodRange(all15)))).toBeLessThan(1000);
  });

  // Every section at once, as the first render after moving the start back
  // computes them: under two seconds, a test runner's timeout being five.
  it('computes all the figures of the fifteen years in under two seconds', () => {
    expect(timed(() => figures(whole, all15))).toBeLessThan(2000);
  });

  it("computes the last six months' figures well inside a second even with every earlier year loaded", () => {
    expect(timed(() => figures(whole, lastSix))).toBeLessThan(1000);
  });

  it("computes the default view's figures, the whole history on the development branch, in under two seconds", () => {
    const defaults = defaultFilters(meta);
    expect(defaults.from).toBe(dayOf(FIRST));
    expect(timed(() => figures(whole, defaults))).toBeLessThan(2000);
  });
});
