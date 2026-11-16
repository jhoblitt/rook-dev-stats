// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import App from '../App.svelte';
import { BASE, fixtureFetch, withEarlierYear, withYears } from '../lib/__fixtures__/fetch';
import { memoryLocation, meta } from '../lib/__fixtures__/page';
import { DataLoader, type Meta, parseMeta } from '../lib/data';
import { createDataStore, createViewStore, yearsForState } from '../lib/page';
import { createStateStore, stateFromHash } from '../lib/state';
import { fixture } from '../lib/stats/testing';
import { DEFAULT_SORT } from '../lib/sort';
import { sortRows, tableRows } from '../lib/table';

beforeAll(() => {
  window.matchMedia = (query: string) =>
    ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
});

const data = fixture();

/** The App over the fixture at `hash`, recording the files fetched. */
async function page(hash: string, files: Record<string, unknown> = {}, m: Meta = meta) {
  const loc = memoryLocation(hash);
  const selection = createStateStore(m, loc);
  const fetched = fixtureFetch(files);
  const loader = new DataLoader(m, BASE, fetched.fetch);
  const years = yearsForState(m, get(selection));
  const store = createDataStore(loader, selection, years, await loader.load(years));
  const view = createViewStore(selection, store);
  return { props: { page: { meta: m, selection, data: store, view, loader } }, loc, requested: fetched.requested };
}

// The fixture with 2025 before it, holding #60010 alone, and a period from
// before 2025's merge, so the table lists PRs from both years' files.
const earlier = withEarlierYear();
const twoYears = parseMeta(earlier['meta.json']);
const BACK = '#/?from=2025-03-01';

function region() {
  return within(screen.getByRole('region', { name: 'Pull requests' }));
}

function table() {
  return region().getByRole('table', { name: /^Pull requests/ });
}

/** The PR numbers of the table's body rows, in order. */
function listed(): number[] {
  return within(table())
    .getAllByRole('row')
    .slice(1)
    .map((r) => Number(r.querySelector('td a')?.textContent?.replace(/\D/g, '')));
}

const expected = (hash: string) => {
  const state = stateFromHash(hash, meta);
  return [...sortRows(data, tableRows(data, state), state.sort)].map((r) => data.prs.number[r]);
};

describe('PrTable', () => {
  it('names its order in its caption, keeping the column label’s capitals', async () => {
    const { props } = await page('');
    render(App, props);
    expect(table().querySelector('caption')?.textContent).toBe('Pull requests, sorted by Opened, descending');
    await fireEvent.click(within(table()).getByRole('button', { name: /^PR/ }));
    expect(table().querySelector('caption')?.textContent).toBe('Pull requests, sorted by PR, ascending');
    await fireEvent.click(within(table()).getByRole('button', { name: /^AI use/ }));
    expect(table().querySelector('caption')?.textContent).toBe('Pull requests, sorted by AI use, ascending');
  });

  it('is busy while a table file it needs is loading, and not once none is', async () => {
    // A fetch that holds the table files back until released.
    const held: (() => void)[] = [];
    const base = fixtureFetch(earlier);
    const fetch = (url: string) =>
      url.includes('table-') ? new Promise<Response>((go) => held.push(() => go(base.fetch(url)))) : base.fetch(url);
    const loc = memoryLocation(BACK);
    const selection = createStateStore(twoYears, loc);
    const loader = new DataLoader(twoYears, BASE, fetch);
    const years = yearsForState(twoYears, get(selection));
    const store = createDataStore(loader, selection, years, await loader.load(years));
    const props = { page: { meta: twoYears, selection, data: store, view: createViewStore(selection, store), loader } };
    render(App, { props });
    await waitFor(() => expect(held.length).toBe(2));
    expect(table().getAttribute('aria-busy')).toBe('true');
    expect(region().getByText('Loading the titles of the PRs finished in 2025…')).toBeTruthy();
    expect(region().getByText('Loading the titles of the PRs finished in 2026 or still open…')).toBeTruthy();
    for (const go of held.splice(0)) go();
    await waitFor(() => expect(table().getAttribute('aria-busy')).toBe('false'));
    expect(region().queryByText(/^Loading the titles/)).toBeNull();
  });

  describe('when a table file arrives', () => {
    /** The App with the table files held back; `compares` counts the string comparisons the sorts make. */
    async function held(hash: string) {
      const waiting: (() => void)[] = [];
      const base = fixtureFetch();
      const fetch = (url: string) =>
        url.includes('table-') ? new Promise<Response>((go) => waiting.push(() => go(base.fetch(url)))) : base.fetch(url);
      const loc = memoryLocation(hash);
      const selection = createStateStore(meta, loc);
      const loader = new DataLoader(meta, BASE, fetch);
      const years = yearsForState(meta, get(selection));
      const store = createDataStore(loader, selection, years, await loader.load(years));
      render(App, { props: { page: { meta, selection, data: store, view: createViewStore(selection, store), loader } } });
      await waitFor(() => expect(waiting.length).toBe(1));
      const compares = vi.spyOn(Intl.Collator.prototype, 'compare', 'get');
      for (const go of waiting.splice(0)) go();
      await waitFor(() => expect(table().getAttribute('aria-busy')).toBe('false'));
      await waitFor(() => expect(within(table()).getByText('rgw: check the bucket owner before a copy')).toBeTruthy());
      const count = compares.mock.calls.length;
      compares.mockRestore();
      return count;
    }

    it('does not sort the rows again under a sort that reads no title', async () => {
      expect(await held('#/?sort=author')).toBe(0);
      expect(listed()).toEqual(expected('#/?sort=author'));
    });

    it('sorts them again under the title sort, into the order of the titles', async () => {
      expect(await held('#/?sort=title')).toBeGreaterThan(0);
      const titles = within(table())
        .getAllByRole('row')
        .slice(1)
        .map((r) => r.querySelectorAll('td')[1]?.textContent?.trim() ?? '');
      const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
      expect(titles).toHaveLength(9);
      expect(titles).toEqual([...titles].sort((a, b) => collator.compare(a, b)));
    });
  });

  it('is not busy when a table file it needs failed to load', async () => {
    render(App, (await page(BACK, { ...earlier, 'table-2026.json': undefined }, twoYears)).props);
    // 2026's file fails, 2025's loads: then none is loading.
    await waitFor(() => expect(table().getAttribute('aria-busy')).toBe('false'));
    expect(region().getByText(/PRs finished in 2026 or still open could not be loaded/)).toBeTruthy();
  });

  it('lists exactly the selected PRs, newest opened first', async () => {
    render(App, (await page('')).props);
    expect(listed()).toEqual(expected(''));
    expect(listed()).toEqual([67100, 67000, 66900, 66700, 66600, 66510, 66500, 66100, 64010]);
    expect(table().getAttribute('aria-rowcount')).toBe('10');
  });

  it('says how many PRs it lists, and how many of them were opened in the period', async () => {
    render(App, (await page('')).props);
    // Nine selected; 64010 and 66100 were opened before the period.
    expect(region().getByRole('status').textContent).toBe('9 PRs open at some point in the period, 7 of them opened in it');
  });

  it('shows what a PR is about and whether it discloses first', async () => {
    render(App, (await page('')).props);
    const heads = within(table())
      .getAllByRole('columnheader')
      .map((h) => h.textContent?.replace(/[↑↓]/g, '').trim());
    expect(heads.slice(0, 4)).toEqual(['PR', 'Title', 'AI use', 'Author']);
    expect(heads).toContain('First response');
  });

  it('narrows to a chosen week, says so, and widens again', async () => {
    const { props, loc } = await page('#/?week=2026-05-18');
    render(App, props);
    expect(listed()).toEqual([66510, 66500]);
    expect(region().getByText(/2 PRs opened in the week of 2026-05-18/)).toBeTruthy();
    await fireEvent.click(region().getByRole('button', { name: 'Show every selected PR' }));
    expect(loc.hash()).toBe('#/?target=master');
  });

  it('loads the table file of each year the selection needs, and no other', async () => {
    const { props, requested } = await page('#/?kind=feature');
    render(App, props);
    await waitFor(() => expect(region().getByText('mds, mgr: report stuck client requests')).toBeTruthy());
    expect(requested.filter((u) => u.includes('table-'))).toEqual([`${BASE}table-2026.json`]);
    expect(within(table()).getByText('fixture-author-a')).toBeTruthy();
  });

  it('says which year could not be loaded and keeps the others', async () => {
    render(App, (await page(BACK, { ...earlier, 'table-2026.json': undefined }, twoYears)).props);
    await waitFor(() => expect(region().getByText(/PRs finished in 2026 or still open could not be loaded/)).toBeTruthy());
    expect(region().getByText(/table-2026\.json: HTTP 404/)).toBeTruthy();
    // #60010's title, from 2025's file, which loaded.
    await waitFor(() => expect(within(table()).getByText('rgw: fix a stall in multisite bucket sync')).toBeTruthy());
  });

  it('loads no table file of a year before the period, nor of a year it lists no PR from', async () => {
    const { props, requested } = await page('#/?from=2026-05-15', earlier, twoYears);
    render(App, props);
    await waitFor(() => expect(within(table()).getByText('mds: rework the client session table')).toBeTruthy());
    expect(requested.filter((u) => u.includes('-2025'))).toEqual([]);
  });

  it('sorts by a column chosen, writing it to the URL, and the other way when chosen again', async () => {
    const { props, loc } = await page('');
    render(App, props);
    const size = () => within(table()).getByRole('button', { name: /^Size/ });
    await fireEvent.click(size());
    expect(loc.hash()).toBe('#/?target=master&sort=size');
    expect(listed()).toEqual(expected('#/?sort=size'));
    expect(size().closest('th')?.getAttribute('aria-sort')).toBe('ascending');
    await fireEvent.click(size());
    expect(loc.hash()).toBe('#/?target=master&sort=-size');
    expect(listed()).toEqual(expected('#/?sort=-size'));
    expect(listed()[0]).toBe(67000);
    expect(within(table()).getByRole('button', { name: /^Opened/ }).closest('th')?.getAttribute('aria-sort')).toBe('none');
  });

  it('goes back to the top of the list after a sort', async () => {
    render(App, (await page('')).props);
    const box = region().getByRole('region', { name: 'Pull requests, scrollable' });
    box.scrollTop = 800;
    await fireEvent.scroll(box);
    expect(box.scrollTop).toBe(800);
    await fireEvent.click(within(table()).getByRole('button', { name: /^Size/ }));
    expect(box.scrollTop).toBe(0);
  });

  it('sorts by title once the titles are there', async () => {
    render(App, (await page('#/?sort=title')).props);
    await waitFor(() => expect(within(table()).getByText('doc: fix a typo')).toBeTruthy());
    expect(listed()[0]).toBe(66510);
    expect(DEFAULT_SORT.column).toBe('opened');
  });

  it('links each number to the PR on GitHub, in a new tab', async () => {
    render(App, (await page('')).props);
    const link = within(table()).getByRole('link', { name: '#66500 on GitHub, opens in a new tab' });
    expect(link.getAttribute('href')).toBe('https://github.com/ceph/ceph/pull/66500');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it("links each author's handle to their page on GitHub, in a new tab, before any table file is there", async () => {
    render(App, (await page('#/?target=all')).props);
    const links = within(table()).getAllByRole('link', { name: 'fixture-author-d on GitHub, opens in a new tab' });
    expect(links).toHaveLength(2);
    expect(links[0]?.getAttribute('href')).toBe('https://github.com/fixture-author-d');
    expect(links[0]?.getAttribute('target')).toBe('_blank');
    expect(links[0]?.getAttribute('rel')).toBe('noopener noreferrer');
    // fixture-author-j is a bot account.
    const bot = within(table()).getByRole('link', { name: 'fixture-author-j on GitHub, opens in a new tab' });
    expect(bot.closest('td')?.textContent).toMatch(/fixture-author-j\s*bot/);
  });

  it("filters by a row's author, and clears the filter when chosen again", async () => {
    const { props, loc } = await page('');
    render(App, props);
    const toggle = () => within(table()).getAllByRole('button', { name: 'Filter by fixture-author-d as author' })[0]!;
    expect(toggle().getAttribute('aria-pressed')).toBe('false');
    await fireEvent.click(toggle());
    expect(loc.hash()).toBe('#/?target=master&author=fixture-author-d');
    expect(listed()).toEqual([67100, 66500]);
    expect(toggle().getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByLabelText('Author') as HTMLInputElement).value).toBe('fixture-author-d');
    await fireEvent.click(toggle());
    expect(loc.hash()).toBe('#/?target=master');
  });

  it('writes the PR chosen from a row to the URL, and marks the row', async () => {
    const { props, loc } = await page('');
    render(App, props);
    await waitFor(() => expect(within(table()).getByText('doc: fix a typo')).toBeTruthy());
    await fireEvent.click(within(table()).getByRole('button', { name: 'doc: fix a typo' }));
    expect(loc.hash()).toBe('#/?target=master&pr=66510');
    const row = within(table()).getByRole('button', { name: 'doc: fix a typo' }).closest('tr');
    expect(row?.getAttribute('aria-current')).toBe('true');
  });

  it('says what is missing, not "no PRs match", when a chosen week has no PRs opened in it', async () => {
    render(App, (await page('#/?week=2026-06-22')).props);
    expect(region().getByText('no PRs opened in the week of 2026-06-22')).toBeTruthy();
    expect(region().queryByText('no PRs match')).toBeNull();
    expect(region().getByRole('button', { name: 'Show every selected PR' })).toBeTruthy();
  });

  it('says "no PRs match" for an empty selection', async () => {
    render(App, (await page('#/?component=cephfs&kind=docs')).props);
    expect(region().getByText('no PRs match')).toBeTruthy();
    expect(region().queryByRole('table')).toBeNull();
  });
});

// Seven years of files, 2020 to 2026, and a period over all of them. Under
// the default order, newest opened first, the table lists 2026's nine rows,
// then 2025's thirty, then 2024's, and so on back. Without a ResizeObserver
// the table's window is 480px high: rows of 40px, 12 in view and 8 more
// either side, so the first 20 rows are drawn.
describe('the title files the PR table fetches', () => {
  const years = withYears(2020, 30);
  const seven = parseMeta(years['meta.json']);
  const ALL = '#/?from=2020-01-01';
  const titleFiles = (requested: string[]) =>
    requested.filter((u) => u.includes('table-')).map((u) => u.slice(BASE.length));
  async function scrollTo(row: number) {
    const box = region().getByRole('region', { name: 'Pull requests, scrollable' });
    box.scrollTop = row * 40;
    await fireEvent.scroll(box);
  }

  it('are those of the years of the rows drawn, under an order that reads no title', async () => {
    const { props, requested } = await page(ALL, years, seven);
    render(App, props);
    await waitFor(() => expect(within(table()).getByText('copy 10 of 2025')).toBeTruthy());
    // Rows 0 to 19: 2026's nine and the first eleven of 2025.
    expect(listed().slice(0, 20).map((n) => (n >= 64000 ? 2026 : 2020 + Math.floor((n - 10000) / 1000)))).toEqual([
      ...Array<number>(9).fill(2026),
      ...Array<number>(11).fill(2025),
    ]);
    await waitFor(() => expect(table().getAttribute('aria-busy')).toBe('false'));
    expect(titleFiles(requested).sort()).toEqual(['table-2025.json', 'table-2026.json']);
  });

  it('are every year’s under the title order, which reads them all', async () => {
    const { props, requested } = await page(ALL, years, seven);
    render(App, props);
    await waitFor(() => expect(titleFiles(requested)).toHaveLength(2));
    await fireEvent.click(within(table()).getByRole('button', { name: /^Title/ }));
    await waitFor(() => expect(table().getAttribute('aria-busy')).toBe('false'));
    expect(titleFiles(requested).sort()).toEqual([2020, 2021, 2022, 2023, 2024, 2025, 2026].map((y) => `table-${y}.json`));
    expect(listed()[0]).toBe(10000);
  });

  it('take in a new year’s file as the rows move to it, fetching none already held', async () => {
    const { props, requested } = await page(ALL, years, seven);
    render(App, props);
    await waitFor(() => expect(table().getAttribute('aria-busy')).toBe('false'));
    // Rows 22 to 49: 2025's and 2024's.
    await scrollTo(30);
    await waitFor(() => expect(within(table()).getByText('copy 5 of 2024')).toBeTruthy());
    expect(titleFiles(requested).sort()).toEqual(['table-2024.json', 'table-2025.json', 'table-2026.json']);
    // Back to the top: nothing new.
    await scrollTo(0);
    await waitFor(() => expect(table().getAttribute('aria-busy')).toBe('false'));
    expect(titleFiles(requested)).toHaveLength(3);
  });

  it('show a row of a year whose file is loading without its title, and fill it in when it arrives', async () => {
    const waiting: (() => void)[] = [];
    const base = fixtureFetch(years);
    const fetch = (url: string) =>
      url.endsWith('table-2024.json') ? new Promise<Response>((go) => waiting.push(() => go(base.fetch(url)))) : base.fetch(url);
    const loc = memoryLocation(ALL);
    const selection = createStateStore(seven, loc);
    const loader = new DataLoader(seven, BASE, fetch);
    const ys = yearsForState(seven, get(selection));
    const store = createDataStore(loader, selection, ys, await loader.load(ys));
    render(App, { props: { page: { meta: seven, selection, data: store, view: createViewStore(selection, store), loader } } });
    await waitFor(() => expect(table().getAttribute('aria-busy')).toBe('false'));
    await scrollTo(30);
    await waitFor(() => expect(waiting).toHaveLength(1));
    expect(table().getAttribute('aria-busy')).toBe('true');
    expect(region().getByText('Loading the titles of the PRs finished in 2024…')).toBeTruthy();
    expect(within(table()).getByRole('button', { name: 'Show #14005' })).toBeTruthy();
    for (const go of waiting.splice(0)) go();
    await waitFor(() => expect(within(table()).getByRole('button', { name: 'copy 5 of 2024' })).toBeTruthy());
    expect(region().queryByText(/^Loading the titles/)).toBeNull();
  });

  it('say which year’s file could not be fetched while its rows are drawn', async () => {
    const { props } = await page(ALL, { ...years, 'table-2024.json': undefined }, seven);
    render(App, props);
    await waitFor(() => expect(table().getAttribute('aria-busy')).toBe('false'));
    expect(region().queryByText(/could not be loaded/)).toBeNull();
    await scrollTo(30);
    await waitFor(() =>
      expect(region().getByText(/The titles of the PRs finished in 2024 could not be loaded \(table-2024\.json: HTTP 404/)).toBeTruthy(),
    );
    expect(within(table()).getByRole('button', { name: 'Show #14005' })).toBeTruthy();
    expect(within(table()).getByText('copy 20 of 2025')).toBeTruthy();
    // Back among rows that need no 2024 title, the note goes with them.
    await scrollTo(0);
    await waitFor(() => expect(region().queryByText(/could not be loaded/)).toBeNull());
  });
});

describe('before the table is on screen', () => {
  // An IntersectionObserver that reports nothing until a spec says the section came into view.
  let observed: ((entries: { isIntersecting: boolean }[]) => void)[] = [];
  const real = globalThis.IntersectionObserver;
  beforeAll(() => {
    globalThis.IntersectionObserver = class {
      constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
        observed.push(cb);
      }
      observe() {}
      disconnect() {}
    } as unknown as typeof IntersectionObserver;
  });
  afterEach(() => {
    observed = [];
  });

  it('fetches no table file, not even for a PR the link names, until the table is shown', async () => {
    const { props, requested } = await page('#/?target=all&pr=66800');
    render(App, props);
    await new Promise((r) => setTimeout(r, 20));
    expect(requested.filter((u) => u.includes('table-'))).toEqual([]);
    for (const cb of observed) cb([{ isIntersecting: true }]);
    await waitFor(() => expect(requested.filter((u) => u.includes('table-')).length).toBeGreaterThan(0));
    expect(requested).toContain(`${BASE}table-2026.json`);
    // The timeline asks for the same file for the same PR, so the table must
    // show it loaded its own: its rows carry the titles.
    await waitFor(() => expect(within(table()).getByText('mds, mgr: report stuck client requests')).toBeTruthy());
  });

  afterAll(() => {
    globalThis.IntersectionObserver = real;
  });
});

// The selected PR's panel is in its own section with its timeline, above the table.
describe('the selected PR', () => {
  function panel() {
    return within(screen.getByRole('region', { name: /^Pull request #/ })).getByRole('group', { name: /^Selected PR/ });
  }

  it('links to GitHub, says its kind and what decided it, and links the issues it closes and the PR it backports', async () => {
    const { props, loc } = await page('#/?target=all&pr=66800');
    render(App, props);
    await waitFor(() => expect(panel().textContent).toContain('Bug fix, from the PR it backports'));
    const open = within(panel()).getByRole('link', { name: 'Open on GitHub, #66800, opens in a new tab' });
    expect(open.textContent).toBe('Open on GitHub');
    expect(open.getAttribute('href')).toBe('https://github.com/ceph/ceph/pull/66800');
    expect(open.getAttribute('rel')).toBe('noopener noreferrer');
    const issue = within(panel()).getByRole('link', { name: 'Issue #72140 on GitHub, opens in a new tab' });
    expect(issue.textContent).toBe('#72140');
    expect(issue.getAttribute('href')).toBe('https://github.com/ceph/ceph/issues/72140');
    expect(issue.getAttribute('target')).toBe('_blank');
    const original = within(panel()).getByRole('link', { name: '#66500 on GitHub, opens in a new tab' });
    expect(original.getAttribute('href')).toBe('https://github.com/ceph/ceph/pull/66500');
    await fireEvent.click(within(panel()).getByRole('button', { name: 'Show #66500 here' }));
    expect(loc.hash()).toBe('#/?target=all&pr=66500');
  });

  it('links a backport whose original is not in the data to GitHub only', async () => {
    render(App, (await page('#/?target=all&pr=65220')).props);
    await waitFor(() => expect(panel().textContent).toContain('unknown: nothing decided it'));
    expect(within(panel()).getByRole('link', { name: '#63980 on GitHub, opens in a new tab' })).toBeTruthy();
    expect(within(panel()).queryByRole('button', { name: /^Show #63980/ })).toBeNull();
  });

  it('links an issue of another repository there, named with its repository', async () => {
    render(App, (await page('#/?pr=66900')).props);
    await waitFor(() => expect(panel().textContent).toContain('Closes'));
    const own = within(panel()).getByRole('link', { name: 'Issue #72377 on GitHub, opens in a new tab' });
    expect(own.getAttribute('href')).toBe('https://github.com/ceph/ceph/issues/72377');
    const other = within(panel()).getByRole('link', { name: 'Issue ceph/ceph-csi#4001 on GitHub, opens in a new tab' });
    expect(other.textContent).toBe('ceph/ceph-csi#4001');
    expect(other.getAttribute('href')).toBe('https://github.com/ceph/ceph-csi/issues/4001');
  });

  it('lists an issue named twice twice, without breaking', async () => {
    // The loader does not promise unique issues: 66900's two, with the first repeated.
    const table = (await import('../lib/__fixtures__/data/table-2026.json')).default;
    const issues = table.issues.map((t, i) =>
      i === 8
        ? [
            [72377, 'ceph/ceph'],
            [4001, 'ceph/ceph-csi'],
            [72377, 'ceph/ceph'],
          ]
        : t,
    );
    render(App, (await page('#/?pr=66900', { 'table-2026.json': { ...table, issues } })).props);
    await waitFor(() => expect(within(panel()).getAllByRole('link', { name: /^Issue #72377 / })).toHaveLength(2));
  });

  it('shows nothing, and does not throw, for a PR not in the data', async () => {
    render(App, (await page('#/?pr=99999')).props);
    expect(screen.queryByRole('group', { name: /^Selected PR/ })).toBeNull();
  });
});
