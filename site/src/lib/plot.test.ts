import { scaleBand } from 'd3-scale';
import { describe, expect, it } from 'vitest';
import { bucketTick } from './format';
import {
  type BucketTick,
  LABEL_GAP,
  barPath,
  bucketTicks,
  durationTicks,
  glyphWidth,
  logDays,
  markerPath,
  spaceTicks,
  tickStride,
} from './plot';
import { buckets } from './stats/buckets';

describe('barPath', () => {
  it('rounds the data end and keeps the baseline square', () => {
    expect(barPath(10, 20, 8, 30, 4)).toBe('M10,50V24A4,4 0 0 1 14,20H14A4,4 0 0 1 18,24V50Z');
  });

  it('draws a plain rectangle with no radius', () => {
    expect(barPath(10, 20, 8, 30, 0)).toBe('M10,50V20H18V50Z');
  });

  it('shrinks the radius to fit a short or narrow bar', () => {
    expect(barPath(0, 0, 8, 2, 4)).toBe('M0,2V2A2,2 0 0 1 2,0H6A2,2 0 0 1 8,2V2Z');
    expect(barPath(0, 0, 4, 30, 4)).toBe('M0,30V2A2,2 0 0 1 2,0H2A2,2 0 0 1 4,2V30Z');
  });

  it('draws nothing for an empty bar', () => {
    expect(barPath(0, 0, 8, 0, 4)).toBe('');
  });
});

describe('tickStride', () => {
  it('labels every bucket when each is wide enough', () => {
    expect(tickStride(60, 48)).toBe(1);
  });

  it('skips buckets so labels do not run together', () => {
    expect(tickStride(20, 48)).toBe(3);
    expect(tickStride(0, 48)).toBe(1);
  });
});

describe('markerPath', () => {
  it('draws a different path for each shape', () => {
    const paths = (['circle', 'square', 'triangle', 'diamond'] as const).map((s) => markerPath(s));
    expect(new Set(paths).size).toBe(4);
    for (const p of paths) expect(p).toMatch(/^M/);
  });
});

describe('durations on a log axis', () => {
  it('runs from one hour to the longest duration, and at least to a day', () => {
    expect(logDays(40)).toEqual([1 / 24, 40]);
    expect(logDays(0.2)).toEqual([1 / 24, 1]);
    expect(logDays(0)).toEqual([1 / 24, 1]);
  });

  it('ticks the round durations in range, with their units', () => {
    expect(durationTicks(1 / 24, 40)).toEqual([
      { days: 1 / 24, label: '1 hour' },
      { days: 1, label: '1 day' },
      { days: 7, label: '1 week' },
      { days: 30, label: '1 month' },
    ]);
    expect(durationTicks(1 / 24, 1400).map((t) => t.label)).toEqual([
      '1 hour',
      '1 day',
      '1 week',
      '1 month',
      '3 months',
      '1 year',
      '2 years',
    ]);
    expect(durationTicks(1 / 24, 1).map((t) => t.label)).toEqual(['1 hour', '1 day']);
  });

  it('ticks ages of years, so an axis reaching six years or fifteen is labelled near its top', () => {
    expect(durationTicks(1 / 24, 6 * 365).map((t) => t.label).slice(-3)).toEqual(['1 year', '2 years', '5 years']);
    expect(durationTicks(1 / 24, 16 * 365).map((t) => t.label).slice(-4)).toEqual(['1 year', '2 years', '5 years', '10 years']);
    expect(durationTicks(1 / 24, 5 * 365).at(-1)).toEqual({ days: 5 * 365, label: '5 years' });
    // Past a year, the top tick is never less than two fifths of the axis's top, up to twenty years.
    for (let max = 365; max <= 20 * 365; max *= 1.05) {
      const top = durationTicks(1 / 24, max).at(-1)?.days ?? 0;
      expect(top, `${max.toFixed(1)} days`).toBeGreaterThanOrEqual(max / 2.5);
    }
  });
});

describe('spaceTicks', () => {
  it('drops a tick that would sit closer than the gap to the last one kept', () => {
    const ticks = [
      { at: 0, label: '1 hour' },
      { at: 100, label: '1 day' },
      { at: 150, label: '1 week' },
      { at: 190, label: '1 month' },
      { at: 230, label: '3 months' },
    ];
    // 1 month is 40 from 1 week; 3 months is then 80 from it.
    expect(spaceTicks(ticks, 48).map((t) => t.label)).toEqual(['1 hour', '1 day', '1 week', '3 months']);
  });

  it('measures the gap either way along the axis', () => {
    const down = [
      { at: 200, label: 'a' },
      { at: 190, label: 'b' },
      { at: 100, label: 'c' },
    ];
    expect(spaceTicks(down, 14).map((t) => t.label)).toEqual(['a', 'c']);
  });
});

// The time axis of a bucket chart (BucketChart.svelte): bands from x = 44 to
// the width less 8, inner padding 0.25 and outer 0.1, each label centred on
// its band, over the widths a chart takes, from a phone's to a wide desktop's.
describe('bucketTicks', () => {
  const day = (s: string) => Date.parse(`${s}T00:00:00Z`) / 1000;
  const bucketsOf = (from: string, to: string) => buckets({ start: day(from), end: day(to) + 86_400 });
  const centres = (n: number, width: number) => {
    const x = scaleBand<number>()
      .domain(Array.from({ length: n }, (_, i) => i))
      .range([44, width - 8])
      .paddingInner(0.25)
      .paddingOuter(0.1);
    return (i: number) => (x(i) as number) + x.bandwidth() / 2;
  };
  const WIDTHS = Array.from({ length: (1600 - 320) / 20 + 1 }, (_, k) => 320 + 20 * k);
  const PERIODS: Record<'six months' | 'two years' | 'six years' | 'fifteen years', readonly [string, string]> = {
    'six months': ['2026-05-15', '2026-11-15'],
    'two years': ['2024-11-16', '2026-11-15'],
    'six years': ['2020-11-16', '2026-11-15'],
    'fifteen years': ['2011-09-01', '2026-11-15'],
  };
  const ticksAt = (period: keyof typeof PERIODS, width: number) => {
    const b = bucketsOf(...PERIODS[period]);
    const at = centres(b.starts.length, width);
    return { b, at, ticks: bucketTicks(b.starts, b.step, at, glyphWidth) };
  };
  const month = (t: number) => new Date(t * 1000).getUTCMonth();
  const year = (t: number) => new Date(t * 1000).getUTCFullYear();

  it('keeps the six-month default’s weekly labels as they were, every n-th week from the first', () => {
    for (const width of WIDTHS) {
      const { b, at, ticks } = ticksAt('six months', width);
      expect(b.step).toBe('week');
      const stride = tickStride(at(1) - at(0), 52);
      expect(ticks).toEqual(b.starts.flatMap((s, i) => (i % stride === 0 ? [{ i, label: bucketTick(s, 'week') }] : [])));
    }
    // As the released build drew them on a 1054px chart and on a 335px one.
    const pin = (bandStep: number) =>
      bucketTicks(bucketsOf(...PERIODS['six months']).starts, 'week', (i) => i * bandStep, glyphWidth).map((t) => t.label);
    expect(pin(37.2)).toEqual([
      '11 May',
      '25 May',
      '8 Jun',
      '22 Jun',
      '6 Jul',
      '20 Jul',
      '3 Aug',
      '17 Aug',
      '31 Aug',
      '14 Sep',
      '28 Sep',
      '12 Oct',
      '26 Oct',
      '9 Nov',
    ]);
    expect(pin(9.6)).toEqual(['11 May', '22 Jun', '3 Aug', '14 Sep', '26 Oct']);
  });

  for (const period of Object.keys(PERIODS) as (keyof typeof PERIODS)[]) {
    it(`never lets two labels come within ${LABEL_GAP}px over ${period}, at any width`, () => {
      for (const width of WIDTHS) {
        const { at, ticks } = ticksAt(period, width);
        for (let k = 1; k < ticks.length; k++) {
          const a = ticks[k - 1] as BucketTick;
          const c = ticks[k] as BucketTick;
          const gap = at(c.i) - at(a.i) - (glyphWidth(a.label) + glyphWidth(c.label)) / 2;
          expect(gap, `${period} at ${width}px: ${a.label} | ${c.label}`).toBeGreaterThanOrEqual(LABEL_GAP);
        }
      }
    });
  }

  for (const period of ['two years', 'six years', 'fifteen years'] as const) {
    it(`puts the ticks over ${period} on a calendar grid, a year's on January, and names the year where it changes`, () => {
      for (const width of WIDTHS) {
        const { b, ticks } = ticksAt(period, width);
        const where = `${period} at ${width}px: ${ticks.map((t) => t.label).join(', ')}`;
        expect(b.step).toBe('month');
        // A tick on the period's first month may stand off the grid, to name its year.
        const grid = ticks.filter((t, k) => !(k === 0 && t.i === 0));
        const months = grid.map((t) => year(b.starts[t.i] as number) * 12 + month(b.starts[t.i] as number));
        const steps = new Set(months.slice(1).map((m, k) => m - (months[k] as number)));
        expect(steps.size, where).toBeLessThanOrEqual(1);
        const every = [...steps][0] ?? 12;
        expect([1, 3, 6, 12, 24, 60, 120], where).toContain(every);
        for (const m of months) expect(m % every, where).toBe(0);
        // The first tick, and each tick in a year the one before is not in, carries the year.
        ticks.forEach((t, k) => {
          const y = year(b.starts[t.i] as number);
          const named = k === 0 || y !== year(b.starts[(ticks[k - 1] as BucketTick).i] as number);
          if (named) expect(t.label, where).toMatch(new RegExp(`(^| )${y}$`));
          else expect(t.label, where).toMatch(/^[A-Z][a-z]{2}$/);
        });
      }
    });
  }

  it('names every year whose January the period holds, wherever a tick a year fits', () => {
    for (const period of ['two years', 'six years', 'fifteen years'] as const) {
      for (const width of WIDTHS) {
        const { b, ticks } = ticksAt(period, width);
        const januaries = b.starts.filter((s, i) => i > 0 && month(s) === 0).map(year);
        const named = new Set(ticks.map((t) => Number(/(\d{4})$/.exec(t.label)?.[1])));
        const grid = ticks.filter((t, k) => !(k === 0 && t.i === 0)).length;
        if (grid >= januaries.length) {
          for (const y of januaries) expect(named.has(y), `${period} at ${width}px: ${y}`).toBe(true);
        }
      }
    }
    // Six years name every year at every width; fifteen from a chart 640px wide.
    for (const [period, from] of [
      ['six years', 320],
      ['fifteen years', 640],
    ] as const) {
      for (const width of WIDTHS.filter((w) => w >= from)) {
        const { b, ticks } = ticksAt(period, width);
        const januaries = b.starts.filter((s, i) => i > 0 && month(s) === 0).length;
        expect(ticks.length, `${period} at ${width}px`).toBeGreaterThanOrEqual(januaries);
      }
    }
  });

  it('labels the whole window on a 1054px chart by year, on each January', () => {
    const { ticks } = ticksAt('fifteen years', 1054);
    expect(ticks.map((t) => t.label)).toEqual(Array.from({ length: 15 }, (_, k) => String(2012 + k)));
  });

  it('labels two years on a 1054px chart by quarter, with the year on the first tick and on each January', () => {
    const { ticks } = ticksAt('two years', 1054);
    expect(ticks.map((t) => t.label)).toEqual(['Nov 2024', '2025', 'Apr', 'Jul', 'Oct', '2026', 'Apr', 'Jul', 'Oct']);
  });
});
