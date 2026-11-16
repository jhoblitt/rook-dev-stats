// Zooming the period from a chart drawn over it: a drag across the plot sets
// the period to the buckets dragged over, and a double-click widens it. Both
// write the period through the state, as the filter bar does.

import { type Readable, get, writable } from 'svelte/store';
import { DAY, type Filters, dayOf, dayStart } from './filters';
import type { Page } from './page';
import type { TimeColumns } from './plot';
import { type AppState, dataDays } from './state';
import { type Period, type Step, bucketEnd, bucketStart } from './stats/buckets';

export type DayRange = Pick<Filters, 'from' | 'to'>;

/** The days a period may name, as `dataDays` gives them. */
export type DataDays = ReturnType<typeof dataDays>;

/** A plot's time axis as a drag reads it: its edges in pixels, its step, and the instant at a pixel inside them. */
export interface ZoomAxis {
  left: number;
  right: number;
  step: Step;
  at(x: number): number;
}

/** The axis of a chart drawn in columns: a pixel reads as the first instant of the bucket whose column holds it. */
export function columnAxis(cols: TimeColumns, starts: readonly number[], step: Step): ZoomAxis {
  return {
    left: cols.left,
    right: cols.right,
    step,
    at: (x) => starts[Math.min(starts.length - 1, Math.max(0, Math.floor((x - cols.left) / cols.step)))] as number,
  };
}

/** The axis of a chart drawn across the period continuously, `left` its start and `right` its end. */
export function linearAxis(left: number, right: number, period: Period, step: Step): ZoomAxis {
  return {
    left,
    right,
    step,
    at: (x) => {
      const f = Math.min(1, Math.max(0, (x - left) / Math.max(1, right - left)));
      return Math.min(period.end - 1, period.start + f * (period.end - period.start));
    },
  };
}

/** How far, in pixels, the pointer moves before a press is a drag rather than a click. */
export const DRAG_THRESHOLD = 5;

/**
 * The period a drag from `a` to `b` sets: from the first day of the bucket
 * under its left end to the last day of the bucket under its right end,
 * within the data's days. A drag past the plot counts to its edge; one
 * shorter than `threshold` is a click and sets nothing.
 */
export function dragRange(axis: ZoomAxis, a: number, b: number, days: DataDays, threshold = DRAG_THRESHOLD): DayRange | null {
  if (Math.abs(b - a) < threshold) return null;
  const edge = (x: number) => Math.min(axis.right, Math.max(axis.left, x));
  const start = bucketStart(axis.at(edge(Math.min(a, b))), axis.step);
  const end = bucketEnd(bucketStart(axis.at(edge(Math.max(a, b))), axis.step), axis.step);
  const from = Math.max(dayStart(days.first) as number, start);
  const to = Math.min(dayStart(days.last) as number, end - DAY);
  return to < from ? null : { from: dayOf(from), to: dayOf(to) };
}

/**
 * The period twice as long as `period` around its centre, in whole days,
 * within the data's days; null when `period` is already all of them.
 */
export function zoomOutRange(period: DayRange, days: DataDays): DayRange | null {
  const start = dayStart(period.from) as number;
  const end = (dayStart(period.to) as number) + DAY;
  const first = dayStart(days.first) as number;
  const after = (dayStart(days.last) as number) + DAY;
  if (start <= first && end >= after) return null;
  const half = (end - start) / 2;
  const from = Math.max(first, Math.floor((start - half) / DAY) * DAY);
  const to = Math.min(after, Math.ceil((end + half) / DAY) * DAY) - DAY;
  return { from: dayOf(from), to: dayOf(to) };
}

export interface PeriodZoom {
  days: DataDays;
  /** The state as it is now. */
  current(): AppState;
  /** Sets the period to `range`, as a new history entry. */
  to(range: DayRange): void;
  /**
   * Widens the period, as `zoomOutRange` does, for a double-click. `before`
   * is the state before the double-click's first click: what that click
   * chose is undone, and its history entry, if it made one, is taken over,
   * so Back returns to the period before.
   */
  out(before: AppState | null): void;
  /** The period the last zoom set, until the state next changes, for the page to announce. */
  zoomed: Readable<DayRange | null>;
}

const zooms = new WeakMap<Page['selection'], PeriodZoom>();

/** The page's zoom: one per state store, so every chart and the status line share it. */
export function periodZoom(page: Pick<Page, 'meta' | 'selection'>): PeriodZoom {
  const have = zooms.get(page.selection);
  if (have) return have;
  const { selection } = page;
  const days = dataDays(page.meta);
  const zoomed = writable<DayRange | null>(null);
  // Any change after a zoom, a later zoom's own included, ends what it announces.
  selection.subscribe(() => zoomed.set(null));
  const announce = (was: AppState) => {
    const now = get(selection);
    if (now !== was) zoomed.set({ from: now.filters.from, to: now.filters.to });
  };
  const zoom: PeriodZoom = {
    days,
    current: () => get(selection),
    to: (range) => {
      const was = get(selection);
      selection.update((s) => ({ ...s, filters: { ...s.filters, ...range } }));
      announce(was);
    },
    out: (before) => {
      const now = get(selection);
      const base = before ?? now;
      const replace = base !== now;
      const range = zoomOutRange(now.filters, days);
      if (range === null) {
        if (replace) selection.set(base, { replace });
        return;
      }
      selection.set({ ...base, filters: { ...now.filters, ...range } }, { replace });
      announce(now);
    },
    zoomed,
  };
  zooms.set(selection, zoom);
  return zoom;
}
