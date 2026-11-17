// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { beforeAll, describe, expect, it } from 'vitest';
import App from './App.svelte';
import rawMeta from './lib/__fixtures__/data/meta.json';
import prs2026 from './lib/__fixtures__/data/prs-2026.json';
import { NAME_A, NAME_B, deletedMeta } from './lib/__fixtures__/deleted';
import { BASE, fixtureFetch, heldByYear, withEarlierYear, withYears } from './lib/__fixtures__/fetch';
import { DataLoader, type Fetch, parseMeta } from './lib/data';
import { POOLED_NOTE } from './lib/handles';
import { type Page, createDataStore, createPage, createViewStore, firstYears } from './lib/page';
import { type HashLocation, RECENT_MONTHS, createStateStore } from './lib/state';

const meta = parseMeta(rawMeta);

beforeAll(() => {
  // jsdom has no matchMedia; the theme toggle asks it for the system theme.
  window.matchMedia = (query: string) =>
    ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;
});

function memoryLocation(initial: string): HashLocation & { hash: () => string } {
  let hash = initial;
  return {
    hash: () => hash,
    read: () => hash,
    push: (h) => (hash = h),
    replace: (h) => (hash = h),
    listen: () => () => {},
  };
}

async function page(hash: string, files: Record<string, unknown> = {}, m = meta, wrap = (f: Fetch) => f) {
  const loc = memoryLocation(hash);
  const selection = createStateStore(m, loc);
  const loader = new DataLoader(m, BASE, wrap(fixtureFetch(files).fetch));
  const years = firstYears(m, get(selection));
  const data = createDataStore(loader, selection, years, await loader.load(years));
  const p: Page = { meta: m, selection, data, view: createViewStore(selection, data), loader };
  return { props: { page: p }, loc };
}

const SECTIONS = ['Velocity', 'Review', 'AI use', 'Each PR', 'Timelines', 'Pull requests', 'People'];

describe('App', () => {
  it('draws every section, and no error, from the whole fixture', async () => {
    render(App, (await page('')).props);
    for (const name of SECTIONS) expect(screen.getByRole('heading', { level: 2, name })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('names a year file that failed, and still draws every section', async () => {
    const earlier = withEarlierYear();
    const twoYears = parseMeta(earlier['meta.json']);
    render(App, (await page('#/?from=2025-03-01', { ...earlier, 'prs-2025.json': undefined }, twoYears)).props);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/PRs finished in 2025: prs-2025\.json, HTTP 404/);
    for (const name of SECTIONS) expect(screen.getByRole('heading', { level: 2, name })).toBeTruthy();
  });

  it('shows no figure, only that it is loading, when the report is reached from the methods page before its years land', async () => {
    const earlier = withEarlierYear();
    const twoYears = parseMeta(earlier['meta.json']);
    const held: (() => void)[] = [];
    const hold = (f: Fetch): Fetch => (url) =>
      url.includes('-2025') ? new Promise((go) => held.push(() => go(f(url)))) : f(url);
    const { props } = await page('#/methods?from=2025-03-01', earlier, twoYears, hold);
    render(App, props);
    // As following the Statistics link does: the same address, on the report.
    props.page.selection.update((s) => ({ ...s, route: 'report' }));
    await waitFor(() => expect(held.length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Rook pull requests' })).toBeTruthy());

    expect(screen.getByText('Loading the data for this period: the files of 2 years, 2025 to 2026.')).toBeTruthy();
    expect(document.querySelector('.waiting')?.getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByText(/no PRs match/)).toBeNull();
    expect(screen.queryByRole('heading', { level: 2, name: 'Velocity' })).toBeNull();

    for (const go of held.splice(0)) go();
    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: 'Velocity' })).toBeTruthy());
    expect(document.querySelector('.waiting')).toBeNull();
    const table = within(screen.getByRole('region', { name: /^Pull requests$/ }));
    expect(table.getByRole('status').textContent).toMatch(/^10 PRs open at some point in the period/);
  });

  it('keeps the last period that loaded whole when a year an earlier start needs fails, says so, and comes back', async () => {
    const earlier = withEarlierYear();
    const twoYears = parseMeta(earlier['meta.json']);
    render(App, (await page('#/?from=2026-05-15', { ...earlier, 'events-2025.json': undefined }, twoYears)).props);
    const status = () => screen.getByText((_, el) => el?.classList.contains('loading') === true);
    const table = () => within(screen.getByRole('region', { name: /^Pull requests$/ }));
    const count = table().getByRole('status').textContent;

    await fireEvent.click(screen.getByRole('button', { name: 'All, from 1 Jan 2025' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/events-2025\.json, HTTP 404/));
    expect(status().textContent).toBe(
      'The data for the period chosen could not be loaded, so everything below is still for 2026-05-15 to 2026-11-15, with the filters then chosen. Try again fetches what failed.',
    );
    expect(table().getByRole('status').textContent).toBe(count);
    expect(screen.getByRole('region', { name: 'Velocity' }).classList.contains('stale')).toBe(true);

    await fireEvent.click(screen.getByRole('button', { name: 'Last 6 months' }));
    await waitFor(() => expect(status().textContent).toBe(''));
    expect(screen.getByRole('region', { name: 'Velocity' }).classList.contains('stale')).toBe(false);
  });

  it('says, while an earlier start’s years load, which period the figures below are still for', async () => {
    const earlier = withEarlierYear();
    const twoYears = parseMeta(earlier['meta.json']);
    const held: (() => void)[] = [];
    const hold = (f: Fetch): Fetch => (url) =>
      url.includes('-2025') ? new Promise((go) => held.push(() => go(f(url)))) : f(url);
    render(App, (await page('#/?from=2026-05-15', earlier, twoYears, hold)).props);
    const status = () => screen.getByText((_, el) => el?.classList.contains('loading') === true);

    await fireEvent.click(screen.getByRole('button', { name: 'All, from 1 Jan 2025' }));
    await waitFor(() => expect(held.length).toBeGreaterThan(0));
    expect(status().textContent).toBe(
      'Loading the data for this period; everything below is still for 2026-05-15 to 2026-11-15, with the filters then chosen.',
    );
    for (const go of held.splice(0)) go();
    await waitFor(() => expect(status().textContent).toBe(''));
  });

  it('marks every section busy and says it is recomputing before a large recompute, then shows its result', async () => {
    const loc = memoryLocation('');
    const selection = createStateStore(meta, loc);
    const loader = new DataLoader(meta, BASE, fixtureFetch().fetch);
    const years = firstYears(meta, get(selection));
    const data = createDataStore(loader, selection, years, await loader.load(years));
    const jobs: (() => void)[] = [];
    // The fixture's 12 rows count as large; the recompute waits for the spec, where the page waits for a paint.
    const view = createViewStore(selection, data, { large: 1, defer: (job) => (jobs.push(job), () => {}) });
    render(App, { props: { page: { meta, selection, data, view, loader } } });
    const status = () => document.querySelector('p.loading') as HTMLElement;
    const velocity = () => screen.getByRole('region', { name: 'Velocity' });
    const count = () => within(screen.getByRole('region', { name: /^Pull requests$/ })).getByRole('status').textContent;
    const before = count();

    await fireEvent.click(screen.getByRole('radio', { name: 'all' }));
    expect(status().textContent).toBe(
      'Recomputing the figures for the filters chosen; everything below is still for the filters chosen before.',
    );
    expect(velocity().getAttribute('aria-busy')).toBe('true');
    expect(velocity().classList.contains('stale')).toBe(true);
    expect(count()).toBe(before);

    jobs.splice(0).forEach((job) => job());
    await waitFor(() => expect(status().textContent).toBe(''));
    expect(velocity().getAttribute('aria-busy')).toBeNull();
    expect(velocity().classList.contains('stale')).toBe(false);
    expect(count()).not.toBe(before);
  });

  describe('trying a year that failed again', () => {
    const earlier = withEarlierYear();
    const twoYears = parseMeta(earlier['meta.json']);
    const status = () => document.querySelector('p.loading') as HTMLElement;
    const table = () => within(screen.getByRole('region', { name: /^Pull requests$/ }));
    const button = () => within(screen.getByRole('alert')).getByRole('button', { name: /^Try(ing)? again/ });

    /** The page with `events-2025.json` failing until `reach`; fetches of it after `hold` wait for `release`. */
    async function flakyPage() {
      let reachable = false;
      let holding = false;
      const held: (() => void)[] = [];
      const flaky = (f: Fetch): Fetch => (url) => {
        if (!url.endsWith('events-2025.json')) return f(url);
        const answer = () => (reachable ? f(url) : Promise.resolve(new Response('', { status: 503 })));
        return holding ? new Promise((go) => held.push(() => go(answer()))) : answer();
      };
      render(App, (await page('#/?from=2026-05-15', earlier, twoYears, flaky)).props);
      await fireEvent.click(screen.getByRole('button', { name: 'All, from 1 Jan 2025' }));
      await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/events-2025\.json, HTTP 503/));
      return {
        reach: () => (reachable = true),
        hold: () => (holding = true),
        release: () => {
          holding = false;
          held.splice(0).forEach((go) => go());
        },
        held,
      };
    }

    it('says only what trying again does', async () => {
      await flakyPage();
      expect(status().textContent).toBe(
        'The data for the period chosen could not be loaded, so everything below is still for 2026-05-15 to 2026-11-15, with the filters then chosen. Try again fetches what failed.',
      );
      expect(button().textContent).toBe('Try again');
    });

    it('says while it runs that it is trying, keeps the focus there, and says when it failed again', async () => {
      const f = await flakyPage();
      button().focus();
      f.hold();
      await fireEvent.click(button());
      await waitFor(() => expect(f.held.length).toBe(1));
      expect(button().textContent).toBe('Trying again…');
      expect(button().getAttribute('aria-disabled')).toBe('true');
      expect(button().hasAttribute('disabled')).toBe(false);
      expect(document.activeElement).toBe(button());
      // A second press while it runs asks nothing more.
      await fireEvent.click(button());
      expect(f.held.length).toBe(1);

      f.release();
      await waitFor(() => expect(button().textContent).toBe('Try again'));
      expect(button().getAttribute('aria-disabled')).toBeNull();
      expect(document.activeElement).toBe(button());
      expect(screen.getByRole('alert').textContent).toMatch(/Tried again at \d\d:\d\d; it still could not be loaded\./);
    });

    it('moves the focus to the status line when it succeeds, which says the data has loaded', async () => {
      const f = await flakyPage();
      f.reach();
      button().focus();
      await fireEvent.click(button());
      await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
      expect(status().textContent).toBe('All the data for this period has loaded.');
      expect(status().getAttribute('role')).toBe('status');
      expect(status().getAttribute('tabindex')).toBe('-1');
      await waitFor(() => expect(document.activeElement).toBe(status()));
      expect(table().getByRole('status').textContent).toMatch(/^10 PRs open at some point in the period/);
    });

    it('offers no try again when the file arrived but could not be read, and says what will help', async () => {
      const broken = { ...earlier, 'events-2025.json': { ...(earlier['events-2025.json'] as object), kind: [99] } };
      render(App, (await page('#/?from=2026-05-15', broken, twoYears)).props);
      await fireEvent.click(screen.getByRole('button', { name: 'All, from 1 Jan 2025' }));
      await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/events-2025\.json/));
      expect(within(screen.getByRole('alert')).queryByRole('button')).toBeNull();
      expect(status().textContent).toBe(
        'The data for the period chosen could not be loaded, so everything below is still for 2026-05-15 to 2026-11-15, with the filters then chosen. A file arrived but could not be read, so trying again would not help; reloading the page after the data is next published may.',
      );
    });

    it('marks every section while it runs after a first load that lost its only year', async () => {
      let reachable = false;
      const held: (() => void)[] = [];
      let holding = false;
      const flaky = (f: Fetch): Fetch => (url) => {
        if (!url.endsWith('events-2026.json')) return f(url);
        const answer = () => (reachable ? f(url) : Promise.resolve(new Response('', { status: 503 })));
        return holding ? new Promise((go) => held.push(() => go(answer()))) : answer();
      };
      render(App, (await page('', {}, meta, flaky)).props);
      expect(screen.getByRole('alert').textContent).toMatch(/everything below leaves these years out/);
      const velocity = () => screen.getByRole('region', { name: 'Velocity' });
      expect(velocity().classList.contains('stale')).toBe(false);

      reachable = true;
      holding = true;
      await fireEvent.click(button());
      await waitFor(() => expect(held.length).toBe(1));
      for (const name of ['Velocity', 'Review', 'AI use', 'Each PR', 'Pull requests', 'People']) {
        const s = screen.getByRole('region', { name });
        expect(s.classList.contains('stale'), name).toBe(true);
        expect(s.getAttribute('aria-busy'), name).toBe('true');
      }
      expect(screen.getByRole('region', { name: 'Timelines' }).getAttribute('aria-busy')).toBe('true');

      holding = false;
      held.splice(0).forEach((go) => go());
      await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
      expect(velocity().classList.contains('stale')).toBe(false);
      expect(velocity().getAttribute('aria-busy')).toBeNull();
    });
  });

  it('shows one PR only when a PR is selected', async () => {
    render(App, (await page('#/?pr=66600')).props);
    expect(screen.getByRole('heading', { name: 'Pull request #66600' })).toBeTruthy();
  });

  it('has no PR section without a selected PR', async () => {
    render(App, (await page('')).props);
    expect(screen.queryByRole('heading', { name: /^Pull request #/ })).toBeNull();
  });

  it('says what day the data is as of', async () => {
    render(App, (await page('')).props);
    expect(screen.getByRole('banner').textContent).toMatch(/data as of 2026-11-15/);
  });

  it('footer shows the version and links to the repository', async () => {
    render(App, (await page('')).props);
    const footer = within(screen.getByRole('contentinfo'));
    expect(footer.getByText('dev')).toBeTruthy();
    expect(footer.getByRole('link', { name: 'github.com/jhoblitt/rook-dev-stats' }).getAttribute('href')).toBe(
      'https://github.com/jhoblitt/rook-dev-stats',
    );
  });

  it('renders the methods page', async () => {
    render(App, (await page('#/methods')).props);
    expect(screen.getByRole('heading', { level: 1, name: 'Methods' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Filters' })).toBeNull();
  });
});

describe('the first load of the whole history', () => {
  // Ten earlier years, 2016 to 2025, of one PR each, before the fixture's 2026.
  const history = withYears(2016, 1);
  const historyMeta = parseMeta(history['meta.json']);
  const status = () => document.querySelector('p.loading') as HTMLElement;
  const progress = () => document.querySelector('p.progress');

  /** The page as main.ts opens it, each year's files held back until released; `wrap` stands between. */
  function opening(wrap = (f: Fetch) => f) {
    const gate = heldByYear(history);
    const loader = new DataLoader(historyMeta, BASE, wrap(gate.fetch));
    const p = createPage(historyMeta, createStateStore(historyMeta, memoryLocation('')), loader);
    render(App, { props: { page: p } });
    return gate;
  }

  it('shows the waiting area, says once what it loads, and counts the years arrived outside the live region', async () => {
    const gate = opening();
    const loading = 'Loading the data for this period: the files of 11 years, 2016 to 2026.';
    await waitFor(() => expect(status().textContent).toBe(loading));
    expect(status().getAttribute('role')).toBe('status');
    expect(document.querySelector('.waiting')?.getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByRole('heading', { level: 2, name: 'Velocity' })).toBeNull();
    expect(progress()?.textContent).toBe('0 of 11 years have arrived.');
    expect(progress()?.closest('[role="status"], [role="alert"], [aria-live]')).toBeNull();

    gate.release(2016);
    await waitFor(() => expect(progress()?.textContent).toBe('1 of 11 years has arrived.'));
    gate.release(2017);
    gate.release(2026);
    await waitFor(() => expect(progress()?.textContent).toBe('3 of 11 years have arrived.'));
    expect(status().textContent).toBe(loading);

    gate.releaseAll();
    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: 'Velocity' })).toBeTruthy());
    expect(progress()).toBeNull();
    expect(status().textContent).toBe('');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'All, from 1 Jan 2016' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Last 6 months' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('names a year that failed, draws the figures over the rest, and fetches only it again on a retry', async () => {
    let reachable = false;
    const gate = opening((f) => (url) =>
      url.endsWith('events-2019.json') && !reachable ? Promise.resolve(new Response('', { status: 503 })) : f(url),
    );
    gate.releaseAll();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/PRs finished in 2019: events-2019\.json, HTTP 503/));
    expect(screen.getByRole('alert').textContent).toMatch(/everything below leaves these years out/);
    expect(screen.getByRole('heading', { level: 2, name: 'Velocity' })).toBeTruthy();

    reachable = true;
    const before = gate.requested.length;
    await fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Try again' }));
    gate.releaseAll();
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(status().textContent).toBe('All the data for this period has loaded.');
    const years = gate.requested.slice(before).filter((u) => /\/(prs|events)-/.test(u));
    expect(years.map((u) => u.slice(BASE.length)).sort()).toEqual(['events-2019.json', 'prs-2019.json']);
  });
});

describe('filter bar', () => {
  it('shows the defaults for a hash with unknown values', async () => {
    render(App, (await page('#/?target=nope&component=nope&disclosure=ai')).props);
    expect((screen.getByRole('radio', { name: 'master' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Component') as HTMLSelectElement).value).toBe('');
    expect((screen.getByLabelText('AI use disclosure') as HTMLSelectElement).value).toBe('');
    expect((screen.getByLabelText('From') as HTMLInputElement).value).toBe('2026-05-15');
    expect((screen.getByLabelText('To') as HTMLInputElement).value).toBe('2026-11-15');
  });

  it('names the targets with no note on the development branch, which has one name', async () => {
    render(App, (await page('')).props);
    const target = screen.getByRole('group', { name: 'Target' });
    expect(target.getAttribute('aria-describedby')).toBeNull();
    expect(target.textContent).not.toContain('rename');
  });

  it('shows the filters a hash restores', async () => {
    render(App, (await page('#/?target=all&component=block&standing=unknown&drafts=exclude')).props);
    expect((screen.getByRole('radio', { name: 'all' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Component') as HTMLSelectElement).value).toBe('block');
    expect((screen.getByLabelText('Author standing (earlier PRs)') as HTMLSelectElement).value).toBe('unknown');
    expect((screen.getByLabelText('Drafts') as HTMLSelectElement).value).toBe('exclude');
  });

  it('writes a change to the hash', async () => {
    const { props, loc } = await page('');
    render(App, props);
    await fireEvent.click(screen.getByRole('radio', { name: 'backports and other branches' }));
    const size = screen.getByLabelText('Size (lines added and deleted)') as HTMLSelectElement;
    size.value = 'gt1000';
    await fireEvent.change(size);
    const reopened = screen.getByLabelText('Reopened') as HTMLSelectElement;
    reopened.value = 'only';
    await fireEvent.change(reopened);
    expect(loc.hash()).toBe('#/?target=backports&size=gt1000&reopened=only');
  });

  describe('the Branch and Backport link filters', () => {
    const branch = () => screen.getByLabelText('Branch') as HTMLInputElement;
    const offered = () =>
      [...(document.getElementById(branch().getAttribute('list') as string) as HTMLDataListElement).options].map(
        (o) => `${o.value}: ${o.textContent}`,
      );

    it("offers the target's branches, most PRs in the period first, each with its count", async () => {
      const { props } = await page('#/?target=all');
      render(App, props);
      // The fixture's whole window: rows 0, 2–6 and 8–10 on master, one each on release-1.17, release-1.18 and release-1.19.
      expect(offered()).toEqual(['master: 9 PRs', 'release-1.17: 1 PR', 'release-1.18: 1 PR', 'release-1.19: 1 PR']);
      await fireEvent.click(screen.getByRole('radio', { name: 'backports and other branches' }));
      expect(offered()).toEqual(['release-1.17: 1 PR', 'release-1.18: 1 PR', 'release-1.19: 1 PR']);
      await fireEvent.click(screen.getByRole('radio', { name: 'master' }));
      expect(offered()).toEqual(['master: 9 PRs']);
    });

    it('writes a branch typed to the address, and returns it to any when the target leaves it out', async () => {
      const { props, loc } = await page('#/?target=backports');
      render(App, props);
      branch().value = 'Release-1.18';
      await fireEvent.change(branch());
      expect(loc.hash()).toBe('#/?target=backports&base=release-1.18');
      expect(branch().value).toBe('release-1.18');
      await fireEvent.click(screen.getByRole('radio', { name: 'all' }));
      expect(loc.hash()).toBe('#/?target=all&base=release-1.18');
      await fireEvent.click(screen.getByRole('radio', { name: 'master' }));
      expect(loc.hash()).toBe('#/?target=master');
      expect(branch().value).toBe('');
    });

    it('keeps the branch and says so when a name typed is not a branch of the target', async () => {
      const { props, loc } = await page('#/?target=backports&base=release-1.17');
      render(App, props);
      branch().value = 'master';
      await fireEvent.change(branch());
      expect(loc.hash()).toBe('#/?target=backports&base=release-1.17');
      expect(branch().value).toBe('release-1.17');
      expect(screen.getByText('No branch of this target is named “master”.')).toBeTruthy();
      await fireEvent.click(screen.getByRole('button', { name: 'Clear the Branch filter' }));
      expect(loc.hash()).toBe('#/?target=backports');
    });

    it('offers any, links its original and no link, and says what the link is beside it', async () => {
      const { props, loc } = await page('');
      render(App, props);
      const links = screen.getByLabelText('Backport link') as HTMLSelectElement;
      expect([...links.options].map((o) => [o.value, o.textContent])).toEqual([
        ['', 'any'],
        ['linked', 'links its original'],
        ['unlinked', 'no link'],
      ]);
      const hint = document.getElementById(links.getAttribute('aria-describedby') as string);
      expect(hint?.textContent).toBe(
        'Mergify’s “automatic backport of pull request #N”, a “backport of #N” line, or a “(backport #N)” or “(bp #N)” title; most release-branch PRs before 2020 have none.',
      );
      links.value = 'unlinked';
      await fireEvent.change(links);
      expect(loc.hash()).toBe('#/?target=master&backport=unlinked');
    });

    it('says when the data does not record the link, which then counts as none', async () => {
      const { backport_link: _, ...before } = prs2026;
      render(App, (await page('', { 'prs-2026.json': before })).props);
      const links = screen.getByLabelText('Backport link') as HTMLSelectElement;
      const hint = document.getElementById(links.getAttribute('aria-describedby') as string);
      expect(hint?.textContent).toContain('The data for 2026 does not record it, so every PR there counts as no link.');
    });
  });

  it('says what was disclosed in the AI use disclosure filter, its label and each choice', async () => {
    render(App, (await page('')).props);
    const disclosure = screen.getByLabelText('AI use disclosure') as HTMLSelectElement;
    expect([...disclosure.options].map((o) => [o.value, o.text])).toEqual([
      ['', 'all'],
      ['disclosed', 'AI use disclosed'],
      ['not-disclosed', 'AI use not disclosed'],
    ]);
  });

  it('offers every kind in meta, then unknown, under a Kind label', async () => {
    render(App, (await page('')).props);
    const kind = screen.getByLabelText('Kind') as HTMLSelectElement;
    expect(kind.tagName).toBe('SELECT');
    expect([...kind.options].map((o) => [o.value, o.text])).toEqual([
      ['', 'all'],
      ['bugfix', 'Bug fix'],
      ['feature', 'Feature'],
      ['cleanup', 'Cleanup'],
      ['docs', 'Documentation'],
      ['other', 'Other'],
      ['unknown', 'unknown'],
    ]);
    expect(kind.value).toBe('');
  });

  it('shows the kind a hash restores, and all for a kind meta does not name', async () => {
    render(App, (await page('#/?kind=unknown')).props);
    expect((screen.getByLabelText('Kind') as HTMLSelectElement).value).toBe('unknown');
    cleanup();
    render(App, (await page('#/?kind=refactor')).props);
    expect((screen.getByLabelText('Kind') as HTMLSelectElement).value).toBe('');
  });

  it('writes a kind to the hash, and clears it for all', async () => {
    const { props, loc } = await page('');
    render(App, props);
    const kind = screen.getByLabelText('Kind') as HTMLSelectElement;
    kind.value = 'docs';
    await fireEvent.change(kind);
    expect(loc.hash()).toBe('#/?target=master&kind=docs');
    kind.value = '';
    await fireEvent.change(kind);
    expect(loc.hash()).toBe('#/?target=master');
  });

  it('offers every login the data names to the Author and Reviewer filters, a bot marked', async () => {
    render(App, (await page('')).props);
    const author = screen.getByLabelText('Author') as HTMLInputElement;
    const reviewer = screen.getByLabelText('Reviewer') as HTMLInputElement;
    expect(author.type).toBe('text');
    expect(reviewer.getAttribute('list')).toBe(author.getAttribute('list'));
    const list = document.getElementById(author.getAttribute('list') as string) as HTMLDataListElement;
    expect([...list.options].map((o) => o.value)).toEqual(meta.people);
    expect([...list.options].find((o) => o.value === 'mergify')?.textContent).toBe('bot');
  });

  describe('with deleted accounts', () => {
    const named = parseMeta(deletedMeta());
    const authorInput = () => screen.getByLabelText('Author') as HTMLInputElement;

    it('offers each person as the page writes them: a named deleted account by its name, the pooled entry with what it pools', async () => {
      render(App, (await page('', {}, named)).props);
      const list = document.getElementById(authorInput().getAttribute('list') as string) as HTMLDataListElement;
      expect([...list.options].map((o) => o.value)).toEqual([
        ...meta.people,
        '(deleted, unknown)',
        `(deleted) ${NAME_A}`,
        `(deleted) ${NAME_B}`,
      ]);
      expect([...list.options].find((o) => o.value === '(deleted, unknown)')?.textContent).toBe(POOLED_NOTE);
      expect([...list.options].find((o) => o.value === `(deleted) ${NAME_A}`)?.textContent).toBe('');
      expect([...list.options].find((o) => o.value === 'mergify')?.textContent).toBe('bot');
    });

    it('shows a named deleted author an address restores as the page writes them', async () => {
      render(App, (await page(`#/?author=${encodeURIComponent(`ghost:${NAME_B}`)}`, {}, named)).props);
      expect(authorInput().value).toBe(`(deleted) ${NAME_B}`);
    });

    it('takes a named deleted author typed as the page writes them, and writes the address with the name', async () => {
      const { props, loc } = await page('', {}, named);
      render(App, props);
      authorInput().value = `(deleted) ${NAME_A}`;
      await fireEvent.change(authorInput());
      expect(loc.hash()).toBe(`#/?target=master&author=${encodeURIComponent(`ghost:${NAME_A}`)}`);
      expect(authorInput().value).toBe(`(deleted) ${NAME_A}`);
    });

    it('takes an old address with author=ghost as the pooled entry, and says beside the input what it pools', async () => {
      const { props, loc } = await page('#/?author=ghost', {}, named);
      render(App, props);
      expect(loc.hash()).toBe('#/?target=master&author=ghost');
      expect(authorInput().value).toBe('(deleted, unknown)');
      const note = screen.getByText(`(deleted, unknown): ${POOLED_NOTE}`);
      expect(authorInput().getAttribute('aria-describedby')?.split(' ')).toContain(note.id);
    });
  });

  it('shows the author and reviewer a hash restores, each with a way to clear it', async () => {
    const { props, loc } = await page('#/?author=fixture-author-d&reviewer=fixture-author-f');
    render(App, props);
    expect((screen.getByLabelText('Author') as HTMLInputElement).value).toBe('fixture-author-d');
    expect((screen.getByLabelText('Reviewer') as HTMLInputElement).value).toBe('fixture-author-f');
    await fireEvent.click(screen.getByRole('button', { name: 'Clear the Reviewer filter' }));
    expect(loc.hash()).toBe('#/?target=master&author=fixture-author-d');
    expect((screen.getByLabelText('Reviewer') as HTMLInputElement).value).toBe('');
    expect(screen.queryByRole('button', { name: 'Clear the Reviewer filter' })).toBeNull();
  });

  it('writes a login typed in any case to the hash as the data gives it, and clears it when emptied', async () => {
    const { props, loc } = await page('');
    render(App, props);
    const author = screen.getByLabelText('Author') as HTMLInputElement;
    author.value = ' Fixture-Author-A ';
    await fireEvent.change(author);
    expect(loc.hash()).toBe('#/?target=master&author=fixture-author-a');
    expect(author.value).toBe('fixture-author-a');
    author.value = '';
    await fireEvent.change(author);
    expect(loc.hash()).toBe('#/?target=master');
  });

  it('says beside the Reviewer input, in view, that it keeps the PRs reviewed or commented on in the period', async () => {
    render(App, (await page('')).props);
    const reviewer = screen.getByLabelText('Reviewer') as HTMLInputElement;
    const line = screen.getByText('PRs reviewed or commented on in the period');
    expect(line.tagName).toBe('P');
    expect(line.classList.contains('visually-hidden')).toBe(false);
    expect(reviewer.getAttribute('aria-describedby')?.split(' ')).toContain(line.id);
  });

  it('keeps the filter and says so when a login typed is not in the data', async () => {
    const { props, loc } = await page('#/?reviewer=fixture-author-e');
    render(App, props);
    const reviewer = screen.getByLabelText('Reviewer') as HTMLInputElement;
    reviewer.value = 'someone-else';
    await fireEvent.change(reviewer);
    expect(loc.hash()).toBe('#/?target=master&reviewer=fixture-author-e');
    expect(reviewer.value).toBe('fixture-author-e');
    expect(screen.getByText('No PR in the data names “someone-else”.')).toBeTruthy();
  });

  it('puts back a day outside the data rather than show what was typed', async () => {
    const { props, loc } = await page('');
    render(App, props);
    const from = screen.getByLabelText('From') as HTMLInputElement;
    from.value = '2026-01-01';
    await fireEvent.change(from);
    expect(from.value).toBe('2026-05-15');
    expect(loc.hash()).toBe('#/?target=master');
  });

  describe('over a window longer than six months', () => {
    const long = parseMeta({ ...rawMeta, window_start: Date.UTC(2025, 0, 1) / 1000 });
    const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed');

    it('opens on the whole window, its choice pressed, with the last six months one choice away', async () => {
      const { props, loc } = await page('', {}, long);
      render(App, props);
      expect(presets()).toEqual([`Last ${RECENT_MONTHS} months`, 'All, from 1 Jan 2025']);
      expect(pressed('All, from 1 Jan 2025')).toBe('true');
      expect(pressed('Last 6 months')).toBe('false');
      expect((screen.getByLabelText('From') as HTMLInputElement).value).toBe('2025-01-01');
      expect((screen.getByLabelText('To') as HTMLInputElement).value).toBe('2026-11-15');
      expect(loc.hash()).toBe('#/?target=master');
    });

    it('keeps a typed start inside the window', async () => {
      const { props, loc } = await page('', {}, long);
      render(App, props);
      const from = screen.getByLabelText('From') as HTMLInputElement;
      expect(from.value).toBe('2025-01-01');
      expect(from.min).toBe('2025-01-01');
      from.value = '2025-03-01';
      await fireEvent.change(from);
      expect(from.value).toBe('2025-03-01');
      expect(loc.hash()).toBe('#/?target=master&from=2025-03-01');
    });

    it('moves the period to the last six months and back to the whole window in one choice each', async () => {
      const { props, loc } = await page('#/?from=2026-07-01&to=2026-08-31', {}, long);
      render(App, props);
      expect(pressed('Last 6 months')).toBe('false');
      expect(pressed('All, from 1 Jan 2025')).toBe('false');

      await fireEvent.click(screen.getByRole('button', { name: 'Last 6 months' }));
      expect(loc.hash()).toBe('#/?target=master&from=2026-05-15');
      expect((screen.getByLabelText('From') as HTMLInputElement).value).toBe('2026-05-15');
      expect((screen.getByLabelText('To') as HTMLInputElement).value).toBe('2026-11-15');
      expect(pressed('Last 6 months')).toBe('true');
      expect(pressed('All, from 1 Jan 2025')).toBe('false');

      await fireEvent.click(screen.getByRole('button', { name: 'All, from 1 Jan 2025' }));
      expect(loc.hash()).toBe('#/?target=master');
      expect(pressed('All, from 1 Jan 2025')).toBe('true');
      expect(pressed('Last 6 months')).toBe('false');
    });
  });

  /** The labels of the period's one-choice buttons. */
  const presets = () => [...document.querySelectorAll('.presets button')].map((b) => b.textContent?.trim());

  it('offers one choice, the whole window, pressed, when the window is six months long', async () => {
    render(App, (await page('')).props);
    expect(presets()).toEqual(['All, from 15 May 2026']);
    expect(screen.getByRole('button', { name: 'All, from 15 May 2026' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('offers one choice, the whole window, when the window is shorter than the default reach', async () => {
    const short = parseMeta({ ...rawMeta, window_start: Date.UTC(2026, 8, 1) / 1000 });
    const { props, loc } = await page('', {}, short);
    render(App, props);
    expect(presets()).toEqual(['All, from 1 Sep 2026']);
    expect(screen.getByRole('button', { name: 'All, from 1 Sep 2026' }).getAttribute('aria-pressed')).toBe('true');
    expect(loc.hash()).toBe('#/?target=master');
  });
});
