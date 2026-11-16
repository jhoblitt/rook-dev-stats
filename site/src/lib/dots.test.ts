import { describe, expect, it } from 'vitest';
import { DOT_KIND, describeDots, dotLayout, dotReadout, dots, dotsTable, indexDots, nearestDot, project } from './dots';
import { periodRange } from './filters';
import { HOUR, LABEL_GAP, glyphWidth } from './plot';
import { openedIn, select } from './select';
import { defaultFilters } from './state';
import { META, at, dataset, fixture, random } from './stats/testing';

const DAY = 86_400;
const data = fixture();
const filters = defaultFilters(META);
const period = periodRange(filters);
const opened = openedIn(data, select(data, filters), period);

describe('dots', () => {
  const d = dots(data, opened);
  const numbers = [...d.rows].map((r) => data.prs.number[r]);

  it('takes each PR opened in the period, those not disclosing first so the disclosing draw on top', () => {
    expect(numbers).toEqual([66510, 66600, 66700, 66900, 66500, 67000, 67100]);
    expect([...d.disclosed]).toEqual([0, 0, 0, 0, 1, 1, 1]);
  });

  it('places a finished PR at its days to the final disposition and an open one at its age', () => {
    // 66510 closed after 11.875 days; 66600 and 66700 open on 2026-11-15 06:00; 66900 merged after 48 days.
    expect([...d.kind]).toEqual([
      DOT_KIND.closed,
      DOT_KIND.open,
      DOT_KIND.open,
      DOT_KIND.merged,
      DOT_KIND.merged,
      DOT_KIND.merged,
      DOT_KIND.merged,
    ]);
    expect(d.days[0]).toBeCloseTo(11.875, 9);
    expect(d.days[1]).toBeCloseTo((1794722400 - 1780383600) / DAY, 9);
    expect(d.days[3]).toBe(48);
    expect(d.days[5]).toBe(13);
    expect(d.longest).toBe(d.days[1]);
    expect(d.unknown).toBe(0);
  });

  it('leaves off a finished PR with no time of final disposition, counting it', () => {
    const t = at('2026-06-01T00:00:00Z');
    const odd = dots(dataset([{ created: t, state: 1, closed: -1 }, { created: t, state: 1, closed: t + DAY }]), Uint32Array.of(0, 1));
    expect([...odd.rows]).toEqual([1]);
    expect(odd.unknown).toBe(1);
  });

  it('clamps a disposition before the opening to zero, never negative', () => {
    const t = at('2026-06-01T00:00:00Z');
    const odd = dots(dataset([{ created: t, state: 2, closed: t - 60 }]), Uint32Array.of(0));
    expect(odd.days[0]).toBe(0);
  });
});

describe('dotLayout', () => {
  const layout = dotLayout(period, 166, 640, 360);

  it('spans the period across and a log duration axis from one hour up', () => {
    expect(layout.x(period.start)).toBe(layout.left);
    expect(layout.x(period.end)).toBe(layout.right);
    expect(layout.y(HOUR)).toBe(layout.bottom);
    expect(layout.y(166)).toBeCloseTo(layout.top, 9);
    // Anything shorter than an hour is drawn at the hour.
    expect(layout.y(0)).toBe(layout.bottom);
    expect(layout.yTicks.map((t) => t.label)).toEqual(['1 hour', '1 day', '1 week', '1 month', '3 months']);
  });

  it('labels a log duration axis reaching six years up to five years, its labels apart', () => {
    const whole = { start: at('2011-09-01T00:00:00Z'), end: at('2026-11-16T00:00:00Z') };
    const tall = dotLayout(whole, 6 * 365, 1054, 360);
    expect(tall.yTicks.map((t) => t.label)).toEqual(['1 hour', '1 day', '1 week', '1 month', '3 months', '1 year', '2 years', '5 years']);
    const gaps = tall.yTicks.slice(1).map((t, i) => (tall.yTicks[i]?.at ?? 0) - t.at);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(14);
  });

  it('ticks the months across, spaced so labels do not run together', () => {
    expect(layout.xTicks.map((t) => t.label)).toEqual(['Jun 2026', 'Jul 2026', 'Aug 2026', 'Sep 2026', 'Oct 2026', 'Nov 2026']);
    const narrow = dotLayout(period, 166, 300, 300);
    expect(narrow.xTicks.length).toBeLessThan(6);
    const gaps = narrow.xTicks.slice(1).map((t, i) => t.at - (narrow.xTicks[i]?.at ?? 0));
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(64);
  });

  it('ticks the weeks across a short period', () => {
    const short = dotLayout({ start: at('2026-06-01T00:00:00Z'), end: at('2026-06-29T00:00:00Z') }, 10, 640, 360);
    expect(short.xTicks.map((t) => t.label)).toEqual(['1 Jun', '8 Jun', '15 Jun', '22 Jun']);
  });

  it('ticks a period of years on a calendar grid, a year’s on January, its labels apart', () => {
    const whole = { start: at('2011-09-01T00:00:00Z'), end: at('2026-11-16T00:00:00Z') };
    const wide = dotLayout(whole, 166, 1054, 360);
    expect(wide.xTicks.map((t) => t.label)).toEqual(Array.from({ length: 15 }, (_, k) => String(2012 + k)));
    expect(wide.xTicks[0]?.at).toBeCloseTo(wide.x(at('2012-01-01T00:00:00Z')), 9);
    const two = dotLayout({ start: at('2024-11-16T00:00:00Z'), end: at('2026-11-16T00:00:00Z') }, 166, 1054, 360);
    // December 2024 is a month from January, too close to name it beside it.
    expect(two.xTicks.map((t) => t.label)).toEqual(['2025', 'Apr', 'Jul', 'Oct', '2026', 'Apr', 'Jul', 'Oct']);
    for (const width of [320, 515, 800, 1054, 1600]) {
      const l = dotLayout(whole, 166, width, 360);
      l.xTicks.slice(1).forEach((t, i) => {
        const prev = l.xTicks[i] as { at: number; label: string };
        const gap = t.at - prev.at - (glyphWidth(t.label) + glyphWidth(prev.label)) / 2;
        expect(gap, `${width}px: ${prev.label} | ${t.label}`).toBeGreaterThanOrEqual(LABEL_GAP);
      });
    }
  });
});

describe('finding the dot under the pointer', () => {
  it('finds the nearest dot within the radius, and none beyond it', () => {
    const xs = Float32Array.of(10, 30, 31, 200);
    const ys = Float32Array.of(10, 10, 10, 100);
    const index = indexDots(xs, ys, 300, 200, 16);
    expect(nearestDot(index, 12, 11, 12)).toBe(0);
    expect(nearestDot(index, 29, 10, 12)).toBe(1);
    expect(nearestDot(index, 195, 105, 12)).toBe(3);
    expect(nearestDot(index, 120, 60, 12)).toBe(-1);
  });

  it('prefers the dot drawn last, on top, when two are equally near', () => {
    const index = indexDots(Float32Array.of(50, 50), Float32Array.of(50, 50), 100, 100, 16);
    expect(nearestDot(index, 50, 50, 12)).toBe(1);
  });

  it('agrees with a search of every dot over 75,000 PRs', () => {
    const rand = random(7);
    const start = at('2026-01-01T00:00:00Z');
    const rows = Array.from({ length: 75_000 }, () => {
      const created = start + Math.floor(rand() * 300 * DAY);
      const state = Math.floor(rand() * 3);
      return { created, state, closed: state === 0 ? -1 : created + Math.floor(rand() * 200 * DAY), disclosure: rand() < 0.2 ? 3 : 0 };
    });
    const big = dataset(rows, [], { fetched_through: start + 320 * DAY });
    const all = Uint32Array.from({ length: big.size }, (_, i) => i);
    const d = dots(big, all);
    expect(d.rows.length).toBe(75_000);
    const layout = dotLayout({ start, end: start + 320 * DAY }, d.longest, 1200, 360);
    const { xs, ys } = project(d, layout);
    const index = indexDots(xs, ys, 1200, 360, 16);
    for (let k = 0; k < 200; k++) {
      const px = rand() * 1200;
      const py = rand() * 360;
      let best = -1;
      let bestD = 12 * 12;
      for (let i = 0; i < xs.length; i++) {
        const dx = (xs[i] as number) - px;
        const dy = (ys[i] as number) - py;
        const dd = dx * dx + dy * dy;
        if (dd <= bestD) {
          best = i;
          bestD = dd;
        }
      }
      expect(nearestDot(index, px, py, 12)).toBe(best);
    }
  });
});

describe('describing the dots', () => {
  const d = dots(data, opened);

  it('counts the PRs by state and disclosure, in words', () => {
    expect(describeDots(d)).toBe(
      '7 PRs opened in the period: 4 merged, 1 closed unmerged and 2 still open; 3 disclose AI use. ' +
        'Their days from opening to merging or closing run from 4 days to 48 days; an open PR is drawn at its age, up to 166 days.',
    );
  });

  it('tables them by disclosure and state', () => {
    expect(dotsTable(d)).toEqual({
      columns: ['PRs', 'merged', 'closed unmerged', 'still open', 'all'],
      rows: [
        { head: 'AI use not disclosed', cells: ['1', '1', '2', '4'] },
        { head: 'AI use disclosed', cells: ['3', '0', '0', '3'] },
        { head: 'all', cells: ['4', '1', '2', '7'] },
      ],
    });
  });

  it('reads one dot out: its number, opening, time and disclosure', () => {
    const i = [...d.rows].findIndex((r) => data.prs.number[r] === 66500);
    expect(dotReadout(data, d, i)).toEqual({
      title: '#66500',
      rows: [
        { label: 'opened', value: '2026-05-18', color: null, mark: 'total' },
        { label: 'to merge', value: '4 days', color: null, mark: 'total' },
        { label: 'AI use', value: 'disclosed', color: 'var(--series-2)', mark: 'line', shape: 'circle' },
      ],
    });
  });
});
