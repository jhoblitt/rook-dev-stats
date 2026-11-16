// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { createRawSnippet, tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { type AreaModel, type BucketModel, type CurveModel, type Panel, bucketLegend } from '../../lib/charts';
import { formatCount, formatDays } from '../../lib/format';
import { PLOT_RIGHT } from '../../lib/plot';
import BucketChart from './BucketChart.svelte';
import ChartFrame from './ChartFrame.svelte';
import StackedArea from './StackedArea.svelte';
import StepCurve from './StepCurve.svelte';

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

const waits: BucketModel = {
  step: 'week',
  buckets: WEEKS,
  bars: [],
  lines: [
    { key: '0.5', label: 'median', color: 'var(--text-muted)', shape: 'circle', values: [2, null, 4] },
    {
      key: '0.9',
      label: '90th percentile',
      color: 'var(--text-muted)',
      shape: 'square',
      dashed: true,
      values: [3, null, null],
      missing: [null, null, 'not reached: 80% merged'],
      unreached: [false, false, true],
    },
  ],
  notes: [null, 'not yet known', null],
  shade: [false, true, false],
  shadeLabel: 'not yet known',
};

const backlog: AreaModel = {
  step: 'week',
  buckets: WEEKS,
  layers: [
    { key: 'lt7', label: 'under 7 days', fill: 'var(--ordinal-1)', values: [1, 2, 0] },
    { key: 'gt90', label: 'over 90 days', fill: 'var(--ordinal-4)', values: [3, 3, 4] },
  ],
  totalLabel: 'open',
};

const merge: CurveModel = {
  days: [1, 2.5, 40],
  series: [
    { key: 'merged', label: 'merged', color: 'var(--series-1)', shape: 'circle', values: [0.25, 0.25, 0.75], remains: false },
    { key: 'open', label: 'still open', color: 'var(--series-3)', shape: 'triangle', values: [0.75, 0.5, 0.25], remains: true },
  ],
};

const stub = createRawSnippet(() => ({ render: () => '<p class="plot-stub">plot</p>' }));

describe('ChartFrame', () => {
  it('shows the title, the legend, the chart, a hidden summary and the table', () => {
    const { container } = render(ChartFrame, {
      title: 'PRs per week',
      summary: 'By week, 3 weeks.',
      empty: false,
      legend: [
        { label: 'not disclosed', mark: 'bar', color: 'var(--series-1)' },
        { label: 'disclosed', mark: 'bar', color: 'var(--series-2)' },
      ],
      table: { columns: ['Week', 'opened'], rows: [{ head: 'week of 2026-05-18', cells: ['3'] }] },
      children: stub,
    });
    const figure = screen.getByRole('figure', { name: 'PRs per week' });
    expect(figure.getAttribute('aria-describedby')).toBe(container.querySelector('.visually-hidden')?.id);
    expect(container.querySelector('.visually-hidden')?.textContent).toBe('By week, 3 weeks.');
    expect(within(screen.getByRole('list', { name: 'Legend' })).getAllByRole('listitem').map((li) => li.textContent?.trim())).toEqual([
      'not disclosed',
      'disclosed',
    ]);
    expect(container.querySelector('.plot-stub')).not.toBeNull();
    expect(screen.getByRole('table').textContent).toContain('week of 2026-05-18');
  });

  it('draws no legend box for a single series', () => {
    render(ChartFrame, {
      title: 'One',
      summary: 's',
      empty: false,
      legend: [{ label: 'merged', mark: 'bar', color: 'var(--series-1)' }],
      children: stub,
    });
    expect(screen.queryByRole('list', { name: 'Legend' })).toBeNull();
  });

  it('keeps a lone key for a mark that is not a series', () => {
    render(ChartFrame, {
      title: 'One',
      summary: 's',
      empty: false,
      legend: [{ label: 'partial week', mark: 'partial', color: 'var(--text-faint)' }],
      children: stub,
    });
    expect(within(screen.getByRole('list', { name: 'Legend' })).getByText('partial week')).not.toBeNull();
  });

  it("draws a partial bucket's key as the mark it explains: a faded bar, or a lone hollow marker", () => {
    const { container } = render(ChartFrame, {
      title: 'Two',
      summary: 's',
      empty: false,
      legend: [
        { label: 'partial week', mark: 'partial', color: 'var(--text-faint)' },
        { label: 'partial month', mark: 'partial', color: 'var(--text-muted)', shape: 'square' },
      ],
      children: stub,
    });
    const [bar, line] = [...container.querySelectorAll('.legend .key')];
    expect(bar?.querySelector('rect.faded')).not.toBeNull();
    expect(bar?.querySelector('.hollow')).toBeNull();
    expect(line?.querySelector('rect')).toBeNull();
    expect(line?.querySelector('path.hollow')?.getAttribute('style')).toContain('var(--text-muted)');
    expect(line?.querySelector('line')).not.toBeNull();
  });

  it('says "no PRs match" in place of the chart when the selection is empty', () => {
    const { container } = render(ChartFrame, {
      title: 'PRs per week',
      summary: 'By week, 3 weeks.',
      empty: true,
      table: { columns: ['Week'], rows: [] },
      children: stub,
    });
    expect(screen.getByRole('figure', { name: 'PRs per week' }).textContent).toContain('no PRs match');
    expect(container.querySelector('.plot-stub')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('says what is missing, in its own words, when PRs match but nothing can be measured', () => {
    const { container } = render(ChartFrame, {
      title: 'Time after first approval',
      summary: 's',
      empty: false,
      nothing: 'no PR opened in this period has been approved',
      children: stub,
    });
    const figure = screen.getByRole('figure', { name: 'Time after first approval' });
    expect(figure.textContent).toContain('no PR opened in this period has been approved');
    expect(figure.textContent).not.toContain('no PRs match');
    expect(container.querySelector('.plot-stub')).toBeNull();
  });

  it('prints a note under the title', () => {
    render(ChartFrame, { title: 'T', summary: 's', empty: false, note: 'For a backport, the first commit is the original work’s.', children: stub });
    expect(screen.getByRole('figure', { name: 'T' }).textContent).toContain('For a backport, the first commit is the original work’s.');
  });
});

describe('BucketChart', () => {
  function setup(
    props: Partial<{
      model: BucketModel;
      selected: number | null;
      panels: readonly Panel[];
      sharedScale: boolean;
      scale: 'linear' | 'logDays';
      unit: string;
      height: number;
    }> = {},
  ) {
    const onselect = vi.fn<(bucket: number) => void>();
    const r = render(BucketChart, { model: counts, format: formatCount, label: 'PRs', onselect, ...props });
    return { ...r, onselect };
  }

  it('draws one bar per non-zero segment and one path per line', () => {
    const { container } = setup();
    expect(container.querySelectorAll('.bar')).toHaveLength(3);
    expect(container.querySelectorAll('.line')).toHaveLength(1);
  });

  it('names each bucket with its exact values', () => {
    setup();
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'week of 2026-05-11: disclosed 0, not disclosed 0, opened 0, merged 1',
      'week of 2026-05-18: disclosed 1, not disclosed 2, opened 3, merged 0',
      'week of 2026-05-25: disclosed 0, not disclosed 1, opened 1, merged 0',
    ]);
  });

  it('shows the exact values on hover and on focus', async () => {
    const { container } = setup();
    const buttons = screen.getAllByRole('button');
    expect(container.querySelector('.tip')).toBeNull();
    await fireEvent.pointerEnter(buttons[1]!);
    expect(container.querySelector('.tip')?.textContent).toMatch(/week of 2026-05-18.*1.*disclosed.*2.*not disclosed.*3.*opened/s);
    await fireEvent.pointerLeave(buttons[1]!);
    expect(container.querySelector('.tip')).toBeNull();
    await fireEvent.focus(buttons[2]!);
    expect(container.querySelector('.tip')?.textContent).toContain('week of 2026-05-25');
  });

  it('moves the focus with the arrow keys and selects with Enter or a click', async () => {
    const { onselect } = setup();
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
    buttons[0]!.focus();
    await fireEvent.keyDown(buttons[0]!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(buttons[1]);
    await fireEvent.keyDown(buttons[1]!, { key: 'End' });
    expect(document.activeElement).toBe(buttons[2]);
    await fireEvent.keyDown(buttons[2]!, { key: 'Enter' });
    expect(onselect).toHaveBeenLastCalledWith(WEEKS[2]);
    await fireEvent.click(buttons[0]!);
    expect(onselect).toHaveBeenLastCalledWith(WEEKS[0]);
  });

  it('marks the selected bucket, which takes the focus first', () => {
    setup({ selected: WEEKS[1]! });
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
    expect(buttons.map((b) => b.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);
  });

  it('leaves a gap for a missing value and washes the buckets it shades', () => {
    const { container } = setup({ model: waits });
    const d = container.querySelector('.line')?.getAttribute('d') ?? '';
    expect(d.match(/M/g)).toHaveLength(2);
    expect(container.querySelectorAll('.shade')).toHaveLength(1);
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))[1]).toBe(
      'week of 2026-05-18: median not yet known, 90th percentile not yet known',
    );
  });

  it('marks a value not reached above the plot, apart from one not yet known, and dashes the second statistic', () => {
    const { container } = setup({ model: waits });
    expect(container.querySelectorAll('.unreached')).toHaveLength(1);
    expect(container.querySelectorAll('.line.dashed')).toHaveLength(1);
    expect(screen.getAllByRole('button')[2]?.getAttribute('aria-label')).toBe(
      'week of 2026-05-25: median 4, 90th percentile not reached: 80% merged',
    );
  });

  it('stacks panels on one time axis, bars and lines apart, with one hit target per bucket over all of them', async () => {
    const { container } = setup({
      model: { ...counts, partial: [{ days: 3, of: 7 }, null, null] },
      panels: [
        { keys: ['not-disclosed', 'disclosed'], unit: 'opened' },
        { keys: ['merged'], unit: 'merged' },
      ],
    });
    const [top, bottom] = [...container.querySelectorAll('.plot-panel')];
    expect(top?.querySelectorAll('.bar')).toHaveLength(3);
    expect(top?.querySelectorAll('.line')).toHaveLength(0);
    expect(bottom?.querySelectorAll('.bar')).toHaveLength(0);
    expect(bottom?.querySelectorAll('.line')).toHaveLength(1);
    expect(container.querySelectorAll('.axis-y')).toHaveLength(2);
    // Every bar sits above the break between the panels, every line point below it.
    const brk = Number(container.querySelector('.panel-base')?.getAttribute('y1'));
    const ys = (el: Element | null | undefined, re: RegExp) =>
      [...(el?.getAttribute('d') ?? '').matchAll(re)].map((m) => Number(m[1]));
    const barYs = [...(top?.querySelectorAll('.bar') ?? [])].flatMap((b) => ys(b, /M[\d.]+,([\d.]+)/g));
    expect(Math.max(...barYs)).toBeLessThanOrEqual(brk);
    expect(Math.min(...ys(bottom?.querySelector('.line'), /[\d.]+,([\d.]+)/g))).toBeGreaterThan(brk);
    // One hit target per bucket names both panels' values, partial included.
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(3);
    expect(buttons[0]?.getAttribute('aria-label')).toBe(
      'week of 2026-05-11, partial: 3 of 7 days: disclosed 0, not disclosed 0, opened 0, merged 1',
    );
    await fireEvent.focus(buttons[1]!);
    expect(container.querySelector('.tip')?.textContent).toMatch(/1.*disclosed.*2.*not disclosed.*3.*opened.*0.*merged/s);
  });

  it('shares one value scale across panels, or gives each its own', () => {
    const big: BucketModel = { ...counts, lines: [{ ...counts.lines[0]!, values: [400, 500, 600] }] };
    const panels = [
      { keys: ['not-disclosed', 'disclosed'], unit: 'opened' },
      { keys: ['merged'], unit: 'merged' },
    ];
    const tops = (c: HTMLElement) =>
      [...c.querySelectorAll('.axis-y')].map((a) => [...a.querySelectorAll('text:not(.unit)')].at(-1)?.textContent);
    const shared = setup({ model: big, panels });
    expect(tops(shared.container)).toEqual(['600', '600']);
    shared.unmount();
    const own = setup({ model: big, panels, sharedScale: false });
    // The bars' own scale runs 0–3, ticked at 0 and 2.
    expect(tops(own.container)).toEqual(['2', '600']);
  });

  it('draws a partial bucket\'s line value as a lone hollow marker, joined to nothing', () => {
    const rising: BucketModel = { ...counts, lines: [{ ...counts.lines[0]!, values: [5, 6, 0] }] };
    const { container } = setup({ model: { ...rising, partial: [{ days: 3, of: 7 }, null, { days: 1, of: 7 }] } });
    // Only the whole middle week is on the line, so the path is a single point.
    const d = container.querySelector('.line')?.getAttribute('d') ?? '';
    expect(d.match(/[ML]/g)).toEqual(['M']);
    expect(container.querySelectorAll('.marker.hollow')).toHaveLength(2);
  });

  it('gives a panel at least its asked-for value ticks', () => {
    // Ratios of 1.7 and 2.7 on a 0–3 scale, and a second panel of values under 1.
    const ratios: BucketModel = {
      ...counts,
      bars: [],
      lines: [
        { key: 'a', label: 'a', color: 'var(--text-muted)', shape: 'circle', values: [1.7, 2.2, 2.7] },
        { key: 'b', label: 'b', color: 'var(--text-muted)', shape: 'diamond', values: [0.4, 0.6, 0.5] },
      ],
    };
    const { container } = setup({
      model: ratios,
      height: 200,
      sharedScale: false,
      panels: [
        { keys: ['a'], unit: 'a', minTicks: 3 },
        { keys: ['b'], unit: 'b', minTicks: 3 },
      ],
    });
    const labels = [...container.querySelectorAll('.axis-y')].map((a) =>
      [...a.querySelectorAll('text:not(.unit)')].map((t) => t.textContent),
    );
    expect(labels[0]).toEqual(['0', '1', '2', '3']);
    expect(labels[1]?.length).toBeGreaterThanOrEqual(3);
  });

  it("says a panel's shorter unit where the chart is narrow", async () => {
    const panels = [{ keys: ['merged'], unit: 'merged PRs, at the end of each week', narrowUnit: "merged PRs, at week's end" }];
    const units = (c: HTMLElement) => [...c.querySelectorAll('.axis-y .unit')].map((u) => u.textContent);
    const wide = setup({ panels });
    expect(units(wide.container)).toEqual(['merged PRs, at the end of each week']);
    wide.unmount();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private readonly report: (entries: unknown[]) => void) {}
        observe() {
          this.report([{ borderBoxSize: [{ inlineSize: 390 }], contentRect: { width: 390 } }]);
        }
        disconnect() {}
      },
    );
    try {
      const narrow = setup({ panels });
      await tick();
      expect(units(narrow.container)).toEqual(["merged PRs, at week's end"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('leaves a line sharing a titled panel with bars to the legend, and runs the plot to its right edge', () => {
    const { container } = setup({ panels: [{ keys: ['not-disclosed', 'disclosed', 'merged'], unit: 'PRs' }] });
    const svg = container.querySelector('svg[role="group"]') as SVGElement;
    // The only words in the plot are its axes'.
    expect([...svg.querySelectorAll('text')].filter((t) => t.closest('.axis-x, .axis-y') === null)).toEqual([]);
    expect(Number(svg.querySelector('.axis-y line')?.getAttribute('x2'))).toBe(Number(svg.getAttribute('width')) - PLOT_RIGHT);
    expect(bucketLegend(counts)).toContainEqual({ label: 'merged', mark: 'line', color: 'var(--series-3)', shape: 'circle' });
  });

  it('neither draws a line marked undrawn nor scales to it, with or without panels', () => {
    const hidden: BucketModel = {
      ...counts,
      lines: [...counts.lines, { key: 'hidden', label: 'hidden', color: 'var(--text-muted)', shape: 'square', values: [900, 900, 900], undrawn: true }],
    };
    const top = (c: HTMLElement) => [...c.querySelectorAll('.axis-y text:not(.unit)')].at(-1)?.textContent;
    const bare = setup({ model: hidden });
    expect(bare.container.querySelectorAll('.line')).toHaveLength(1);
    expect(bare.container.querySelectorAll('.marker')).toHaveLength(3);
    expect(top(bare.container)).toBe('3');
    bare.unmount();
    const paneled = setup({ model: hidden, panels: [{ keys: ['merged', 'hidden'], unit: 'merged' }] });
    expect(paneled.container.querySelectorAll('.line')).toHaveLength(1);
    expect(top(paneled.container)).toBe('1');
  });

  it('draws durations on a log scale from one hour, ticked at round durations', () => {
    const { container } = setup({ model: waits, scale: 'logDays', unit: 'wait, log scale' });
    const labels = [...container.querySelectorAll('.axis-y text:not(.unit)')].map((t) => t.textContent);
    expect(labels).toEqual(['1 hour', '1 day']);
    expect(container.querySelector('.axis-y .unit')?.textContent).toBe('wait, log scale');
  });

  it('fades a partial bucket and says how much of it there is', async () => {
    // The first week has one of each, and only 3 of its 7 days.
    const bars = counts.bars.map((b) => ({ ...b, values: [1, ...b.values.slice(1)] }));
    const { container } = setup({ model: { ...counts, bars, partial: [{ days: 3, of: 7 }, null, null] } });
    expect(container.querySelectorAll('.bar.partial')).toHaveLength(2);
    expect(container.querySelectorAll('.bar')).toHaveLength(5);
    const first = screen.getAllByRole('button')[0]!;
    expect(first.getAttribute('aria-label')).toMatch(/^week of 2026-05-11, partial: 3 of 7 days: /);
    await fireEvent.pointerEnter(first);
    expect(container.querySelector('.tip')?.textContent).toContain('partial: 3 of 7 days');
  });
});

describe('StackedArea', () => {
  function setup(selected: { bucket: number | null; key: string | null } = { bucket: null, key: null }) {
    const onselect = vi.fn<(bucket: number, key: string) => void>();
    const r = render(StackedArea, { model: backlog, label: 'Backlog', selected, onselect });
    return { ...r, onselect };
  }

  it('draws one area per layer and names each layer of each bucket', () => {
    const { container } = setup();
    expect(container.querySelectorAll('.layer')).toHaveLength(2);
    const names = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(names).toHaveLength(6);
    expect(names).toContain('week of 2026-05-18, under 7 days: 2 of 5 open');
  });

  it('moves between buckets and layers with the arrow keys and selects a band', async () => {
    const { onselect } = setup();
    const first = screen.getByRole('button', { name: 'week of 2026-05-11, under 7 days: 1 of 4 open' });
    first.focus();
    await fireEvent.keyDown(first, { key: 'ArrowUp' });
    expect(document.activeElement?.getAttribute('aria-label')).toBe('week of 2026-05-11, over 90 days: 3 of 4 open');
    await fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(document.activeElement?.getAttribute('aria-label')).toBe('week of 2026-05-18, over 90 days: 3 of 5 open');
    await fireEvent.keyDown(document.activeElement!, { key: ' ' });
    expect(onselect).toHaveBeenLastCalledWith(WEEKS[1], 'gt90');
  });

  it('shows every layer of the bucket on focus', async () => {
    const { container } = setup();
    await fireEvent.focus(screen.getByRole('button', { name: 'week of 2026-05-25, over 90 days: 4 of 4 open' }));
    expect(container.querySelector('.tip')?.textContent).toMatch(/week of 2026-05-25.*4.*over 90 days.*0.*under 7 days.*4.*open/s);
  });

  it('marks the selected band', () => {
    setup({ bucket: WEEKS[2]!, key: 'lt7' });
    expect(screen.getByRole('button', { name: 'week of 2026-05-25, under 7 days: 0 of 4 open' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'true')).toHaveLength(1);
  });
});

/** The x of a path's last point. */
function lastX(d: string | null | undefined): number {
  const points = [...(d ?? '').matchAll(/([\d.]+),([\d.]+)/g)];
  return Number(points.at(-1)?.[1]);
}

/** The x of a marker's transform. */
function markerX(el: Element | undefined): number {
  return Number(el?.getAttribute('transform')?.match(/translate\(([\d.]+) /)?.[1]);
}

describe('StepCurve', () => {
  it('draws one step line per series on a log time axis from one hour, ticked at round durations', () => {
    const { container } = render(StepCurve, { model: merge, label: 'Time to merge', xUnit: 'time since opened' });
    expect(container.querySelectorAll('.line')).toHaveLength(2);
    // From one hour to the longest duration, 40 days.
    expect([...container.querySelectorAll('.axis-x text')].map((t) => t.textContent)).toEqual([
      '1 hour',
      '1 day',
      '1 week',
      '1 month',
    ]);
    expect(container.querySelector('.unit')?.textContent).toBe('time since opened, log scale');
  });

  it('starts a curve above zero at the hour when some PRs took less than that', () => {
    const quick: CurveModel = {
      days: [0.01, 0.5, 3],
      series: [{ key: 'done', label: 'opened', color: 'var(--series-3)', shape: 'circle', values: [0.5, 0.75, 1], remains: false }],
    };
    const { container } = render(StepCurve, { model: quick, label: 'First commit to opened', xUnit: 'time' });
    const d = container.querySelector('.line')?.getAttribute('d') ?? '';
    const [, x0, y0] = d.match(/^M([\d.]+),([\d.]+)/) ?? [];
    const half = Number(container.querySelectorAll('.axis-y text')[2]?.getAttribute('y'));
    // It begins at the left edge, at half way up: half were opened within the hour.
    expect(Number(x0)).toBe(44);
    expect(Number(y0)).toBeCloseTo(half, 1);
  });

  it('scrubs through the log axis with the keys, reading exact shares', async () => {
    const { container } = render(StepCurve, { model: merge, label: 'Time to merge', xUnit: 'time' });
    const slider = screen.getByRole('slider', { name: 'Time to merge' });
    expect(Number(slider.getAttribute('aria-valuemin'))).toBeCloseTo(1 / 24, 9);
    expect(slider.getAttribute('aria-valuemax')).toBe('40');
    expect(slider.getAttribute('aria-valuetext')).toBe('after 1 hour: merged 0%, still open 100%');
    await fireEvent.focus(slider);
    // Each key press moves a 48th of the axis: a factor of 960^(1/48).
    await fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(Number(slider.getAttribute('aria-valuenow'))).toBeCloseTo((1 / 24) * 960 ** (1 / 48), 5);
    await fireEvent.keyDown(slider, { key: 'End' });
    expect(slider.getAttribute('aria-valuenow')).toBe('40');
    expect(slider.getAttribute('aria-valuetext')).toBe('after 40 days: merged 75%, still open 25%');
    expect(container.querySelector('.tip')?.textContent).toMatch(/after 40 days.*75%.*merged.*25%.*still open/s);
    await fireEvent.keyDown(slider, { key: 'Home' });
    expect(slider.getAttribute('aria-valuetext')).toBe('after 1 hour: merged 0%, still open 100%');
  });

  it('stops each line at its own longest duration on a wider shared axis, and reads nothing past it', async () => {
    const { container } = render(StepCurve, { model: merge, label: 'Time to merge', xUnit: 'days', xMax: 80 });
    const end = container.querySelectorAll('.end-marker');
    expect(end).toHaveLength(2);
    // The line ends where its end marker sits, at day 40, short of the axis end, day 80.
    expect(lastX(container.querySelector('.line')?.getAttribute('d'))).toBeCloseTo(markerX(end[0]), 2);
    expect(markerX(end[0])).toBeLessThan(640 - 12 - 1);
    const slider = screen.getByRole('slider', { name: 'Time to merge' });
    await fireEvent.focus(slider);
    await fireEvent.keyDown(slider, { key: 'End' });
    expect(slider.getAttribute('aria-valuetext')).toBe('after 80 days: past the longest measured, 40 days');
    expect(container.querySelector('.tip')?.textContent).toContain('past the longest measured, 40 days');
  });
});
