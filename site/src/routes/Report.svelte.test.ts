// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import App from '../App.svelte';
import { withEarlierYear } from '../lib/__fixtures__/fetch';
import { fixturePage } from '../lib/__fixtures__/page';
import type { Fetch } from '../lib/data';
import { stateFromHash } from '../lib/state';

/** The ids of the elements scrolled into view, in order. */
let scrolled: string[] = [];

beforeAll(() => {
  // jsdom has no matchMedia, which the theme toggle asks, nor scrolling.
  window.matchMedia = (query: string) =>
    ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this.id);
  };
  window.scrollTo = (() => {}) as typeof window.scrollTo;
});

beforeEach(() => {
  scrolled = [];
});

async function report(hash: string, files: Record<string, unknown> = {}, wrap?: (f: Fetch) => Fetch) {
  const { props, loc } = await fixturePage(hash, files, wrap);
  render(App, props);
  return { loc, page: props.page };
}

const SECTIONS = [
  ['Velocity', 'velocity', 'velocity'],
  ['Review', 'review', 'review'],
  ['AI use', 'ai-use', 'llm'],
  ['Each PR', 'each-pr', 'dots'],
  ['Timelines', 'timelines', 'timelines'],
  ['Pull requests', 'pull-requests', 'table'],
  ['People', 'people', 'people'],
] as const;

describe('a link to a section of the report', () => {
  it.each(SECTIONS)(
    'gives the %s heading a link to its section that keeps the filters',
    async (title, name, id) => {
      await report('#/?target=all&from=2026-06-01&to=2026-08-31&kind=docs');
      const section = document.getElementById(id) as HTMLElement;
      expect(within(section).getByRole('heading', { level: 2, name: title })).toBeTruthy();
      const link = within(section).getByRole('link', { name: `Link to the ${title} section` });
      expect(link.getAttribute('href')).toBe(`#/?target=all&from=2026-06-01&to=2026-08-31&kind=docs&section=${name}`);
    },
  );

  it('opens at the section its address names, scrolled to and focused', async () => {
    await report('#/?target=main&section=review');
    await waitFor(() => expect(document.activeElement?.id).toBe('review'));
    expect(scrolled).toContain('review');
  });

  it('moves to the section once it is drawn, when its years are still loading', async () => {
    const earlier = withEarlierYear();
    const held: (() => void)[] = [];
    const hold = (f: Fetch): Fetch => (url) =>
      url.includes('-2025') ? new Promise((go) => held.push(() => go(f(url)))) : f(url);
    const { page } = await report('#/methods?from=2025-03-01', earlier, hold);
    page.selection.set(stateFromHash('#/?from=2025-03-01&section=people', page.meta));
    await waitFor(() => expect(held.length).toBeGreaterThan(0));
    expect(document.getElementById('people')).toBeNull();
    expect(scrolled).toEqual([]);
    for (const go of held.splice(0)) go();
    await waitFor(() => expect(document.activeElement?.id).toBe('people'));
    expect(scrolled).toContain('people');
  });

  it('moves to the section from its heading link, naming it in the address', async () => {
    const { loc } = await report('#/?target=main');
    const link = screen.getByRole('link', { name: 'Link to the People section' });
    await fireEvent.click(link);
    expect(loc.hash()).toBe('#/?target=main&section=people');
    await waitFor(() => expect(document.activeElement?.id).toBe('people'));
    expect(scrolled.at(-1)).toBe('people');
  });

  it('moves again to the section the address already names when its link is followed', async () => {
    const { loc } = await report('#/?target=main&section=people');
    await waitFor(() => expect(document.activeElement?.id).toBe('people'));
    (document.activeElement as HTMLElement).blur();
    scrolled = [];
    await fireEvent.click(screen.getByRole('link', { name: 'Link to the People section' }));
    expect(loc.hash()).toBe('#/?target=main&section=people');
    expect(document.activeElement?.id).toBe('people');
    expect(scrolled).toEqual(['people']);
  });

  it('keeps the section in the address when a filter changes, and does not move there again', async () => {
    const { page, loc } = await report('#/?target=main&section=review');
    await waitFor(() => expect(document.activeElement?.id).toBe('review'));
    scrolled = [];
    page.selection.update((s) => ({ ...s, filters: { ...s.filters, kind: 'docs' } }));
    await new Promise((r) => setTimeout(r, 10));
    expect(loc.hash()).toBe('#/?target=main&kind=docs&section=review');
    expect(scrolled).toEqual([]);
  });

  it('leaves the scroll alone when the address stops naming a section', async () => {
    const { page } = await report('#/?target=main&section=review');
    await waitFor(() => expect(document.activeElement?.id).toBe('review'));
    scrolled = [];
    page.selection.set(stateFromHash('#/?target=main', page.meta));
    await new Promise((r) => setTimeout(r, 10));
    expect(scrolled).toEqual([]);
  });
});
