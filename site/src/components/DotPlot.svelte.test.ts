// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { beforeAll, describe, expect, it } from 'vitest';
import App from '../App.svelte';
import { fixturePage, meta } from '../lib/__fixtures__/page';
import { describeDots, dotLayout, dots, dotsTable, project } from '../lib/dots';
import { periodRange } from '../lib/filters';
import { openedIn, select } from '../lib/select';
import { defaultFilters } from '../lib/state';
import { fixture } from '../lib/stats/testing';

beforeAll(() => {
  window.matchMedia = (query: string) =>
    ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;
  // jsdom has no canvas; the plot draws nothing and keeps working.
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
});

const data = fixture();
const filters = defaultFilters(meta);
const period = periodRange(filters);
const d = dots(data, openedIn(data, select(data, filters), period));

const TITLE = 'Days to merge or close, each PR opened in the period';

function figure() {
  return within(screen.getByRole('region', { name: 'Each PR' })).getByRole('figure', { name: TITLE });
}

/** Where the fixture's PR `n` is drawn, at jsdom's default width. */
function at(n: number): { clientX: number; clientY: number } {
  const i = [...d.rows].findIndex((r) => data.prs.number[r] === n);
  const { xs, ys } = project(d, dotLayout(period, d.longest, 640, 360));
  return { clientX: xs[i] as number, clientY: ys[i] as number };
}

describe('DotPlot', () => {
  it('draws the PRs opened in the period on a canvas, with a text alternative and a table of counts', async () => {
    render(App, (await fixturePage('')).props);
    const f = figure();
    expect(f.querySelector('canvas')).not.toBeNull();
    expect(f.querySelector('.visually-hidden')?.textContent).toBe(describeDots(d));
    const rows = within(f)
      .getAllByRole('row')
      .slice(1)
      .map((r) => [...r.querySelectorAll('th, td')].map((c) => c.textContent));
    expect(rows).toEqual(dotsTable(d).rows.map((r) => [r.head, ...r.cells]));
    expect(f.textContent).toContain('The PR table below lists these PRs, and those opened before the period that were still open in it');
  });

  it('says what was disclosed in its legend', async () => {
    render(App, (await fixturePage('')).props);
    expect([...figure().querySelectorAll('ul.legend li')].map((li) => li.textContent?.trim())).toEqual(
      expect.arrayContaining(['AI use not disclosed', 'AI use disclosed']),
    );
  });

  it('names the PR under the pointer with its values', async () => {
    render(App, (await fixturePage('')).props);
    const canvas = figure().querySelector('canvas') as HTMLCanvasElement;
    await fireEvent.mouseMove(canvas, at(66500));
    const tip = figure().querySelector('.tip');
    expect(tip?.textContent).toContain('#66500');
    expect(tip?.textContent).toContain('2026-05-18');
    expect(tip?.textContent).toContain('disclosed');
    await fireEvent.mouseLeave(canvas);
    expect(figure().querySelector('.tip')).toBeNull();
  });

  it('writes the PR clicked to the URL, and marks it', async () => {
    const { props, loc } = await fixturePage('');
    render(App, props);
    const canvas = figure().querySelector('canvas') as HTMLCanvasElement;
    await fireEvent.click(canvas, at(67100));
    expect(loc.hash()).toBe('#/?target=main&pr=67100');
    expect(figure().querySelector('.selected-ring')).not.toBeNull();
  });

  it('draws again at a new device pixel ratio when the width stays the same', async () => {
    const listeners: (() => void)[] = [];
    const before = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      addEventListener: (_: string, fn: () => void) => {
        if (query.startsWith('(resolution')) listeners.push(fn);
      },
      removeEventListener() {},
    })) as unknown as typeof window.matchMedia;
    const getContext = HTMLCanvasElement.prototype.getContext;
    const noop = () => {};
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
      return new Proxy({}, { get: () => noop, set: () => true });
    } as unknown as HTMLCanvasElement['getContext'];
    try {
      Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true });
      render(App, (await fixturePage('')).props);
      const canvas = figure().querySelector('canvas') as HTMLCanvasElement;
      await tick();
      expect(canvas.width).toBe(640);
      Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
      for (const fn of listeners) fn();
      await tick();
      expect(canvas.width).toBe(1280);
    } finally {
      window.matchMedia = before;
      HTMLCanvasElement.prototype.getContext = getContext;
    }
  });

  it('leaves the URL alone for a click away from every dot', async () => {
    const { props, loc } = await fixturePage('');
    render(App, props);
    const canvas = figure().querySelector('canvas') as HTMLCanvasElement;
    await fireEvent.click(canvas, { clientX: 2, clientY: 2 });
    expect(loc.hash()).toBe('#/?target=main');
  });

  it('says "no PRs match" for an empty selection, and what is missing when none was opened in the period', async () => {
    render(App, (await fixturePage('#/?component=cephfs&kind=docs')).props);
    expect(figure().textContent).toContain('no PRs match');
    expect(figure().querySelector('canvas')).toBeNull();
  });

  it('says no PR was opened when the PRs selected were all opened before the period', async () => {
    render(App, (await fixturePage('#/?from=2026-11-12')).props);
    expect(figure().textContent).toContain('no PR was opened in this period');
    expect(figure().textContent).not.toContain('no PRs match');
  });
});
