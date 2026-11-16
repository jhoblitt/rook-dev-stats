import { describe, expect, it } from 'vitest';
import {
  type AreaModel,
  type BucketModel,
  type CurveModel,
  areaLegend,
  areaReadout,
  areaTable,
  bucketHead,
  bucketLegend,
  bucketReadout,
  bucketTable,
  curveAt,
  curveLegend,
  curveReadout,
  curveMilestones,
  curveTable,
  coverage,
  describeArea,
  describeCounts,
  describeCurve,
  describeWaits,
  partialText,
  readoutText,
  stackTotals,
  withCoverage,
} from './charts';
import { formatCount, formatDays } from './format';

const at = (iso: string) => Date.parse(iso) / 1000;
const WEEKS = [at('2026-05-11T00:00:00Z'), at('2026-05-18T00:00:00Z'), at('2026-05-25T00:00:00Z')];

const counts: BucketModel = {
  step: 'week',
  buckets: WEEKS,
  bars: [
    { key: 'not-disclosed', label: 'not disclosed', color: 'var(--series-1)', values: [0, 2, 1] },
    { key: 'disclosed', label: 'disclosed', color: 'var(--series-2)', values: [0, 1, 0] },
  ],
  stackLabel: 'opened',
  lines: [{ key: 'merged', label: 'merged', color: 'var(--series-3)', shape: 'circle', values: [1, 0, 0] }],
};

// Week 1: no PRs opened. Week 2: median 12 hours, the 90th percentile not
// reached. Week 3: both not yet known.
const waits: BucketModel = {
  step: 'week',
  buckets: WEEKS,
  bars: [],
  lines: [
    {
      key: '0.5',
      label: 'median',
      color: 'var(--text-muted)',
      shape: 'circle',
      values: [null, 0.5, null],
      missing: [null, null, 'not yet known'],
    },
    {
      key: '0.9',
      label: '90th percentile',
      color: 'var(--text-muted)',
      shape: 'square',
      dashed: true,
      values: [null, null, null],
      missing: [null, 'not reached: 50% merged', 'not yet known'],
      unreached: [false, true, false],
    },
  ],
  notes: ['no PRs opened', null, null],
  shade: [false, false, true],
  shadeLabel: 'not yet known',
};

describe('an empty model', () => {
  it('has no summary, legend rows or table rows, and does not throw', () => {
    const none: BucketModel = { step: 'week', buckets: [], bars: counts.bars.map((b) => ({ ...b, values: [] })), lines: [] };
    expect(describeCounts(none)).toBe('');
    expect(describeWaits({ ...waits, buckets: [], lines: [] })).toBe('');
    expect(bucketTable(none, formatCount).rows).toEqual([]);
    expect(describeArea({ ...backlog, buckets: [], layers: [] })).toBe('');
    expect(describeCurve({ days: [], series: [] }, { median: 'not yet known', p90: 'not yet known' })).toBe('');
  });
});

describe('coverage', () => {
  // The default period: Friday 2026-05-15 to Sunday 2026-11-15, fetched at 06:00 that Sunday.
  const period = { start: at('2026-05-15T00:00:00Z'), end: at('2026-11-16T00:00:00Z') };
  const fetched = at('2026-11-15T06:00:00Z');

  it('marks a week the period starts inside, and one the fetch ends inside', () => {
    const weeks = [at('2026-05-11T00:00:00Z'), at('2026-05-18T00:00:00Z'), at('2026-11-09T00:00:00Z')];
    expect(coverage(weeks, 'week', period, fetched)).toEqual([{ days: 3, of: 7 }, null, { days: 6, of: 7 }]);
  });

  it('marks a month the period cuts, in that month\'s days', () => {
    const months = [at('2026-05-01T00:00:00Z'), at('2026-06-01T00:00:00Z')];
    const long = { start: period.start, end: at('2026-06-11T00:00:00Z') };
    expect(coverage(months, 'month', long, fetched)).toEqual([{ days: 17, of: 31 }, { days: 10, of: 30 }]);
  });

  it('writes less than a day as under one', () => {
    expect(partialText({ days: 0, of: 7 })).toBe('partial: under 1 of 7 days');
    expect(partialText({ days: 3, of: 7 })).toBe('partial: 3 of 7 days');
  });

  it('names a partial bucket with its coverage in the table, the readout title and the summary', () => {
    const marked = withCoverage(counts, { start: at('2026-05-14T00:00:00Z'), end: at('2026-06-01T00:00:00Z') }, fetched);
    expect(marked.partial).toEqual([{ days: 4, of: 7 }, null, null]);
    expect(bucketHead(marked, 0)).toBe('week of 2026-05-11, partial: 4 of 7 days');
    expect(bucketTable(marked, formatCount).rows[0]?.head).toBe('week of 2026-05-11, partial: 4 of 7 days');
    expect(describeCounts(marked)).toMatch(/ Partial: week of 2026-05-11, 4 of 7 days\.$/);
    expect(bucketLegend(marked).at(-1)).toEqual({ label: 'partial week', mark: 'partial', color: 'var(--text-faint)' });
  });

  it('keys a partial bucket of a chart with no bars as its lone hollow marker, after the first line drawn', () => {
    const lines = {
      ...counts,
      bars: [],
      lines: [
        { key: 'n', label: 'n', color: 'var(--text-muted)', shape: 'circle' as const, values: [1, 2, 3], undrawn: true },
        { key: 'r', label: 'r', color: 'var(--text-muted)', shape: 'square' as const, values: [1, 2, 3] },
      ],
      partial: [{ days: 4, of: 7 }, null, null],
    };
    expect(bucketLegend(lines).at(-1)).toEqual({
      label: 'partial week',
      mark: 'partial',
      color: 'var(--text-muted)',
      shape: 'square',
    });
  });

  it('adds the model\'s note to a partial bucket\'s name, and only to a partial one', () => {
    const marked = { ...counts, partial: [{ days: 4, of: 7 }, null, null], partialNote: 'both counts are partial' };
    expect(bucketHead(marked, 0)).toBe('week of 2026-05-11, partial: 4 of 7 days; both counts are partial');
    expect(bucketHead(marked, 1)).toBe('week of 2026-05-18');
  });
});

describe('bucket models', () => {
  it('totals each stack', () => {
    expect(stackTotals(counts)).toEqual([0, 3, 1]);
    expect(stackTotals(waits)).toEqual([0, 0, 0]);
  });

  it('lists bars in stack order, then lines, then the shading and the unreached mark', () => {
    expect(bucketLegend(counts)).toEqual([
      { label: 'not disclosed', mark: 'bar', color: 'var(--series-1)' },
      { label: 'disclosed', mark: 'bar', color: 'var(--series-2)' },
      { label: 'merged', mark: 'line', color: 'var(--series-3)', shape: 'circle' },
    ]);
    expect(bucketLegend(waits)).toEqual([
      { label: 'median', mark: 'line', color: 'var(--text-muted)', shape: 'circle' },
      { label: '90th percentile', mark: 'line', color: 'var(--text-muted)', shape: 'square', dashed: true },
      { label: 'not yet known', mark: 'note', color: 'var(--grid)' },
      { label: 'not reached', mark: 'unreached', color: 'var(--text-muted)' },
    ]);
  });

  it('tabulates every bucket, with the stack total', () => {
    expect(bucketTable(counts, formatCount)).toEqual({
      columns: ['Week', 'not disclosed', 'disclosed', 'opened', 'merged'],
      rows: [
        { head: 'week of 2026-05-11', cells: ['0', '0', '0', '1'] },
        { head: 'week of 2026-05-18', cells: ['2', '1', '3', '0'] },
        { head: 'week of 2026-05-25', cells: ['1', '0', '1', '0'] },
      ],
    });
  });

  it('tabulates a missing value as its own reason, else the bucket\'s note', () => {
    expect(bucketTable(waits, formatDays).rows).toEqual([
      { head: 'week of 2026-05-11', cells: ['no PRs opened', 'no PRs opened'] },
      { head: 'week of 2026-05-18', cells: ['12 hours', 'not reached: 50% merged'] },
      { head: 'week of 2026-05-25', cells: ['not yet known', 'not yet known'] },
    ]);
  });

  it('states each total and its busiest bucket', () => {
    expect(describeCounts(counts)).toBe(
      'By week, 3 weeks from 2026-05-11 to 2026-05-25. ' +
        '4 opened (3 not disclosed, 1 disclosed), at most 3 in a week (week of 2026-05-18). ' +
        '1 merged, at most 1 in a week (week of 2026-05-11).',
    );
  });

  it('states a series with nothing in it as none', () => {
    const one: BucketModel = { step: 'month', buckets: [WEEKS[0] as number], bars: [counts.bars[0]!], lines: [] };
    expect(describeCounts({ ...one, bars: [{ ...counts.bars[0]!, values: [0] }] })).toBe(
      'By month, 1 month from 2026-05-11 to 2026-05-11. 0 not disclosed.',
    );
  });

  it('reads a bucket out top to bottom, with the total, then the lines', () => {
    expect(bucketReadout(counts, 1, formatCount)).toEqual([
      { label: 'disclosed', value: '1', color: 'var(--series-2)', mark: 'bar' },
      { label: 'not disclosed', value: '2', color: 'var(--series-1)', mark: 'bar' },
      { label: 'opened', value: '3', color: null, mark: 'total' },
      { label: 'merged', value: '0', color: 'var(--series-3)', mark: 'line', shape: 'circle' },
    ]);
    expect(readoutText(bucketReadout(counts, 1, formatCount))).toBe('disclosed 1, not disclosed 2, opened 3, merged 0');
  });

  it('reads a missing value out as its reason', () => {
    expect(bucketReadout(waits, 0, formatDays).map((r) => r.value)).toEqual(['no PRs opened', 'no PRs opened']);
    expect(bucketReadout(waits, 1, formatDays).map((r) => r.value)).toEqual(['12 hours', 'not reached: 50% merged']);
    expect(bucketReadout(waits, 2, formatDays).map((r) => r.value)).toEqual(['not yet known', 'not yet known']);
    expect(bucketReadout(waits, 1, formatDays)[1]?.dashed).toBe(true);
  });

  it('names the partial weeks of a chart of waits too', () => {
    expect(describeWaits({ ...waits, partial: [null, null, { days: 2, of: 7 }] })).toMatch(
      / Partial: week of 2026-05-25, 2 of 7 days\.$/,
    );
  });

  it('states the known waits, the not yet known and not reached, and the weeks with nothing apart', () => {
    // One value known, or the same in every bucket known, is said once, with how many buckets have it.
    expect(describeWaits(waits)).toBe(
      'By week opened, 3 weeks from 2026-05-11 to 2026-05-25. ' +
        'median: 12 hours in 1 week, not yet known in 1 week. ' +
        '90th percentile: no value known, not yet known in 1 week, not reached in 1 week. ' +
        'No PRs opened in 1 week.',
    );
  });
});

const backlog: AreaModel = {
  step: 'week',
  buckets: WEEKS,
  layers: [
    { key: 'lt7', label: 'under 7 days', fill: 'var(--ordinal-1)', values: [1, 2, 0] },
    { key: 'gt90', label: 'over 90 days', fill: 'var(--ordinal-4)', values: [3, 3, 4] },
  ],
  totalLabel: 'open',
};

describe('area models', () => {
  it('lists the layers from the baseline up', () => {
    expect(areaLegend(backlog)).toEqual([
      { label: 'under 7 days', mark: 'area', color: 'var(--ordinal-1)' },
      { label: 'over 90 days', mark: 'area', color: 'var(--ordinal-4)' },
    ]);
  });

  it('tabulates every bucket, with the total', () => {
    expect(areaTable(backlog)).toEqual({
      columns: ['Week', 'under 7 days', 'over 90 days', 'open'],
      rows: [
        { head: 'week of 2026-05-11', cells: ['1', '3', '4'] },
        { head: 'week of 2026-05-18', cells: ['2', '3', '5'] },
        { head: 'week of 2026-05-25', cells: ['0', '4', '4'] },
      ],
    });
  });

  it('reads a bucket out top to bottom, marking the layer in focus, then the total', () => {
    expect(areaReadout(backlog, 1, 0)).toEqual([
      { label: 'over 90 days', value: '3', color: 'var(--ordinal-4)', mark: 'area' },
      { label: 'under 7 days', value: '2', color: 'var(--ordinal-1)', mark: 'area', strong: true },
      { label: 'open', value: '5', color: null, mark: 'total' },
    ]);
    expect(areaReadout(backlog, 1, null).some((r) => r.strong)).toBe(false);
  });

  it('states the last bucket by layer and the largest total', () => {
    expect(describeArea(backlog)).toBe(
      'By week, 3 weeks from 2026-05-11 to 2026-05-25. ' +
        'In the last, week of 2026-05-25, 4 open: 0 under 7 days, 4 over 90 days. ' +
        'At most 5 open, week of 2026-05-18.',
    );
  });
});

const merge: CurveModel = {
  days: [1, 2.5, 40],
  series: [
    { key: 'merged', label: 'merged', color: 'var(--series-1)', shape: 'circle', values: [0.25, 0.25, 0.75], remains: false },
    { key: 'closed', label: 'closed unmerged', color: 'var(--series-2)', shape: 'square', values: [0, 0.25, 0.25], remains: false },
    { key: 'open', label: 'still open', color: 'var(--series-3)', shape: 'triangle', values: [0.75, 0.5, 0], remains: true },
  ],
};

describe('curve models', () => {
  it('reads each share at a day, as a step', () => {
    expect(curveAt(merge, 0.5)).toEqual([0, 0, 1]);
    expect(curveAt(merge, 1)).toEqual([0.25, 0, 0.75]);
    expect(curveAt(merge, 30)).toEqual([0.25, 0.25, 0.5]);
    expect(curveAt(merge, 400)).toEqual([0.75, 0.25, 0]);
  });

  it('marks the usual milestones up to the longest duration, and that', () => {
    expect(curveMilestones(merge)).toEqual([1 / 24, 1, 2, 7, 14, 30, 40]);
    expect(curveMilestones({ ...merge, days: [0.5, 7] })).toEqual([1 / 24, 1, 2, 7]);
    expect(curveMilestones({ days: [], series: [] })).toEqual([]);
  });

  it('tabulates the shares at each milestone', () => {
    const t = curveTable({ ...merge, days: [1, 2.5, 7] });
    expect(t.columns).toEqual(['After', 'merged', 'closed unmerged', 'still open']);
    expect(t.rows).toEqual([
      { head: '1 hour', cells: ['0%', '0%', '100%'] },
      { head: '24 hours', cells: ['25%', '0%', '75%'] },
      { head: '2 days', cells: ['25%', '0%', '75%'] },
      { head: '7 days', cells: ['75%', '25%', '0%'] },
    ]);
  });

  it('reads every share out at a day', () => {
    expect(curveReadout(merge, 30)).toEqual([
      { label: 'merged', value: '25%', color: 'var(--series-1)', mark: 'line', shape: 'circle' },
      { label: 'closed unmerged', value: '25%', color: 'var(--series-2)', mark: 'line', shape: 'square' },
      { label: 'still open', value: '50%', color: 'var(--series-3)', mark: 'line', shape: 'triangle' },
    ]);
  });

  it('keeps one row when the longest duration reads the same as a milestone', () => {
    const t = curveTable({ ...merge, days: [1, 2.5, 7.01] });
    expect(t.rows.map((r) => r.head)).toEqual(['1 hour', '24 hours', '2 days', '7 days']);
    expect(t.rows.at(-1)?.cells).toEqual(['75%', '25%', '0%']);
  });

  it('lists every outcome as a line', () => {
    expect(curveLegend(merge).map((l) => [l.label, l.mark, l.shape])).toEqual([
      ['merged', 'line', 'circle'],
      ['closed unmerged', 'line', 'square'],
      ['still open', 'line', 'triangle'],
    ]);
  });

  it('states the share reached within the first hour, where the log time axis begins', () => {
    const quick: CurveModel = {
      days: [0.01, 0.5, 3],
      series: [{ key: 'done', label: 'opened', color: 'var(--series-3)', shape: 'circle', values: [0.5, 0.75, 1], remains: false }],
    };
    expect(describeCurve(quick, { median: 'under 1 hour', p90: '3 days' })).toBe(
      'Median under 1 hour; 90th percentile 3 days. Within 1 hour, 50% opened. ' +
        'After 3 days, the longest measured: 100% opened.',
    );
  });

  it('states the quantiles and the shares at the longest duration', () => {
    expect(describeCurve(merge, { median: '40 days', p90: 'not yet known' })).toBe(
      'Median 40 days; 90th percentile not yet known. ' +
        'After 40 days, the longest measured: 75% merged, 25% closed unmerged, 0% still open.',
    );
  });
});
