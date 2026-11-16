// @vitest-environment jsdom
// A change of the URL that leaves the filters alone, such as choosing a PR or
// a table's order, must not compute the statistics of the selection again.
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import App from '../App.svelte';
import { BASE, fixtureFetch } from '../lib/__fixtures__/fetch';
import { fixturePage, memoryLocation, meta } from '../lib/__fixtures__/page';
import { DataLoader } from '../lib/data';
import { createDataStore, createViewStore, firstYears } from '../lib/page';
import { createStateStore } from '../lib/state';

const calls = vi.hoisted(() => ({ weekly: 0, backlog: 0, outcomeCurve: 0, select: 0, byOpening: 0, laneModel: 0 }));
const more = vi.hoisted(() => ({ authorRows: 0, reviewerRows: 0, tableOrder: 0 }));

vi.mock('../lib/stats/people', async (original) => {
  const m = await original<typeof import('../lib/stats/people')>();
  return {
    ...m,
    authorRows: (...args: Parameters<typeof m.authorRows>) => {
      more.authorRows++;
      return m.authorRows(...args);
    },
    reviewerRows: (...args: Parameters<typeof m.reviewerRows>) => {
      more.reviewerRows++;
      return m.reviewerRows(...args);
    },
  };
});

vi.mock('../lib/table', async (original) => {
  const m = await original<typeof import('../lib/table')>();
  return {
    ...m,
    tableOrder: (...args: Parameters<typeof m.tableOrder>) => {
      more.tableOrder++;
      return m.tableOrder(...args);
    },
  };
});
const timelines = vi.hoisted(() => ({ prTimeline: 0 }));

vi.mock('../lib/lanes', async (original) => {
  const m = await original<typeof import('../lib/lanes')>();
  return {
    ...m,
    byOpening: (...args: Parameters<typeof m.byOpening>) => {
      calls.byOpening++;
      return m.byOpening(...args);
    },
    laneModel: (...args: Parameters<typeof m.laneModel>) => {
      calls.laneModel++;
      return m.laneModel(...args);
    },
  };
});

vi.mock('../lib/timeline', async (original) => {
  const m = await original<typeof import('../lib/timeline')>();
  return {
    ...m,
    prTimeline: (...args: Parameters<typeof m.prTimeline>) => {
      timelines.prTimeline++;
      return m.prTimeline(...args);
    },
  };
});

vi.mock('../lib/stats/weekly', async (original) => {
  const m = await original<typeof import('../lib/stats/weekly')>();
  return {
    ...m,
    weekly: (...args: Parameters<typeof m.weekly>) => {
      calls.weekly++;
      return m.weekly(...args);
    },
  };
});

vi.mock('../lib/stats/backlog', async (original) => {
  const m = await original<typeof import('../lib/stats/backlog')>();
  return {
    ...m,
    backlog: (...args: Parameters<typeof m.backlog>) => {
      calls.backlog++;
      return m.backlog(...args);
    },
  };
});

vi.mock('../lib/stats/curve', async (original) => {
  const m = await original<typeof import('../lib/stats/curve')>();
  return {
    ...m,
    outcomeCurve: (...args: Parameters<typeof m.outcomeCurve>) => {
      calls.outcomeCurve++;
      return m.outcomeCurve(...args);
    },
  };
});

vi.mock('../lib/select', async (original) => {
  const m = await original<typeof import('../lib/select')>();
  return {
    ...m,
    select: (...args: Parameters<typeof m.select>) => {
      calls.select++;
      return m.select(...args);
    },
  };
});

beforeAll(() => {
  window.matchMedia = (query: string) =>
    ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;
});

beforeEach(() => {
  calls.weekly = calls.backlog = calls.outcomeCurve = calls.select = calls.byOpening = calls.laneModel = 0;
  more.authorRows = more.reviewerRows = more.tableOrder = 0;
  timelines.prTimeline = 0;
});

/** The counts of the selection's statistics, without the lanes'. */
const statistics = (c: typeof calls) => ({ weekly: c.weekly, backlog: c.backlog, outcomeCurve: c.outcomeCurve, select: c.select });

async function rendered(hash = '') {
  const { props } = await fixturePage(hash);
  render(App, props);
  await tick();
  return { selection: props.page.selection, before: { ...calls } };
}

describe("Velocity's and Review's statistics", () => {
  it('are computed once on the first render', async () => {
    const { before } = await rendered();
    expect(before.weekly).toBeGreaterThan(0);
    expect(before.backlog).toBeGreaterThan(0);
    expect(before.outcomeCurve).toBeGreaterThan(0);
    expect(before.select).toBe(1);
  });

  it('are not computed again when a PR is chosen', async () => {
    const { selection, before } = await rendered();
    selection.update((s) => ({ ...s, pr: 66500 }));
    await tick();
    expect(calls).toEqual(before);
  });

  it("are not computed again when the PR table's order changes", async () => {
    const { selection, before } = await rendered();
    selection.update((s) => ({ ...s, sort: { column: 'size', descending: true } }));
    await tick();
    expect(statistics(calls)).toEqual(statistics(before));
  });

  it('are computed again when a filter changes', async () => {
    const { selection, before } = await rendered();
    selection.update((s) => ({ ...s, filters: { ...s.filters, target: 'all' } }));
    await tick();
    expect(calls.select).toBe(before.select + 1);
    expect(calls.weekly).toBeGreaterThan(before.weekly);
    expect(calls.backlog).toBeGreaterThan(before.backlog);
    expect(calls.outcomeCurve).toBeGreaterThan(before.outcomeCurve);
  });
});

// `laneModel` builds a lane per PR. The lanes take the PR table's order, so
// they never order the selection themselves (`byOpening`), and a new order of
// the table rebuilds them once.
describe("The lanes' rows", () => {
  it('are built once on the first render, in the PR table’s order', async () => {
    const { before } = await rendered();
    expect(before.laneModel).toBe(1);
    expect(before.byOpening).toBe(0);
  });

  it('are not built again when a PR is chosen', async () => {
    // A sort other than the default, which the URL state rebuilds on every change.
    const { selection, before } = await rendered('#/?sort=-size');
    selection.update((s) => ({ ...s, pr: 66500 }));
    await tick();
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.laneModel).toBe(before.laneModel);
  });

  it("are built again once when the PR table's order changes, and not when the titles arrive", async () => {
    const { selection, before } = await rendered();
    selection.update((s) => ({ ...s, sort: { column: 'size', descending: true } }));
    await tick();
    // The PR table's titles load meanwhile: they do not reorder a table not sorted by title.
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.laneModel).toBe(before.laneModel + 1);
    expect(calls.byOpening).toBe(0);
  });

  it('are built again when a filter changes', async () => {
    const { selection, before } = await rendered();
    selection.update((s) => ({ ...s, filters: { ...s.filters, kind: 'feature' } }));
    await tick();
    expect(calls.laneModel).toBe(before.laneModel + 1);
  });
});

describe("The chosen PR's timeline", () => {
  it('is built for the PR chosen, again when another is chosen, and not when the PR table is sorted', async () => {
    const { selection } = await rendered('#/?pr=66500');
    await vi.waitFor(() => expect(timelines.prTimeline).toBeGreaterThan(0));
    await tick();
    const first = timelines.prTimeline;
    selection.update((s) => ({ ...s, sort: { column: 'size', descending: true } }));
    await tick();
    await new Promise((r) => setTimeout(r, 20));
    expect(timelines.prTimeline).toBe(first);
    selection.update((s) => ({ ...s, pr: 66600 }));
    await vi.waitFor(() => expect(timelines.prTimeline).toBeGreaterThan(first));
  });
});

// Before a large recompute the view hands out a busy state with the figures
// it shows; that state must compute nothing, or the click waits on the work
// it is meant to announce, and the work is done twice.
describe('The busy state before a large recompute', () => {
  it('computes no statistic, no lane and no order, and the recompute then computes each', async () => {
    const loc = memoryLocation('');
    const selection = createStateStore(meta, loc);
    const loader = new DataLoader(meta, BASE, fixtureFetch().fetch);
    const years = firstYears(meta, get(selection));
    const data = createDataStore(loader, selection, years, await loader.load(years));
    const jobs: (() => void)[] = [];
    const view = createViewStore(selection, data, { large: 1, defer: (job) => (jobs.push(job), () => {}) });
    render(App, { props: { page: { meta, selection, data, view, loader } } });
    await tick();
    const before = { ...calls, ...more };
    expect(before.authorRows).toBeGreaterThan(0);
    expect(before.tableOrder).toBeGreaterThan(0);

    selection.update((s) => ({ ...s, filters: { ...s.filters, target: 'all' } }));
    await tick();
    expect(get(view).recomputing).toBe(true);
    expect({ ...calls, ...more }).toEqual(before);

    jobs.splice(0).forEach((job) => job());
    await tick();
    const after = { ...calls, ...more };
    expect(after.select).toBe(before.select + 1);
    expect(after.weekly).toBeGreaterThan(before.weekly);
    expect(after.authorRows).toBe(before.authorRows + 1);
    expect(after.reviewerRows).toBe(before.reviewerRows + 1);
    // The table orders its rows, and the lanes take the same order.
    expect(after.tableOrder).toBe(before.tableOrder + 2);
    expect(after.laneModel).toBe(before.laneModel + 1);
  });
});
