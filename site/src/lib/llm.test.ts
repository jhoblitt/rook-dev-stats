import { describe, expect, it } from 'vitest';
import { COLOURS } from './colours';
import { periodRange } from './filters';
import { formatCount, formatShare } from './format';
import {
  HORIZONS,
  MIN_FOLLOWED,
  byDisclosure,
  comparison,
  comparisonSummary,
  describeShares,
  familiesModel,
  percent,
  shareModel,
} from './llm';
import { curveQuantiles } from './review';
import { openedIn, select } from './select';
import { defaultFilters } from './state';
import { outcomeCurve } from './stats/curve';
import { disclosureCounts, distribution, mergedWithin } from './stats/measures';
import { META, all, at, dataset, fixture } from './stats/testing';
import { weekly } from './stats/weekly';

const data = fixture();
const filters = defaultFilters(META);
const period = periodRange(filters);
const rows = select(data, filters);
const opened = openedIn(data, rows, period);
const DAY = 86_400;

describe('byDisclosure', () => {
  it('splits the rows into those not disclosing and those disclosing, in order', () => {
    // On main, opened in the period: 66500, 67000 and 67100 disclose (rows 3, 9, 10).
    const { notDisclosed, disclosed } = byDisclosure(data, opened);
    expect([...disclosed].map((r) => data.prs.number[r])).toEqual([66500, 67000, 67100]);
    expect([...notDisclosed].map((r) => data.prs.number[r])).toEqual([66510, 66600, 66700, 66900]);
  });
});

describe('shareModel', () => {
  const shares = weekly(data, rows, period, 'disclosureShare');
  const model = shareModel(shares);

  it('draws the share disclosing as one line in the disclosed colour, in percent', () => {
    expect(model.bars).toEqual([]);
    expect(model.lines).toHaveLength(1);
    const line = model.lines[0];
    expect(line?.color).toBe(COLOURS.disclosed);
    expect(line?.label).toBe('AI use disclosed');
    expect(line?.values).toEqual((shares.values['disclosed'] ?? []).map((v) => (v === null ? null : v * 100)));
    expect(percent(25)).toBe('25%');
  });

  it('says why a week has no share: no PRs were opened in it', () => {
    const line = model.lines[0];
    const empty = line?.values.findIndex((v) => v === null) ?? -1;
    expect(empty).toBeGreaterThanOrEqual(0);
    expect(line?.missing?.[empty]).toBe('no PRs opened');
  });

  it('describes the range, the highest week and the weeks with none opened', () => {
    // PRs opened in six weeks: 05-18 (66500 disclosed, 66510) → 50%; 06-01, 06-15 and 07-06 → 0%;
    // 08-03 (67000) and 08-31 (67100) → 100%, the first of them the highest.
    expect(describeShares(model)).toMatch(
      /^By week, 27 weeks from 2026-05-11 to 2026-11-09. AI use disclosed: from 0% to 100%, highest in the week of 2026-08-03\. No PRs opened in 21 weeks\./,
    );
  });

  it('names the highest month as a month is named, without "the"', () => {
    // Over two years the buckets are months: May 2026 50%, June and July 0%, August 100%.
    const long = periodRange({ from: '2024-11-16', to: '2026-11-15' });
    const monthly = shareModel(weekly(data, select(data, { ...filters, from: '2024-11-16' }), long, 'disclosureShare'));
    expect(monthly.step).toBe('month');
    expect(describeShares(monthly)).toMatch(
      /^By month, 25 months from 2024-11-01 to 2026-11-01. AI use disclosed: from 0% to 100%, highest in August 2026\. /,
    );
  });
});

describe('the tool families', () => {
  // Five families; of 100 PRs opened, 10 name Claude, 5 none ("unspecified"), 3 Copilot, 1 each Cursor and Gemini.
  const FIVE = [
    { id: 'claude', name: 'Claude' },
    { id: 'cursor', name: 'Cursor' },
    { id: 'gemini', name: 'Gemini' },
    { id: 'copilot', name: 'Copilot' },
    { id: 'unspecified', name: 'Unspecified' },
  ];
  const t = at('2026-06-02T00:00:00Z');
  const p = { start: at('2026-06-01T00:00:00Z'), end: at('2026-06-08T00:00:00Z') };
  const naming = (f: number, n: number) => Array.from({ length: n }, () => ({ created: t, disclosure: 3, families: [f] }));
  const many = dataset(
    [...naming(0, 10), ...naming(3, 3), ...naming(1, 1), ...naming(2, 1), ...naming(4, 5), ...Array.from({ length: 80 }, () => ({ created: t }))],
    [],
    { families: FIVE },
  );
  const manyRows = all(many);
  const counts = disclosureCounts(many, manyRows);

  it('draws every family named, however rarely, in one panel on one scale, most named first and "unspecified" last', () => {
    const chart = familiesModel(weekly(many, manyRows, p, 'disclosureShare'), FIVE, counts);
    const keys = ['claude', 'copilot', 'cursor', 'gemini', 'unspecified'];
    expect(chart.model.lines.map((l) => l.key)).toEqual(keys);
    expect(chart.panels).toEqual([{ keys, unit: '% of PRs opened' }]);
    expect(chart.model.lines[2]?.values).toEqual([1]);
  });

  it('tells each family’s line apart by colour and again by marker and dash, "unspecified" in a neutral', () => {
    const chart = familiesModel(weekly(many, manyRows, p, 'disclosureShare'), FIVE, counts);
    const lines = chart.model.lines;
    expect(new Set(lines.map((l) => l.color)).size).toBe(lines.length);
    expect(new Set(lines.map((l) => `${l.shape} ${l.dashed === true}`)).size).toBe(lines.length);
    expect(lines.find((l) => l.key === 'unspecified')?.color).toBe(COLOURS.statistic);
    for (const l of lines) expect([COLOURS.disclosed, COLOURS.notDisclosed]).not.toContain(l.color);
  });

  it('gives every family of the tools table its own colour and its own marker and dash', () => {
    const SEVEN = ['copilot', 'cursor', 'ibm-bob', 'claude', 'openai', 'gemini', 'unspecified'].map((id) => ({ id, name: id }));
    const each = dataset(
      SEVEN.map((_, f) => ({ created: t, disclosure: 3, families: [f] })),
      [],
      { families: SEVEN },
    );
    const lines = familiesModel(weekly(each, all(each), p, 'disclosureShare'), SEVEN, disclosureCounts(each, all(each))).model.lines;
    expect(lines).toHaveLength(7);
    expect(new Set(lines.map((l) => l.color)).size).toBe(7);
    expect(new Set(lines.map((l) => `${l.shape} ${l.dashed === true}`)).size).toBe(7);
  });

  it('keeps a family’s colour and marker whichever other families the selection names', () => {
    const style = (l: { key: string; color: string; shape: string; dashed?: boolean }) => [l.key, l.color, l.shape, l.dashed === true];
    const wide = familiesModel(weekly(many, manyRows, p, 'disclosureShare'), FIVE, counts).model.lines.map(style);
    const claudeOnly = manyRows.filter((r) => (many.prs.families[r] ?? []).every((f) => f === 0));
    const narrow = familiesModel(weekly(many, claudeOnly, p, 'disclosureShare'), FIVE, disclosureCounts(many, claudeOnly)).model.lines.map(style);
    expect(narrow).toEqual([wide[0]]);
  });

  it('draws the fixture’s two families in one panel', () => {
    // Claude: 66500 and 67100; GitHub Copilot: 67000; unspecified: none.
    const shares = weekly(data, rows, period, 'disclosureShare');
    const chart = familiesModel(shares, META.families, disclosureCounts(data, opened));
    expect(chart.panels).toEqual([{ keys: ['claude', 'copilot'], unit: '% of PRs opened' }]);
    expect(chart.model.lines.map((l) => l.label)).toEqual(['Claude', 'GitHub Copilot']);
    expect(chart.model.lines[0]?.values).toEqual((shares.values['claude'] ?? []).map((v) => (v === null ? null : v * 100)));
  });
});

describe('comparison', () => {
  const { notDisclosed, disclosed } = byDisclosure(data, opened);
  const rowsOf = comparison(data, opened);
  const row = (key: string) => rowsOf.find((r) => r.key === key);

  it('gives each figure from the statistics library over the two selections, with what it rests on', () => {
    [notDisclosed, disclosed].forEach((g, i) => {
      const of = { basis: `of ${g.length} PR${g.length === 1 ? '' : 's'}` };
      const lines = distribution(data, g, 'lines');
      expect(row('lines')?.cells[i]).toEqual({ text: `median ${formatCount(lines?.median ?? 0)} · 90th percentile ${formatCount(lines?.p90 ?? 0)}`, ...of });
      const files = distribution(data, g, 'files');
      expect(row('files')?.cells[i]).toEqual({ text: `median ${formatCount(files?.median ?? 0)} · 90th percentile ${formatCount(files?.p90 ?? 0)}`, ...of });

      const first = outcomeCurve(data, g, 'firstCommitToOpened');
      const fq = curveQuantiles(first, 'firstCommitToOpened');
      expect(row('firstCommit')?.cells[i]).toEqual({
        text: `median ${fq.median} · 90th percentile ${fq.p90}`,
        basis: `of ${first.counts.done} PR${first.counts.done === 1 ? '' : 's'}`,
      });

      const bots = distribution(data, g, 'botReviews');
      expect(row('botReviews')?.cells[i]).toEqual({
        text: `${formatShare(bots?.nonzero ?? 0)} had one · mean ${(bots?.mean ?? 0).toFixed(1).replace(/\.0$/, '')} a PR`,
        ...of,
      });
    });
    expect(row('timeToMerge')).toBeUndefined();
  });

  it('says there are too few to say at a horizon fewer than 30 PRs of the group have reached', () => {
    // The fixture's groups have 4 and 3 PRs.
    expect(MIN_FOLLOWED).toBe(30);
    expect(HORIZONS).toEqual([7, 30, 90]);
    for (const h of HORIZONS) {
      const cells = row(`merged${h}`)?.cells;
      expect(row(`merged${h}`)?.label).toBe(`Merged within ${h} days of opening`);
      expect(cells?.[1]?.text).toBe('too few to say');
      expect(cells?.[1]?.basis).toBe(`only ${mergedWithin(data, disclosed, h).followed} opened at least ${h} days ago`);
    }
  });

  it('gives the plain share merged within each horizon, of the PRs opened at least that long ago', () => {
    // 40 PRs opened 100 days ago: 20 merged after 5 days, 10 after 20, 10 open; 5 opened 10 days ago, open.
    const fetched = at('2026-10-01T00:00:00Z');
    const old = fetched - 100 * DAY;
    const young = fetched - 10 * DAY;
    const d = dataset(
      [
        ...Array.from({ length: 20 }, () => ({ created: old, state: 1, closed: old + 5 * DAY })),
        ...Array.from({ length: 10 }, () => ({ created: old, state: 1, closed: old + 20 * DAY })),
        ...Array.from({ length: 10 }, () => ({ created: old })),
        ...Array.from({ length: 5 }, () => ({ created: young })),
      ],
      [],
      { fetched_through: fetched },
    );
    const r = comparison(d, all(d));
    const cell = (h: number) => r.find((x) => x.key === `merged${h}`)?.cells[0];
    for (const h of HORIZONS) expect(cell(h)?.text).toBe(formatShare(mergedWithin(d, all(d), h).share as number));
    // By hand: at 7 days all 45 are followed and 20 merged within it; at 30 and 90 days the 40 old
    // ones are, and 30 of them merged within 20 days.
    expect(cell(7)).toEqual({ text: '44%', basis: 'from the 45 opened at least 7 days ago' });
    expect(cell(30)).toEqual({ text: '75%', basis: 'from the 40 opened at least 30 days ago' });
    expect(cell(90)).toEqual({ text: '75%', basis: 'from the 40 opened at least 90 days ago' });
    expect(r.find((x) => x.key === 'merged30')?.cells[1]).toEqual({ text: 'no PRs', basis: null });
  });

  it('reads as the fixture was counted by hand', () => {
    // Lines: not disclosed 4, 70, 250, 1050; disclosed 30, 90, 2200.
    expect(row('lines')?.cells).toEqual([
      { text: 'median 70 · 90th percentile 1,050', basis: 'of 4 PRs' },
      { text: 'median 90 · 90th percentile 2,200', basis: 'of 3 PRs' },
    ]);
    // 66500: 30 minutes; 67000 has no first commit; 67100: 3 days.
    expect(row('firstCommit')?.cells[1]).toEqual({ text: 'median under 1 hour · 90th percentile 3 days', basis: 'of 2 PRs' });
    // Bot reviews: 66500 and 67000 had one each.
    expect(row('botReviews')?.cells).toEqual([
      { text: '0% had one · mean 0 a PR', basis: 'of 4 PRs' },
      { text: '67% had one · mean 0.7 a PR', basis: 'of 3 PRs' },
    ]);
  });

  it('says so where a group has no PRs, and where a curve has none to measure', () => {
    const d = dataset([{ created: at('2026-06-02T00:00:00Z') }]);
    const r = comparison(d, all(d));
    expect(r.find((x) => x.key === 'lines')?.cells[1]).toEqual({ text: 'no PRs', basis: null });
    expect(r.find((x) => x.key === 'firstCommit')?.cells[0]).toEqual({ text: 'no PR to measure', basis: null });
  });

  it('writes a text alternative naming both groups for each figure', () => {
    const text = comparisonSummary(rowsOf);
    expect(text).toContain('Lines changed: AI use not disclosed median 70 · 90th percentile 1,050 (of 4 PRs); AI use disclosed median 90 · 90th percentile 2,200 (of 3 PRs).');
    expect(text).toContain('Merged within 90 days of opening: AI use not disclosed too few to say (only');
  });
});
