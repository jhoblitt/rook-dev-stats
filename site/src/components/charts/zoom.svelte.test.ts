// @vitest-environment jsdom
// Dragging across a chart over the period zooms the period to the buckets
// dragged over; a click is still a click. jsdom lays nothing out, so a
// pointer's clientX is its x in the plot, and the plot is 640px wide.
import { fireEvent, render, screen } from '@testing-library/svelte';
import { readable } from 'svelte/store';
import { describe, expect, it, vi } from 'vitest';
import type { AreaModel, BucketModel } from '../../lib/charts';
import { formatCount } from '../../lib/format';
import { timeColumns } from '../../lib/plot';
import type { AppState } from '../../lib/state';
import type { PeriodZoom } from '../../lib/zoom';
import BucketChart from './BucketChart.svelte';
import StackedArea from './StackedArea.svelte';

const at = (iso: string) => Date.parse(iso) / 1000;
const WEEKS = [at('2026-05-11T00:00:00Z'), at('2026-05-18T00:00:00Z'), at('2026-05-25T00:00:00Z')];
const cols = timeColumns(640, WEEKS.length);

const counts: BucketModel = {
  step: 'week',
  buckets: WEEKS,
  bars: [{ key: 'opened', label: 'opened', color: 'var(--series-1)', values: [1, 2, 1] }],
  lines: [],
};

const backlog: AreaModel = {
  step: 'week',
  buckets: WEEKS,
  layers: [{ key: 'lt7', label: 'under 7 days', fill: 'var(--ordinal-1)', values: [1, 2, 3] }],
  totalLabel: 'open',
};

function fakeZoom() {
  const state = { week: null } as AppState;
  return {
    state,
    zoom: {
      days: { first: '2026-05-13', last: '2026-05-31' },
      current: vi.fn(() => state),
      to: vi.fn(),
      out: vi.fn(),
      zoomed: readable(null),
    } satisfies PeriodZoom,
  };
}

function bucketChart() {
  const { zoom, state } = fakeZoom();
  const onselect = vi.fn<(bucket: number) => void>();
  const r = render(BucketChart, { model: counts, format: formatCount, label: 'PRs', onselect, zoom });
  return { ...r, onselect, zoom, state, buttons: screen.getAllByRole('button') };
}

const point = (x: number) => ({ clientX: x, clientY: 100, pointerId: 1, isPrimary: true, button: 0 });

async function drag(target: Element, from: number, to: number, release = true) {
  await fireEvent.pointerDown(target, point(from));
  await fireEvent.pointerMove(target, point((from + to) / 2));
  await fireEvent.pointerMove(target, point(to));
  if (release) await fireEvent.pointerUp(target, point(to));
}

describe('dragging across a chart', () => {
  it('shows a band with the snapped dates while dragging, and zooms to whole buckets on release', async () => {
    const { container, zoom, buttons } = bucketChart();
    await drag(buttons[0]!, cols.centre(0), cols.centre(1), false);
    const band = container.querySelector<HTMLElement>('.band');
    expect(band).not.toBeNull();
    expect(band!.style.left).toBe(`${cols.centre(0)}px`);
    expect(band!.style.width).toBe(`${cols.centre(1) - cols.centre(0)}px`);
    // The first week starts before the data, so the range starts where the data does.
    expect(container.querySelector('.band-dates')?.textContent).toBe('13 May 2026 – 24 May 2026');
    await fireEvent.pointerUp(buttons[1]!, point(cols.centre(1)));
    expect(zoom.to).toHaveBeenCalledExactlyOnceWith({ from: '2026-05-13', to: '2026-05-24' });
    expect(container.querySelector('.band')).toBeNull();
  });

  it('takes a drag the other way, and past the plot to its edge', async () => {
    const { zoom, buttons } = bucketChart();
    await drag(buttons[1]!, cols.centre(1), cols.right + 100);
    expect(zoom.to).toHaveBeenCalledExactlyOnceWith({ from: '2026-05-18', to: '2026-05-31' });
    await drag(buttons[2]!, cols.centre(2), cols.centre(1));
    expect(zoom.to).toHaveBeenLastCalledWith({ from: '2026-05-18', to: '2026-05-31' });
  });

  it('does not also select the bucket under the pointer when the drag ends', async () => {
    const { onselect, buttons } = bucketChart();
    await drag(buttons[0]!, cols.centre(0), cols.centre(1));
    await fireEvent.click(buttons[1]!, { detail: 1 });
    expect(onselect).not.toHaveBeenCalled();
    // The next click is a click again.
    await fireEvent.pointerDown(buttons[2]!, point(cols.centre(2)));
    await fireEvent.pointerUp(buttons[2]!, point(cols.centre(2)));
    await fireEvent.click(buttons[2]!, { detail: 1 });
    expect(onselect).toHaveBeenCalledExactlyOnceWith(WEEKS[2]);
  });

  it('is a click below the threshold: the bucket is selected as before and the period is left alone', async () => {
    const { container, onselect, zoom, buttons } = bucketChart();
    const x = cols.centre(1);
    await fireEvent.pointerDown(buttons[1]!, point(x));
    await fireEvent.pointerMove(buttons[1]!, point(x + 3));
    expect(container.querySelector('.band')).toBeNull();
    await fireEvent.pointerUp(buttons[1]!, point(x + 3));
    await fireEvent.click(buttons[1]!, { detail: 1 });
    expect(zoom.to).not.toHaveBeenCalled();
    expect(onselect).toHaveBeenCalledExactlyOnceWith(WEEKS[1]);
  });

  it('is cancelled by Escape, which neither zooms nor selects', async () => {
    const { container, onselect, zoom, buttons } = bucketChart();
    await drag(buttons[0]!, cols.centre(0), cols.centre(2), false);
    expect(container.querySelector('.band')).not.toBeNull();
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(container.querySelector('.band')).toBeNull();
    await fireEvent.pointerMove(buttons[2]!, point(cols.centre(2) + 20));
    expect(container.querySelector('.band')).toBeNull();
    await fireEvent.pointerUp(buttons[2]!, point(cols.centre(2)));
    await fireEvent.click(buttons[0]!, { detail: 1 });
    expect(zoom.to).not.toHaveBeenCalled();
    expect(onselect).not.toHaveBeenCalled();
  });

  it('is left alone by a pointer that is not the primary button', async () => {
    const { zoom, buttons } = bucketChart();
    await fireEvent.pointerDown(buttons[0]!, { ...point(cols.centre(0)), button: 2 });
    await fireEvent.pointerMove(buttons[0]!, point(cols.centre(2)));
    await fireEvent.pointerUp(buttons[0]!, point(cols.centre(2)));
    expect(zoom.to).not.toHaveBeenCalled();
  });

  it('zooms out on a double-click, from the state before its first click, which alone selects', async () => {
    const { onselect, zoom, state, buttons } = bucketChart();
    await fireEvent.click(buttons[1]!, { detail: 1 });
    await fireEvent.click(buttons[1]!, { detail: 2 });
    await fireEvent.dblClick(buttons[1]!, { clientX: cols.centre(1), clientY: 100 });
    expect(onselect).toHaveBeenCalledExactlyOnceWith(WEEKS[1]);
    expect(zoom.out).toHaveBeenCalledExactlyOnceWith(state);
  });

  it('marks the plot as one to drag across, and leaves a chart without a zoom as it was', async () => {
    const { container } = bucketChart();
    expect(container.querySelector('.brush.zoomable')).not.toBeNull();
    const onselect = vi.fn();
    const plain = render(BucketChart, { model: counts, format: formatCount, label: 'PRs', onselect });
    expect(plain.container.querySelector('.zoomable')).toBeNull();
    const hit = plain.container.querySelector('.hit')!;
    await drag(hit, cols.centre(0), cols.centre(2));
    expect(plain.container.querySelector('.band')).toBeNull();
  });
});

describe('dragging across the backlog chart', () => {
  it('zooms to the weeks dragged over', async () => {
    const { zoom } = fakeZoom();
    const onselect = vi.fn();
    render(StackedArea, { model: backlog, label: 'Backlog', selected: { bucket: null, key: null }, onselect, zoom });
    const cells = screen.getAllByRole('button');
    await drag(cells[1]!, cols.centre(1), cols.centre(2));
    await fireEvent.click(cells[2]!, { detail: 1 });
    expect(zoom.to).toHaveBeenCalledExactlyOnceWith({ from: '2026-05-18', to: '2026-05-31' });
    expect(onselect).not.toHaveBeenCalled();
  });
});
