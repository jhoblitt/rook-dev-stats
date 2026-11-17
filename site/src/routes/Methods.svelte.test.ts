// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App.svelte';
import { withEarlierYear, withYears } from '../lib/__fixtures__/fetch';
import { fixturePage } from '../lib/__fixtures__/page';
import { sections } from '../lib/methods/sections';
import { stateFromHash } from '../lib/state';

/** The ids of the elements scrolled into view, in order. */
let scrolled: string[] = [];
/** How many times the window was scrolled to the top. */
let toTop = 0;

beforeAll(() => {
  // jsdom has no matchMedia, which the theme toggle asks, nor scrolling.
  window.matchMedia = (query: string) =>
    ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this.id);
  };
  window.scrollTo = ((x: number, y: number) => {
    if (x === 0 && y === 0) toTop++;
  }) as typeof window.scrollTo;
});

beforeEach(() => {
  scrolled = [];
  toTop = 0;
});

async function methods(files: Record<string, unknown> = {}, hash = '#/methods') {
  const { props, loc } = await fixturePage(hash, files);
  // What the page itself asks the loader for, not the report's first load.
  const load = vi.spyOn(props.page.loader, 'load');
  const table = vi.spyOn(props.page.loader, 'table');
  render(App, props);
  return { main: screen.getByRole('main'), loc, page: props.page, load, table };
}

const article = () => screen.getByRole('main').querySelector('article') as HTMLElement;

describe('the methods page', () => {
  it('draws every section under its id, with its title', async () => {
    const { main } = await methods();
    for (const s of sections()) {
      const el = main.querySelector(`section#${s.id}`);
      expect(el, s.id).not.toBeNull();
      expect(within(el as HTMLElement).getByRole('heading', { level: 2 }).textContent).toBe(s.title);
    }
  });

  it('gives disclosure the anchor the rest of the site links to', async () => {
    const { main } = await methods();
    expect(main.querySelector('section#disclosure h2')?.textContent).toBe('Disclosure of AI use');
  });

  it('lists every section in its contents, each link leading to a section on the page', async () => {
    const { main } = await methods();
    const nav = within(screen.getByRole('navigation', { name: 'Contents' }));
    const links = nav.getAllByRole('link');
    expect(links.map((a) => a.textContent)).toEqual(sections().map((s) => s.title));
    for (const a of links) expect(main.querySelector(`#${a.dataset['target']}`), a.textContent ?? '').not.toBeNull();
  });

  it('gives each contents link the address of its section, which survives being copied', async () => {
    await methods();
    const link = within(screen.getByRole('navigation', { name: 'Contents' })).getByRole('link', {
      name: 'Disclosure of AI use',
    });
    expect(link.getAttribute('href')).toBe('#/methods?target=master&section=disclosure');
  });

  it('moves to a section from its contents link, naming it in the address', async () => {
    const { loc } = await methods();
    const link = within(screen.getByRole('navigation', { name: 'Contents' })).getByRole('link', {
      name: 'Disclosure of AI use',
    });
    await fireEvent.click(link);
    expect(loc.hash()).toBe('#/methods?target=master&section=disclosure');
    await waitFor(() => expect(document.activeElement?.id).toBe('disclosure'));
    expect(scrolled.at(-1)).toBe('disclosure');
  });

  it('moves again to the section the address already names when its link is followed', async () => {
    const { loc } = await methods({}, '#/methods?section=disclosure');
    await waitFor(() => expect(document.activeElement?.id).toBe('disclosure'));
    (document.activeElement as HTMLElement).blur();
    const link = within(screen.getByRole('navigation', { name: 'Contents' })).getByRole('link', {
      name: 'Disclosure of AI use',
    });
    await fireEvent.click(link);
    expect(loc.hash()).toBe('#/methods?target=master&section=disclosure');
    expect(document.activeElement?.id).toBe('disclosure');
  });

  it('follows a link to another section inside the prose through the address', async () => {
    const { loc } = await methods();
    const section = document.getElementById('responses') as HTMLElement;
    const link = within(section).getByRole('link', { name: 'bot command' });
    expect(link.getAttribute('href')).toBe('#/methods?target=master&section=commands');
    await fireEvent.click(link);
    expect(loc.hash()).toBe('#/methods?target=master&section=commands');
    await waitFor(() => expect(document.activeElement?.id).toBe('commands'));
  });

  it('opens at the section its address names', async () => {
    await methods({}, '#/methods?target=master&section=commands');
    await waitFor(() => expect(document.activeElement?.id).toBe('commands'));
    expect(scrolled).toContain('commands');
  });

  it('opens at a subheading its address names', async () => {
    await methods({}, '#/methods?section=privacy-what-is-withheld');
    await waitFor(() => expect(document.activeElement?.id).toBe('privacy-what-is-withheld'));
  });

  it('opens at the top for a section the page does not have', async () => {
    const { loc } = await methods({}, '#/methods?section=nowhere');
    await new Promise((r) => setTimeout(r, 10));
    expect(scrolled).toEqual([]);
    expect(loc.hash()).toBe('#/methods?target=master');
  });

  it("lands on the disclosure section from the AI-use section's link", async () => {
    const { page } = await methods({}, '#/');
    const link = screen.getByRole('link', { name: 'How disclosure is detected, and what it cannot show' });
    const href = link.getAttribute('href') as string;
    expect(href).toBe('#/methods?target=master&section=disclosure');
    page.selection.set(stateFromHash(href, page.meta));
    await waitFor(() => expect(document.activeElement?.id).toBe('disclosure'));
    expect(scrolled.at(-1)).toBe('disclosure');
    // The app leaves the move to the methods page rather than scrolling to the top first.
    expect(toTop).toBe(0);
  });

  it('goes back to the top when the address stops naming a section, as a fresh page would', async () => {
    const { page } = await methods({}, '#/methods?target=master&section=commands');
    await waitFor(() => expect(document.activeElement?.id).toBe('commands'));
    page.selection.set(stateFromHash('#/methods?target=master', page.meta));
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Methods'));
    expect(toTop).toBe(1);
  });

  it('stays at the top when the page opens with no section, and moves nowhere', async () => {
    await methods({}, '#/methods?target=master');
    await new Promise((r) => setTimeout(r, 10));
    expect(toTop).toBe(0);
    expect(scrolled).toEqual([]);
  });

  it('starts the report at the top when coming back from a section of the methods page', async () => {
    const { page } = await methods({}, '#/methods?target=master&section=commands');
    await waitFor(() => expect(document.activeElement?.id).toBe('commands'));
    page.selection.set(stateFromHash('#/?target=master', page.meta));
    await waitFor(() => expect(toTop).toBe(1));
    expect(document.activeElement?.tagName).toBe('MAIN');
  });

  it('shows the figures computed from the data, with the date the data runs to', async () => {
    await methods();
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    const text = article().textContent ?? '';
    expect(text).toContain(
      'On the data as of 2026-11-15, 12 pull requests, on every branch, were open at some point in the last 6 months, 2026-05-15 to 2026-11-15: 9 opened in them and 3 before them.',
    );
    expect(text).toContain('1 of the 12 pull requests open at some point in the last 6 months are of unknown kind (8.3%)');
    expect(text).toContain('3 (27%) were bot commands, 2 of them by the pull request');
    expect(text).toContain('0 of the 7 force-pushes in the last 6 months (0%) and 0 of the 6 merges in it have no commit to link to');
    expect(text.replace(/\s+/g, ' ')).toContain('as of 2026-11-15, over the last 6 months of it, 2026-05-15 to 2026-11-15; the report itself opens on the whole window.');
    const kinds = screen.getByRole('table', { name: /Where each pull request’s kind came from/ });
    expect(within(kinds).getByRole('row', { name: /an issue it closes/ }).textContent).toMatch(/an issue it closes\s*2\s*0\s*2/);
  });

  it("loads only the years from the last six months' start onward, and only their tables", async () => {
    // With 2025 before the fixture's year: the last six months, from
    // 2026-05-15, need 2026's files alone, though the report opens on both years.
    const { load, table } = await methods(withEarlierYear());
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(load.mock.calls).toEqual([[[2026]]]);
    expect(table.mock.calls).toEqual([[2026]]);
  });

  it('fetches on a fresh load of a ten-year window only the last six months’ year files and tables', async () => {
    const { props, requested } = await fixturePage('#/methods', withYears(2016, 1));
    render(App, props);
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(requested.map((u) => u.slice(u.lastIndexOf('/') + 1))).toEqual([
      'prs-2026.json',
      'events-2026.json',
      'table-2026.json',
    ]);
  });

  it("fetches on a fresh load only the last six months' year files and tables, though the address carries a longer period", async () => {
    const { props, requested } = await fixturePage('#/methods?from=2025-03-01', withEarlierYear());
    render(App, props);
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(requested.map((u) => u.slice(u.lastIndexOf('/') + 1))).toEqual([
      'prs-2026.json',
      'events-2026.json',
      'table-2026.json',
    ]);
  });

  it('shows a loading state until the figures are computed', async () => {
    await methods();
    expect(screen.getByRole('status').textContent).toMatch(/Loading the data the figures on this page are computed from/);
  });

  it('keeps the prose and the other figures when a table file fails, and says which', async () => {
    await methods({ 'table-2026.json': undefined });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/table-2026\.json: HTTP 404/));
    const text = article().textContent ?? '';
    expect(text).toContain('12 pull requests, on every branch, were open at some point in the last 6 months');
    expect(text).toContain('(not available) of the (not available) force-pushes');
    expect(text).toContain('This table could not be computed');
    for (const s of sections()) expect(document.getElementById(s.id)).not.toBeNull();
  });

  it('keeps the prose when a year of data fails', async () => {
    await methods({ 'events-2026.json': undefined });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/events-2026\.json: HTTP 404/));
    expect(article().textContent).toContain('(not available) pull requests, on every branch, were open at some point in the last 6 months');
    expect(article().textContent).toContain("Ceph's rule asking for an Assisted-by trailer was a draft on 2026-10-12.");
  });
});

describe('the methods renderer', () => {
  it('never inserts markup as HTML', () => {
    const sources: Record<string, string> = import.meta.glob(['../lib/methods/*.svelte', './Methods.svelte'], {
      query: '?raw',
      import: 'default',
      eager: true,
    });
    expect(Object.keys(sources).length).toBeGreaterThan(1);
    for (const [path, source] of Object.entries(sources)) expect(source, path).not.toContain('{@html');
  });
});
