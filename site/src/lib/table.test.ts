import { describe, expect, it } from 'vitest';
import { FIXTURE, withEarlierYear } from './__fixtures__/fetch';
import { combine, parseMeta, parseYear } from './data';
import { AGE_BANDS, dayStart, periodRange } from './filters';
import { openedInBucket, select } from './select';
import { defaultState } from './state';
import { backlogMoment, backlogRows } from './stats/backlog';
import { META, at, dataset, fixture } from './stats/testing';
import {
  TABLE_COLUMNS,
  cellText,
  countText,
  kindDecided,
  narrowRows,
  narrowing,
  prUrl,
  sortRows,
  sortWords,
  tableOrder,
  tableRows,
  ticketUrl,
  windowRows,
  yearsOfRows,
} from './table';

const data = fixture();
const state = defaultState(META);
const numbers = (rows: Uint32Array) => [...rows].map((r) => data.prs.number[r]);

describe('sortRows', () => {
  const t = at('2026-06-01T00:00:00Z');
  const small = dataset([
    { number: 10, created: t + 2, additions: 5 },
    { number: 11, created: t + 1, additions: 50 },
    { number: 12, created: t + 3, additions: 5, kind: -1 },
    { number: 13, created: t, additions: 7, kind: 1 },
  ]);
  const rows = Uint32Array.of(0, 1, 2, 3);
  const nums = (r: Uint32Array) => [...r].map((x) => small.prs.number[x]);

  it('orders by a column either way, keeping ties in the order given', () => {
    expect(nums(sortRows(small, rows, { column: 'opened', descending: true }))).toEqual([12, 10, 11, 13]);
    expect(nums(sortRows(small, rows, { column: 'size', descending: false }))).toEqual([10, 12, 13, 11]);
    expect(nums(sortRows(small, rows, { column: 'size', descending: true }))).toEqual([11, 13, 10, 12]);
  });

  it('puts a missing value last in both directions', () => {
    // Kind -1 is unknown on 12; the rest default to unknown too, but 13 is a feature.
    const kinds = dataset([
      { number: 1, created: t, kind: -1 },
      { number: 2, created: t, kind: 1 },
      { number: 3, created: t, kind: 0 },
    ]);
    const r = Uint32Array.of(0, 1, 2);
    const n = (x: Uint32Array) => [...x].map((i) => kinds.prs.number[i]);
    expect(n(sortRows(kinds, r, { column: 'kind', descending: false }))).toEqual([3, 2, 1]);
    expect(n(sortRows(kinds, r, { column: 'kind', descending: true }))).toEqual([2, 3, 1]);
  });

  it('sorts by the table file’s text once it is there, and leaves rows without it last', () => {
    // Titles b, C, (not loaded), a: compared without regard to case.
    const text = { title: (r: number) => (r === 2 ? null : (['b', 'C', '', 'a'][r] ?? null)) };
    expect(nums(sortRows(small, rows, { column: 'title', descending: false }, text))).toEqual([13, 10, 11, 12]);
    expect(nums(sortRows(small, rows, { column: 'title', descending: true }))).toEqual([10, 11, 12, 13]);
  });

  it("sorts by the author's login from the data, before any table file is there", () => {
    // Authors a, c, d, e, f, g, a, i, d of the default selection.
    const selected = select(data, state.filters);
    expect(numbers(sortRows(data, selected, { column: 'author', descending: false }))).toEqual([
      64010, 66900, 66100, 66500, 67100, 66510, 66600, 66700, 67000,
    ]);
    expect(numbers(sortRows(data, selected, { column: 'author', descending: true }))).toEqual([
      67000, 66700, 66600, 66510, 66500, 67100, 66100, 64010, 66900,
    ]);
  });

  it('returns new rows and leaves the input alone', () => {
    const input = Uint32Array.of(0, 1);
    const out = sortRows(small, input, { column: 'number', descending: true });
    expect([...input]).toEqual([0, 1]);
    expect(nums(out)).toEqual([11, 10]);
  });
});

describe('tableOrder', () => {
  const rows = select(data, state.filters);
  const titles = { title: (r: number) => `title ${String(100 - r).padStart(3, '0')}` };

  it('is the table’s rows in the table’s order, narrowed by a chosen week as the table is', () => {
    const scope = { ...state, week: '2026-05-18' };
    const sort = { column: 'size', descending: true } as const;
    expect(numbers(tableOrder(data, rows, scope, sort))).toEqual(numbers(sortRows(data, narrowRows(data, rows, scope), sort)));
    expect(numbers(tableOrder(data, rows, scope, sort))).toEqual([66500, 66510]);
  });

  it('reads the titles only when sorting by title', () => {
    const byOpened = { column: 'opened', descending: true } as const;
    expect(numbers(tableOrder(data, rows, state, byOpened, titles))).toEqual(numbers(sortRows(data, rows, byOpened)));
    const byTitle = { column: 'title', descending: false } as const;
    expect(numbers(tableOrder(data, rows, state, byTitle, titles))).toEqual(numbers(sortRows(data, rows, byTitle, titles)));
    expect(numbers(tableOrder(data, rows, state, byTitle, titles))).not.toEqual(numbers(rows));
  });

  it('says the order in words, keeping the column label’s capitals', () => {
    expect(sortWords({ column: 'opened', descending: true })).toBe('by Opened, descending');
    expect(sortWords({ column: 'number', descending: false })).toBe('by PR, ascending');
    expect(sortWords({ column: 'disclosure', descending: false })).toBe('by AI use, ascending');
  });
});

describe('tableRows', () => {
  const period = periodRange(state.filters);
  const rows = select(data, state.filters);

  it('is the selection when no week or band is chosen', () => {
    expect([...tableRows(data, state)]).toEqual([...rows]);
  });

  it('narrows to the PRs opened in a chosen week', () => {
    const week = '2026-05-18';
    const out = tableRows(data, { ...state, week });
    expect([...out]).toEqual([...openedInBucket(data, rows, period, dayStart(week) as number)]);
    expect(numbers(out)).toEqual([66500, 66510]);
  });

  it('narrows to the PRs behind a band of the backlog', () => {
    const week = '2026-06-01';
    const at = backlogMoment(data, period, dayStart(week) as number);
    expect([...tableRows(data, { ...state, week, band: '30-90' })]).toEqual([...backlogRows(data, rows, '30-90', at)]);
  });

  it('counts what it lists against the PRs opened in the period, or says what narrows it', () => {
    expect(countText(4275, 3483, null)).toBe('4,275 PRs open at some point in the period, 3,483 of them opened in it');
    expect(countText(2, 2, 'opened in the week of 2026-05-18')).toBe('2 PRs opened in the week of 2026-05-18');
    expect(countText(0, 0, 'opened in the week of 2026-06-22')).toBe('no PRs opened in the week of 2026-06-22');
    expect(countText(1, 0, null)).toBe('1 PR open at some point in the period, 0 of them opened in it');
  });

  it('narrows a selection already made the same way', () => {
    const scope = { ...state, week: '2026-05-18' };
    expect([...narrowRows(data, rows, scope)]).toEqual([...tableRows(data, scope)]);
  });

  it('says what a week or a band narrows it to', () => {
    expect(narrowing(data, state)).toBeNull();
    expect(narrowing(data, { ...state, week: '2026-05-18' })).toBe('opened in the week of 2026-05-18');
    expect(narrowing(data, { ...state, week: '2026-06-01', band: '30-90' })).toBe(
      `open at the end of the week of 2026-06-01, aged ${AGE_BANDS[2].label}`,
    );
  });

  it('names a month a period counts by without "the"', () => {
    const long = { ...state, filters: { ...state.filters, from: '2024-11-16' } };
    expect(narrowing(data, { ...long, week: '2026-06-01' })).toBe('opened in June 2026');
    expect(narrowing(data, { ...long, week: '2026-06-01', band: '30-90' })).toBe(
      `open at the end of June 2026, aged ${AGE_BANDS[2].label}`,
    );
  });
});

describe('cells', () => {
  const row = (n: number) => [...Array(data.size).keys()].find((r) => data.prs.number[r] === n) as number;
  const text = { title: () => 'a title' };

  it('writes each column of a merged, disclosed PR', () => {
    const r = row(66500);
    const cells = Object.fromEntries(TABLE_COLUMNS.map((c) => [c.id, cellText(data, r, c.id, text)]));
    expect(cells).toEqual({
      number: '#66500',
      title: 'a title',
      author: 'fixture-author-d',
      opened: '2026-05-18',
      state: 'merged',
      kind: 'Bug fix',
      response: '23 hours',
      open: '4 days',
      size: '30 lines, 2 files',
      disclosure: 'disclosed: Claude',
      reopened: 'no',
    });
  });

  it('says why a wait has no value, and that an open PR’s time is so far', () => {
    // 66700 was opened as a draft and is one still: never ready. 66600 is open, responded after 8 days.
    expect(cellText(data, row(66700), 'response', text)).toBe('never ready');
    expect(cellText(data, row(66700), 'state', text)).toBe('open, draft');
    expect(cellText(data, row(66600), 'open', text)).toMatch(/^166 days so far$/);
    // 66510 closed unmerged with no response; 67250 is open with none yet.
    expect(cellText(data, row(66510), 'response', text)).toBe('none');
    expect(cellText(data, row(67250), 'response', text)).toBe('none yet');
    expect(cellText(data, row(66900), 'reopened', text)).toBe('once');
    expect(cellText(data, row(66510), 'disclosure', text)).toBe('not disclosed');
    expect(cellText(data, row(66510), 'title', { title: () => null })).toBe('');
  });
});

describe('kindDecided', () => {
  it('says the kind and what decided it in words', () => {
    expect(kindDecided(META.kinds, 0, 'tracker')).toBe('Bug fix, from its tracker ticket');
    expect(kindDecided(META.kinds, 1, 'checklist')).toBe('Feature, from the PR’s checklist');
    expect(kindDecided(META.kinds, 2, 'labels')).toBe('Cleanup, from its labels');
    expect(kindDecided(META.kinds, 0, 'original')).toBe('Bug fix, from the PR it backports');
    expect(kindDecided(META.kinds, -1, '')).toBe('unknown: nothing decided it');
  });
});

describe('links', () => {
  it('builds the PR’s and the ticket’s addresses', () => {
    expect(prUrl('ceph/ceph', 66500)).toBe('https://github.com/ceph/ceph/pull/66500');
    expect(ticketUrl(72001)).toBe('https://tracker.ceph.com/issues/72001');
  });
});

describe('yearsOfRows', () => {
  it('names the years whose table files the rows need, and no others', () => {
    // With 2025 before the fixture: row 0 is 2025's #60010, rows 1–12 are 2026's.
    const earlier = withEarlierYear();
    const m = parseMeta(earlier['meta.json']);
    const twoYears = combine(m, [
      parseYear(2025, earlier['prs-2025.json'], earlier['events-2025.json'], m),
      parseYear(2026, FIXTURE['prs-2026.json'], FIXTURE['events-2026.json'], m),
    ]);
    expect(yearsOfRows(twoYears, Uint32Array.of(3, 5))).toEqual([2026]);
    expect(yearsOfRows(twoYears, Uint32Array.of(0))).toEqual([2025]);
    expect(yearsOfRows(twoYears, Uint32Array.of(0, 7))).toEqual([2025, 2026]);
    expect(yearsOfRows(twoYears, new Uint32Array(0))).toEqual([]);
    expect(yearsOfRows(data, Uint32Array.of(0, 11))).toEqual([2026]);
  });
});

describe('windowRows', () => {
  it('draws the rows in view and a few either side', () => {
    expect(windowRows(0, 400, 40, 6000, 5)).toEqual({ start: 0, end: 15 });
    expect(windowRows(4000, 400, 40, 6000, 5)).toEqual({ start: 95, end: 115 });
    expect(windowRows(239_800, 400, 40, 6000, 5)).toEqual({ start: 5990, end: 6000 });
    expect(windowRows(0, 400, 40, 3, 5)).toEqual({ start: 0, end: 3 });
  });
});
