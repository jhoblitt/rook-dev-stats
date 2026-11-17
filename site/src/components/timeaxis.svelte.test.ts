// @vitest-environment jsdom
// The time-axis charts over the period read as one axis down the whole
// page: every one runs between the same left and right edges, a bucket is at
// the same x in each a section stacks, whichever has a partial last bucket
// or a scale of its own, and their tick labels agree.
import { cleanup, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import App from '../App.svelte';
import { withYears } from '../lib/__fixtures__/fetch';
import { fixturePage } from '../lib/__fixtures__/page';
import type { AreaModel, BucketModel } from '../lib/charts';
import { formatCount } from '../lib/format';
import { PLOT_LEFT, PLOT_RIGHT } from '../lib/plot';
import BucketChart from './charts/BucketChart.svelte';
import StackedArea from './charts/StackedArea.svelte';

beforeAll(() => {
  window.matchMedia = (query: string) =>
    ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Every chart measures `width`, as every chart a section stacks does in the browser. */
function atWidth(width: number) {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private readonly report: (entries: unknown[]) => void) {}
      observe() {
        this.report([{ borderBoxSize: [{ inlineSize: width }], contentRect: { width } }]);
      }
      disconnect() {}
    },
  );
}

/** The figures, by title, whose charts each section stacks on one time axis. */
const STACKS: Record<string, RegExp[]> = {
  Velocity: [/^PRs opened, merged and closed unmerged, per /, /^Open PRs at the end of each /],
  Review: [/^Review capacity against arrivals, per /, /^Human and bot reviews per /, /^Bot commands per /],
  'AI use': [/^Share of PRs opened that disclose AI use, per /, /^Share of PRs opened naming each tool, per /],
};

const num = (el: Element, name: string) => Number(el.getAttribute(name));

/** A chart's bucket centres, from its hit targets: one per bucket, or one per layer of each. */
function centres(svg: SVGElement): number[] {
  const xs = [...svg.querySelectorAll('.hit')].map((r) => num(r, 'x') + num(r, 'width') / 2);
  return [...new Set(xs)];
}

/** A chart's time-axis labels, each at its x, or null for a chart drawn without one. */
function ticks(svg: SVGElement): string[] | null {
  const axis = svg.querySelector('.axis-x');
  return axis === null ? null : [...axis.querySelectorAll('text')].map((t) => `${t.textContent}@${num(t, 'x').toFixed(1)}`);
}

/** The plot's left and right edges: its value axis's gridlines. */
function edges(svg: SVGElement): [number, number] {
  const line = svg.querySelector('.axis-y line') as Element;
  return [num(line, 'x1'), num(line, 'x2')];
}

const PERIODS = [
  { name: 'six months', hash: '#/', files: {} },
  { name: 'two years', hash: '#/?from=2024-11-15', files: withYears(2016, 1) },
  { name: 'ten years', hash: '#/', files: withYears(2016, 1) },
];

describe('the charts over the period share one time axis, within a section and across sections', () => {
  for (const width of [320, 390, 768, 1280, 1600]) {
    for (const period of PERIODS) {
      it(`at ${width} px over ${period.name}`, async () => {
        atWidth(width);
        render(App, (await fixturePage(period.hash, period.files)).props);
        await tick();
        for (const [section, titles] of Object.entries(STACKS)) {
          const svgs = titles.flatMap((title) => [
            ...screen.getByRole('figure', { name: title }).querySelectorAll<SVGElement>('svg[role="group"]'),
          ]);
          expect(svgs.length, section).toBeGreaterThanOrEqual(titles.length);
          const all = svgs.map(centres);
          const n = all[0]?.length ?? 0;
          expect(n, section).toBeGreaterThan(1);
          // The first and last bucket and three between, in each chart.
          const at = [0, Math.floor(n / 4), Math.floor(n / 2), Math.floor((3 * n) / 4), n - 1];
          const first = at.map((i) => all[0]?.[i] as number);
          for (const [k, c] of all.entries()) {
            expect(c, `${section}, chart ${k}`).toHaveLength(n);
            at.forEach((i, j) => expect(Math.abs((c[i] as number) - (first[j] as number)), `${section}, chart ${k}, bucket ${i}`).toBeLessThanOrEqual(0.5));
            expect(edges(svgs[k] as SVGElement), `${section}, chart ${k}, edges`).toEqual([PLOT_LEFT, width - PLOT_RIGHT]);
          }
          const labelled = svgs.map(ticks).filter((t): t is string[] => t !== null);
          expect(labelled.length, section).toBeGreaterThan(1);
          for (const t of labelled) expect(t, `${section}, tick labels`).toEqual(labelled[0]);
        }
      }, 30_000);
    }
  }

});

// A bar chart with a line, and an area chart, as Velocity's two charts are.
const at = (iso: string) => Date.parse(iso) / 1000;
const WEEKS = [at('2026-05-11T00:00:00Z'), at('2026-05-18T00:00:00Z'), at('2026-05-25T00:00:00Z')];
const counts: BucketModel = {
  step: 'week',
  buckets: WEEKS,
  bars: [{ key: 'opened', label: 'opened', color: 'var(--series-1)', values: [0, 2, 1] }],
  stackLabel: 'opened',
  lines: [{ key: 'merged', label: 'merged', color: 'var(--series-3)', shape: 'circle', values: [1, 0, 0] }],
  partial: [null, null, { days: 3, of: 7 }],
};
const backlog: AreaModel = {
  step: 'week',
  buckets: WEEKS,
  layers: [{ key: 'lt7', label: 'under 7 days', fill: 'var(--ordinal-1)', values: [1, 2, 0] }],
  totalLabel: 'open',
};

describe('a bar chart with a line and an area chart', () => {
  for (const width of [320, 390, 768, 1280, 1600]) {
    it(`at ${width} px, both run from the left margin to the right one, with every bucket at the same x`, async () => {
      atWidth(width);
      const onselect = () => {};
      const bars = render(BucketChart, {
        model: counts,
        format: formatCount,
        label: 'counts',
        panels: [{ keys: ['opened', 'merged'], unit: 'PRs' }],
        onselect,
      });
      const area = render(StackedArea, { model: backlog, label: 'backlog', selected: { bucket: null, key: null }, onselect });
      await tick();
      const [a, b] = [bars.container, area.container].map((c) => c.querySelector('svg[role="group"]') as SVGElement);
      expect(edges(a as SVGElement)).toEqual([PLOT_LEFT, width - PLOT_RIGHT]);
      expect(edges(b as SVGElement)).toEqual([PLOT_LEFT, width - PLOT_RIGHT]);
      const [ca, cb] = [centres(a as SVGElement), centres(b as SVGElement)];
      expect(ca).toHaveLength(3);
      ca.forEach((x, i) => expect(Math.abs(x - (cb[i] as number))).toBeLessThanOrEqual(0.5));
      expect(ticks(a as SVGElement)).toEqual(ticks(b as SVGElement));
    });
  }
});
