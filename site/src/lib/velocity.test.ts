import { describe, expect, it } from 'vitest';
import { periodRange } from './filters';
import { select } from './select';
import { defaultFilters } from './state';
import { backlog } from './stats/backlog';
import { META, at, fixture } from './stats/testing';
import { weekly } from './stats/weekly';
import { COLOURS } from './colours';
import { backlogModel, prsModel } from './velocity';

// The default view: PRs on master, 2026-05-15 to 2026-11-15, 27 weeks from 2026-05-11.
const data = fixture();
const filters = defaultFilters(META);
const period = periodRange(filters);
const rows = select(data, filters);

/** 27 weekly zeros, with the given weeks set. */
function weeks(set: Record<number, number>): number[] {
  return Array.from({ length: 27 }, (_, i) => set[i] ?? 0);
}

describe('prsModel', () => {
  const model = prsModel(
    weekly(data, rows, period, 'opened'),
    weekly(data, rows, period, 'merged'),
    weekly(data, rows, period, 'closed'),
  );

  it('steps by the weeks of the period', () => {
    expect(model.step).toBe('week');
    expect(model.buckets).toHaveLength(27);
    expect(model.buckets[0]).toBe(at('2026-05-11T00:00:00Z'));
  });

  it('stacks the PRs opened, not disclosed under disclosed', () => {
    expect(model.bars.map((b) => [b.key, b.label, b.color])).toEqual([
      ['not-disclosed', 'AI use not disclosed', COLOURS.notDisclosed],
      ['disclosed', 'AI use disclosed', COLOURS.disclosed],
    ]);
    expect(model.stackLabel).toBe('opened');
    // #66510 (05-20), #66600 (06-02), #66700 (06-15), #66900 (07-10).
    expect(model.bars[0]?.values).toEqual(weeks({ 1: 1, 3: 1, 5: 1, 8: 1 }));
    // #66500 (05-18), #67000 (08-05), #67100 (09-01).
    expect(model.bars[1]?.values).toEqual(weeks({ 1: 1, 12: 1, 16: 1 }));
  });

  it('draws merged and closed unmerged as lines, in the outcomes\' colours', () => {
    expect(model.lines.map((l) => [l.key, l.label, l.color, l.shape])).toEqual([
      ['merged', 'merged', COLOURS.reached, 'circle'],
      ['closed', 'closed unmerged', COLOURS.finishedWithout, 'square'],
    ]);
    // #66500 (05-22), #64010 from 2025 (06-10), #67000 (08-18), #66900 (08-27), #67100 (09-25).
    expect(model.lines[0]?.values).toEqual(weeks({ 1: 1, 4: 1, 14: 1, 15: 1, 19: 1 }));
    // #66510 (06-01).
    expect(model.lines[1]?.values).toEqual(weeks({ 3: 1 }));
  });
});

describe('backlogModel', () => {
  const model = backlogModel(backlog(data, rows, period));

  it('stacks the age bands from the youngest up, on the neutral ordinal ramp', () => {
    expect(model.layers.map((l) => [l.key, l.label, l.fill])).toEqual([
      ['lt7', 'under 7 days', 'var(--ordinal-1)'],
      ['7-30', '7–30 days', 'var(--ordinal-2)'],
      ['30-90', '30–90 days', 'var(--ordinal-3)'],
      ['gt90', 'over 90 days', 'var(--ordinal-4)'],
    ]);
    expect(model.totalLabel).toBe('open');
  });

  it('counts the PRs open at each week end by age', () => {
    const at = (i: number) => model.layers.map((l) => l.values[i]);
    // 05-18: #64010 (from 2025) and #66100 (04-20, 28 days).
    expect(at(0)).toEqual([0, 1, 0, 1]);
    // 06-08: #66600 (6 days), #66100 (49 days), #64010.
    expect(at(3)).toEqual([1, 0, 1, 1]);
    // At the fetch, 11-15 06:00: #66100, #66600 and the draft #66700, each over 90 days.
    expect(at(26)).toEqual([0, 0, 0, 3]);
  });
});
