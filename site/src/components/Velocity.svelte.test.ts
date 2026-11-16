// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { beforeAll, describe, expect, it } from 'vitest';
import App from '../App.svelte';
import { fixturePage, meta } from '../lib/__fixtures__/page';
import { AGE_BANDS, periodRange } from '../lib/filters';
import { select } from '../lib/select';
import { defaultFilters } from '../lib/state';
import { backlog } from '../lib/stats/backlog';
import { fixture } from '../lib/stats/testing';
import { weekly } from '../lib/stats/weekly';

beforeAll(() => {
  window.matchMedia = (query: string) =>
    ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;
});

const data = fixture();
const filters = defaultFilters(meta);
const period = periodRange(filters);
const rows = select(data, filters);

const PRS = 'PRs opened, merged and closed unmerged, per week';
const BACKLOG = 'Open PRs at the end of each week, by age';

function section() {
  return within(screen.getByRole('region', { name: 'Velocity' }));
}

/** The text of each body row's cells in a figure's table. */
function cells(figure: HTMLElement): string[][] {
  return within(figure)
    .getAllByRole('row')
    .slice(1)
    .map((r) => [...r.querySelectorAll('td')].map((td) => td.textContent ?? ''));
}

describe('Velocity', () => {
  it('draws the PRs opened, merged and closed per week that the library counts', async () => {
    render(App, (await fixturePage('')).props);
    const opened = weekly(data, rows, period, 'opened').values;
    const merged = weekly(data, rows, period, 'merged').values['merged'] as number[];
    const closed = weekly(data, rows, period, 'closed').values['closed'] as number[];
    const notDisclosed = opened['not-disclosed'] as number[];
    const disclosed = opened['disclosed'] as number[];
    const figure = section().getByRole('figure', { name: PRS });
    expect(cells(figure)).toEqual(
      notDisclosed.map((n, i) =>
        [n, disclosed[i] as number, n + (disclosed[i] as number), merged[i] as number, closed[i] as number].map(String),
      ),
    );
    const segments = [...notDisclosed, ...disclosed].filter((v) => v > 0).length;
    expect(figure.querySelectorAll('.bar')).toHaveLength(segments);
    expect(figure.querySelectorAll('.line')).toHaveLength(2);
    expect(figure.querySelector('.visually-hidden')?.textContent).toMatch(/^By week, 27 weeks from 2026-05-11 to 2026-11-09\. 7 opened \(4 AI use not disclosed, 3 AI use disclosed\)/);
  });

  it('sets PRs opened over PRs merged and closed in two panels on one shared scale, no line over a bar', async () => {
    render(App, (await fixturePage('')).props);
    const figure = section().getByRole('figure', { name: PRS });
    const [opened, finished] = [...figure.querySelectorAll('.plot-panel')];
    expect(opened?.querySelectorAll('.line')).toHaveLength(0);
    expect(finished?.querySelectorAll('.bar')).toHaveLength(0);
    expect(finished?.querySelectorAll('.line')).toHaveLength(2);
    // Both count PRs a week, on the one scale: their top ticks agree.
    const tops = [...figure.querySelectorAll('.axis-y')].map((a) => [...a.querySelectorAll('text:not(.unit)')].at(-1)?.textContent);
    expect(tops).toHaveLength(2);
    expect(tops[0]).toBe(tops[1]);
  });

  it('marks the weeks the period and the fetch cut short', async () => {
    render(App, (await fixturePage('')).props);
    const figure = section().getByRole('figure', { name: PRS });
    const heads = within(figure)
      .getAllByRole('rowheader')
      .map((h) => h.textContent);
    // The period starts on Friday 05-15; the data was fetched on Sunday 11-15 at 06:00.
    expect(heads[0]).toBe('week of 2026-05-11, partial: 3 of 7 days');
    expect(heads[1]).toBe('week of 2026-05-18');
    expect(heads.at(-1)).toBe('week of 2026-11-09, partial: 6 of 7 days');
    expect(within(figure).getByRole('button', { name: /^week of 2026-05-11, partial: 3 of 7 days: / })).toBeTruthy();
    expect(within(figure).getByRole('list', { name: 'Legend' }).textContent).toContain('partial week');
  });

  it('draws the open backlog by age band that the library counts', async () => {
    render(App, (await fixturePage('')).props);
    const bands = backlog(data, rows, period).bands;
    const figure = section().getByRole('figure', { name: BACKLOG });
    const expected = bands.lt7.map((_, i) => {
      const values = AGE_BANDS.map((b) => bands[b.id][i] as number);
      return [...values, values.reduce((a, b) => a + b, 0)].map(String);
    });
    expect(cells(figure)).toEqual(expected);
    expect(figure.querySelectorAll('.layer')).toHaveLength(4);
  });

  it('says "no PRs match" in every chart when the selection is empty', async () => {
    render(App, (await fixturePage('#/?component=cephfs&kind=docs')).props);
    for (const name of [PRS, BACKLOG]) {
      const figure = section().getByRole('figure', { name });
      expect(figure.textContent).toContain('no PRs match');
      expect(figure.querySelector('svg.plot, .plot')).toBeNull();
    }
  });

  it('writes a chosen week to the URL, and marks it', async () => {
    const { props, loc } = await fixturePage('');
    render(App, props);
    const figure = section().getByRole('figure', { name: PRS });
    await fireEvent.click(within(figure).getByRole('button', { name: /^week of 2026-05-18:/ }));
    expect(loc.hash()).toBe('#/?target=main&week=2026-05-18');
    expect(within(figure).getByRole('button', { name: /^week of 2026-05-18:/ }).getAttribute('aria-pressed')).toBe('true');
  });

  it('writes a chosen backlog band and its week to the URL', async () => {
    const { props, loc } = await fixturePage('');
    render(App, props);
    const figure = section().getByRole('figure', { name: BACKLOG });
    await fireEvent.click(within(figure).getByRole('button', { name: 'week of 2026-06-01, 30–90 days: 1 of 3 open' }));
    expect(loc.hash()).toBe('#/?target=main&week=2026-06-01&band=30-90');
  });
});
