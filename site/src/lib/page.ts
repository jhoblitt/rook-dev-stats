// What every view on the page shares, handed down through Svelte context so
// each section reads it in its own file and none is wired through another.

import { createContext } from 'svelte';
import { type Readable, get, writable } from 'svelte/store';
import { type DataLoader, type Dataset, type LoadError, type LoadResult, type Meta, combine, yearsFor } from './data';
import { type Filters, periodRange } from './filters';
import { keepEqual, sameFilters } from './memo';
import { select } from './select';
import type { AppState, StateStore } from './state';

/** How far a load has come: the years it loads, ascending, and how many of them have arrived. */
export interface LoadProgress {
  years: readonly number[];
  arrived: number;
}

export interface DataState {
  /**
   * The rows of every year the period needs that loaded: those from the
   * period's start year on, which hold every PR the period can select.
   */
  dataset: Dataset;
  /** The years that did not load, each naming its file. */
  errors: LoadError[];
  /** A load for a changed period is under way; `dataset` is the previous one until it lands. */
  loading: boolean;
  /** The load under way, or null when none is. */
  progress: LoadProgress | null;
  /**
   * Where the reader's last "try again" stands, until the period changes:
   * running, failed again (`at`, epoch milliseconds), or succeeded.
   */
  retry: { state: 'none' } | { state: 'running' } | { state: 'failed'; at: number } | { state: 'succeeded' };
}

export interface DataStore extends Readable<DataState> {
  /**
   * Loads the current period's years again when a year failed in a way
   * fetching again may mend; does nothing while a retry runs.
   */
  retry(): void;
  destroy(): void;
}

export interface Page {
  meta: Meta;
  selection: StateStore;
  data: DataStore;
  /** The filters and the rows they select; what every section's figures are computed from. */
  view: Readable<View>;
  /** For files fetched on demand, such as a year's table. */
  loader: DataLoader;
}

export interface View {
  dataset: Dataset;
  /** The filters the figures are for: the reader's, or while `pending` the previous ones. */
  filters: Filters;
  /** The rows the filters select from `dataset`, ascending. */
  rows: Uint32Array;
  /**
   * The reader's filters need years not loaded yet, or that failed to load,
   * so the figures are still those of the previous filters.
   */
  pending: boolean;
  /**
   * No figures have been shown yet: the reader's filters wait for their
   * years, and `rows` is empty. Always `pending` too.
   */
  first: boolean;
  /**
   * The reader's filters can be computed, over a dataset large enough that
   * doing so holds the page up; the figures are still those of `filters`
   * until the page has painted this and recomputed.
   */
  recomputing: boolean;
}

/**
 * The dataset size from which a recompute is announced before it runs. The
 * last six months load at most the previous year's file and half of the
 * current one's: 13,602 rows on the data of 2026-11-16, which took 126 ms
 * to recompute on a desktop, and a two-year period's 19,684 took 167 ms.
 * Below this size a recompute runs at once, unannounced, so a short period
 * never flashes a busy state. The default view, the whole window, is well
 * above it, so every change of it is announced.
 */
export const LARGE_DATASET = 15_000;

/** Runs `job` once the page has painted what it shows now; returns what cancels it. */
export type Defer = (job: () => void) => () => void;

/**
 * Runs `job` in a task after the next frame: a frame's callbacks run
 * before it is painted, and a task queued from one runs after.
 */
export const afterPaint: Defer = (job) => {
  if (typeof requestAnimationFrame !== 'function') {
    const timer = setTimeout(job, 0);
    return () => clearTimeout(timer);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const frame = requestAnimationFrame(() => (timer = setTimeout(job, 0)));
  return () => {
    cancelAnimationFrame(frame);
    clearTimeout(timer);
  };
};

export const [getPage, setPage] = createContext<Page>();

export function yearsForState(meta: Meta, state: AppState): number[] {
  return yearsFor(meta, periodRange(state.filters).start);
}

/**
 * The years the page loads first: the period's on the report, every year
 * for the default period, and none on the methods page, which loads the
 * last six months' years itself and should not wait on a period the
 * address carries for the report.
 */
export function firstYears(meta: Meta, state: AppState): number[] {
  return state.route === 'report' ? yearsForState(meta, state) : [];
}

/**
 * The report's data for the current period: it loads the years a new period
 * needs and keeps showing the last dataset until they arrive. Only the
 * latest load is kept, so a slow one cannot overwrite a newer one. A later
 * start drops the years it no longer needs from the dataset, so every figure
 * scans only the period's years; their files stay with the loader. Nothing
 * loads while another route is shown: the report's period loads when the
 * reader comes to it. `retry` loads the current period's years again after
 * one failed to arrive, which fetches again only those that failed.
 *
 * `initial` is what loading `years` gave; without it the store starts on an
 * empty dataset and loads `years` itself, counting them as they arrive.
 */
export function createDataStore(
  loader: DataLoader,
  selection: Readable<AppState>,
  years: readonly number[],
  initial?: LoadResult,
): DataStore {
  const empty: LoadResult = { dataset: combine(loader.meta, []), errors: [] };
  const inner = writable<DataState>({ ...(initial ?? empty), loading: false, progress: null, retry: { state: 'none' } });
  let shown = years.join(',');
  let wanted: readonly number[] = years;
  let latest = 0;
  const load = (retrying: boolean) => {
    const ticket = ++latest;
    const after = (errors: readonly LoadError[]): DataState['retry'] =>
      !retrying ? { state: 'none' } : errors.length > 0 ? { state: 'failed', at: Date.now() } : { state: 'succeeded' };
    // Years another route has loaded through the same loader are taken at once.
    const have = loader.loaded(wanted);
    if (have) {
      inner.set({ ...have, loading: false, progress: null, retry: after(have.errors) });
      return;
    }
    const years = wanted;
    const arrived = new Set(years.filter((y) => loader.has(y)));
    inner.update((d) => ({
      ...d,
      loading: true,
      progress: { years, arrived: arrived.size },
      retry: retrying ? { state: 'running' } : { state: 'none' },
    }));
    const onArrival = (year: number) => {
      if (ticket !== latest || arrived.has(year)) return;
      arrived.add(year);
      inner.update((d) => ({ ...d, progress: { years, arrived: arrived.size } }));
    };
    void loader.load(years, onArrival).then((result) => {
      if (ticket === latest) inner.set({ ...result, loading: false, progress: null, retry: after(result.errors) });
    });
  };
  if (initial === undefined) load(false);
  const stop = selection.subscribe((state) => {
    if (state.route !== 'report') return;
    const next = yearsForState(loader.meta, state);
    const key = next.join(',');
    if (key === shown) return;
    shown = key;
    wanted = next;
    load(false);
  });
  return {
    subscribe: inner.subscribe,
    retry: () => {
      const d = get(inner);
      if (d.retry.state !== 'running' && d.errors.some((e) => e.retry)) load(true);
    },
    destroy: stop,
  };
}

/**
 * Whether a section's figures are not yet the reader's whole period: the
 * view keeps a previous period's, or shows what loaded of this one while a
 * load runs that may bring the years that failed.
 */
export function sectionsStale(view: View, data: DataState): boolean {
  return view.pending || view.recomputing || (data.loading && data.errors.length > 0);
}

/** Whether a section is about to change: it is recomputing, or stale while a load runs. */
export function sectionsBusy(view: View, data: DataState): boolean {
  return view.recomputing || (data.loading && sectionsStale(view, data));
}

const sameYears = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((y, i) => y === b[i]);
const yearsOf = (data: Dataset) => data.years.map((s) => s.year);

/**
 * The selection every section reads. The state store hands out a new filters
 * object on every change of the URL, choosing a PR or a sort included, and a
 * Svelte derivation compares by identity; this one notifies only when the
 * filters' values, the dataset or `pending` change, so a statistic over the
 * selection is computed again only then.
 *
 * Filters are taken up only over every year their period needs: until those
 * land, and for good when one fails, the view keeps the previous filters'
 * figures and says it is pending, so no figure is ever shown for a period
 * over fewer years than it needs. A year that failed is let off only where
 * no figures would otherwise be shown, the page's first, and for filters
 * needing the same years as those shown over the same dataset; the page's
 * alert then names it. Until the first figures can be shown the view is
 * pending with nothing to show, as when the report is reached from another
 * route and its years are still loading.
 *
 * Over a dataset of `large` rows or more, a change that can be computed is
 * first handed out as `recomputing`, the figures kept, and computed only
 * once `defer` runs, after the page has painted that; any change before
 * then decides afresh, so only the latest is ever computed or shown.
 */
export function createViewStore(
  selection: Readable<AppState>,
  data: Readable<DataState>,
  { large = LARGE_DATASET, defer = afterPaint }: { large?: number; defer?: Defer } = {},
): Readable<View> & { destroy(): void } {
  const keep = keepEqual(sameFilters);
  let state = get(selection);
  let dataset = get(data).dataset;
  let failed = get(data).errors.map((e) => e.year);
  const needs = (filters: Filters) => yearsFor(dataset.meta, periodRange(filters).start);
  const view = (filters: Filters): View => ({
    dataset,
    filters,
    rows: select(dataset, filters),
    pending: false,
    first: false,
    recomputing: false,
  });
  let current: View = {
    dataset,
    filters: keep(state.filters),
    rows: new Uint32Array(0),
    pending: true,
    first: true,
    recomputing: false,
  };

  const ready = (filters: Filters) => {
    const have = yearsOf(dataset);
    const missing = needs(filters).filter((y) => !have.includes(y));
    if (missing.length === 0) return true;
    if (!missing.every((y) => failed.includes(y))) return false;
    if (current.first) return true;
    return sameYears(needs(filters), needs(current.filters)) && sameYears(have, yearsOf(current.dataset));
  };

  if (ready(current.filters)) current = view(current.filters);
  const inner = writable(current);

  const show = (next: View) => {
    current = next;
    inner.set(current);
  };
  let cancel: (() => void) | null = null;
  const update = () => {
    cancel?.();
    cancel = null;
    // Filters put back as shown while a recompute waits are the shown ones.
    const filters = sameFilters(current.filters, state.filters) ? current.filters : keep(state.filters);
    if (!current.pending && current.filters === filters && current.dataset === dataset) {
      if (current.recomputing) show({ ...current, recomputing: false });
      return;
    }
    if (!ready(filters)) {
      if (!current.pending || current.recomputing) show({ ...current, pending: true, recomputing: false });
      return;
    }
    if (dataset.size < large) {
      show(view(filters));
      return;
    }
    if (!current.recomputing) show({ ...current, recomputing: true });
    cancel = defer(() => {
      cancel = null;
      show(view(filters));
    });
  };
  const stopState = selection.subscribe((s) => {
    state = s;
    update();
  });
  const stopData = data.subscribe((d) => {
    dataset = d.dataset;
    failed = d.errors.map((e) => e.year);
    update();
  });
  return {
    subscribe: inner.subscribe,
    destroy: () => {
      cancel?.();
      cancel = null;
      stopState();
      stopData();
    },
  };
}

/**
 * The page as the browser opens it: the data store loads the years the
 * address's period needs, every year for the default one, while the page
 * shows that it is loading them.
 */
export function createPage(meta: Meta, selection: StateStore, loader: DataLoader): Page {
  const data = createDataStore(loader, selection, firstYears(meta, get(selection)));
  return { meta, selection, data, view: createViewStore(selection, data), loader };
}
