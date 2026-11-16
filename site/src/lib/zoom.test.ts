import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import { memoryLocation, meta } from './__fixtures__/page';
import { DAY, dayStart } from './filters';
import { timeColumns } from './plot';
import { type HashLocation, createStateStore, dataDays } from './state';
import { buckets } from './stats/buckets';
import { DRAG_THRESHOLD, columnAxis, dragRange, linearAxis, periodZoom, zoomOutRange } from './zoom';

const day = (s: string) => dayStart(s) as number;
const WHOLE = { first: '2011-03-15', last: '2026-11-15' };

/** The axis of a chart 640px wide over the period, its buckets as the charts draw them. */
function axisOver(from: string, to: string) {
  const b = buckets({ start: day(from), end: day(to) + DAY });
  const cols = timeColumns(640, b.starts.length);
  return { b, cols, axis: columnAxis(cols, b.starts, b.step) };
}

describe('dragRange', () => {
  it('snaps a drag over weeks outward to whole weeks, Monday to Sunday', () => {
    const { cols, axis } = axisOver('2026-05-15', '2026-11-15');
    expect(axis.step).toBe('week');
    // From inside the third week (from Mon 2026-05-25) to inside the fifth (from Mon 2026-06-08).
    const range = dragRange(axis, cols.centre(2), cols.centre(4), WHOLE);
    expect(range).toEqual({ from: '2026-05-25', to: '2026-06-14' });
  });

  it('snaps a drag over months outward to whole months', () => {
    const { b, cols, axis } = axisOver('2011-03-15', '2026-11-15');
    expect(axis.step).toBe('month');
    const i = b.starts.indexOf(Date.UTC(2024, 1, 1) / 1000);
    const range = dragRange(axis, cols.start(i) + 1, cols.start(i + 3) - 1, WHOLE);
    expect(range).toEqual({ from: '2024-02-01', to: '2024-04-30' });
  });

  it('is the same range dragged either way', () => {
    const { cols, axis } = axisOver('2026-05-15', '2026-11-15');
    expect(dragRange(axis, cols.centre(4), cols.centre(2), WHOLE)).toEqual(dragRange(axis, cols.centre(2), cols.centre(4), WHOLE));
  });

  it('counts a drag past the plot to its edge, and never leaves the data', () => {
    const { cols, axis } = axisOver('2011-03-15', '2026-11-15');
    // The first month starts before the window, the last ends after the last fetch.
    expect(dragRange(axis, -200, cols.right + 200, WHOLE)).toEqual({ from: '2011-03-15', to: '2026-11-15' });
    const weekly = axisOver('2026-05-15', '2026-11-15');
    expect(dragRange(weekly.axis, weekly.cols.right + 50, weekly.cols.centre(weekly.b.starts.length - 2), { first: '2026-05-15', last: '2026-11-15' })).toEqual({
      from: '2026-11-02',
      to: '2026-11-15',
    });
  });

  it('is a click, and no range, below the threshold', () => {
    const { cols, axis } = axisOver('2026-05-15', '2026-11-15');
    const x = cols.centre(3);
    expect(dragRange(axis, x, x + DRAG_THRESHOLD - 1, WHOLE)).toBeNull();
    expect(dragRange(axis, x, x - DRAG_THRESHOLD + 1, WHOLE)).toBeNull();
    expect(dragRange(axis, x, x + DRAG_THRESHOLD, WHOLE)).not.toBeNull();
  });

  it('gives one whole bucket for a drag inside one', () => {
    const { cols, axis } = axisOver('2026-05-15', '2026-11-15');
    expect(dragRange(axis, cols.start(3) + 1, cols.start(3) + cols.step - 1, WHOLE)).toEqual({ from: '2026-06-01', to: '2026-06-07' });
  });

  it('maps a continuous axis over the period, snapped to its step', () => {
    const period = { start: day('2026-05-15'), end: day('2026-11-15') + DAY };
    const axis = linearAxis(44, 632, period, 'week');
    expect(dragRange(axis, 44, 632, WHOLE)).toEqual({ from: '2026-05-11', to: '2026-11-15' });
    const mid = (t: number) => 44 + ((t - period.start) / (period.end - period.start)) * 588;
    expect(dragRange(axis, mid(day('2026-07-08')), mid(day('2026-07-22')), WHOLE)).toEqual({ from: '2026-07-06', to: '2026-07-26' });
  });
});

describe('zoomOutRange', () => {
  it('doubles the period around its centre', () => {
    expect(zoomOutRange({ from: '2024-03-01', to: '2024-04-30' }, WHOLE)).toEqual({ from: '2024-01-30', to: '2024-05-31' });
  });

  it('clamps to the data', () => {
    expect(zoomOutRange({ from: '2011-04-01', to: '2011-06-30' }, WHOLE)).toEqual({ from: '2011-03-15', to: '2011-08-15' });
    expect(zoomOutRange({ from: '2020-01-01', to: '2026-11-01' }, WHOLE)).toEqual({ from: '2016-07-31', to: '2026-11-15' });
  });

  it('is nothing over the whole window', () => {
    expect(zoomOutRange({ from: WHOLE.first, to: WHOLE.last }, WHOLE)).toBeNull();
  });
});

/** A location that remembers each write and whether it added an entry. */
function historyLocation(initial: string): HashLocation & { writes: { hash: string; push: boolean }[] } {
  const loc = memoryLocation(initial);
  const writes: { hash: string; push: boolean }[] = [];
  return {
    ...loc,
    writes,
    push: (h) => {
      writes.push({ hash: h, push: true });
      loc.push(h);
    },
    replace: (h) => {
      writes.push({ hash: h, push: false });
      loc.replace(h);
    },
  };
}

function setup(hash = '') {
  const loc = historyLocation(hash);
  const selection = createStateStore(meta, loc);
  loc.writes.length = 0;
  return { loc, selection, zoom: periodZoom({ meta, selection }) };
}

describe('periodZoom', () => {
  it('is one per page', () => {
    const { selection, zoom } = setup();
    expect(periodZoom({ meta, selection })).toBe(zoom);
    expect(zoom.days).toEqual(dataDays(meta));
  });

  it('sets the period through the state, as a new history entry with the period in the address', () => {
    const { loc, selection, zoom } = setup();
    zoom.to({ from: '2026-06-01', to: '2026-06-28' });
    expect(get(selection).filters).toMatchObject({ from: '2026-06-01', to: '2026-06-28' });
    expect(loc.writes).toEqual([{ hash: '#/?target=main&from=2026-06-01&to=2026-06-28', push: true }]);
  });

  it('announces the period it set until the state next changes', () => {
    const { selection, zoom } = setup();
    expect(get(zoom.zoomed)).toBeNull();
    zoom.to({ from: '2026-06-01', to: '2026-06-28' });
    expect(get(zoom.zoomed)).toEqual({ from: '2026-06-01', to: '2026-06-28' });
    selection.update((s) => ({ ...s, pr: 1 }));
    expect(get(zoom.zoomed)).toBeNull();
  });

  it('clears a selected week the zoomed period leaves out, as any change of the period does, and keeps one inside it', () => {
    const { selection, zoom } = setup('#/?week=2026-06-01');
    expect(get(selection).week).toBe('2026-06-01');
    zoom.to({ from: '2026-05-25', to: '2026-06-14' });
    expect(get(selection).week).toBe('2026-06-01');
    zoom.to({ from: '2026-07-06', to: '2026-07-26' });
    expect(get(selection).week).toBeNull();
  });

  it('zooms out on a double-click, undoing what its first click chose and taking that click\'s history entry', () => {
    const { loc, selection, zoom } = setup('#/?from=2026-06-01&to=2026-06-28');
    loc.writes.length = 0;
    const before = zoom.current();
    // The first click of the double-click selects a week.
    selection.update((s) => ({ ...s, week: '2026-06-08' }));
    zoom.out(before);
    const s = get(selection);
    expect(s.filters).toMatchObject({ from: '2026-05-18', to: '2026-07-12' });
    expect(s.week).toBeNull();
    expect(loc.writes.map((w) => w.push)).toEqual([true, false]);
    expect(get(zoom.zoomed)).toEqual({ from: '2026-05-18', to: '2026-07-12' });
  });

  it('adds an entry for a zoom-out whose first click changed nothing', () => {
    const { loc, zoom } = setup('#/?from=2026-06-01&to=2026-06-28');
    loc.writes.length = 0;
    zoom.out(zoom.current());
    expect(loc.writes.map((w) => w.push)).toEqual([true]);
  });

  it('does not change the period over the whole window', () => {
    const { loc, selection, zoom } = setup();
    const before = zoom.current();
    selection.update((s) => ({ ...s, week: '2026-06-01' }));
    zoom.out(before);
    expect(get(selection)).toEqual(before);
    expect(get(zoom.zoomed)).toBeNull();
    expect(loc.writes.at(-1)?.push).toBe(false);
  });
});
