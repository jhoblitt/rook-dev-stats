// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { beforeAll, describe, expect, it } from 'vitest';
import App from '../App.svelte';
import rawPrs2026 from '../lib/__fixtures__/data/prs-2026.json';
import { fixturePage } from '../lib/__fixtures__/page';
import { at } from '../lib/stats/testing';

beforeAll(() => {
  window.matchMedia = (query: string) =>
    ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;
});

/** 2026's PRs replaced by `n` open ones on master, an hour apart from 1 June, with no events. */
function manyPrs(n: number): Record<string, unknown> {
  const columns = Object.keys(rawPrs2026);
  const value = (column: string, i: number): unknown => {
    switch (column) {
      case 'number':
        return 70000 + i;
      case 'created':
      case 'ready':
        return at('2026-06-01T00:00:00Z') + i * 3600;
      case 'closed':
      case 'first_commit':
      case 'last_commit':
      case 'first_response':
      case 'first_approval':
      case 'standing':
      case 'kind':
        return -1;
      case 'in_window':
      case 'files':
      case 'commits':
        return 1;
      case 'families':
      case 'components':
        return [];
      default:
        return 0;
    }
  };
  const prs = Object.fromEntries(columns.map((c) => [c, Array.from({ length: n }, (_, i) => value(c, i))]));
  const events = { pr: [], at: [], kind: [], sub: [], actor: [] };
  return { 'prs-2026.json': prs, 'events-2026.json': events, 'table-2026.json': undefined };
}

async function lanes(hash: string, files: Record<string, unknown> = {}) {
  const { props, loc } = await fixturePage(hash, files);
  render(App, { props });
  return { section: within(screen.getByRole('region', { name: 'Timelines' })), loc };
}

describe('Lanes', () => {
  it('draws at most 200 lanes, the most recently opened in the default order, and says how many of how many', async () => {
    const { section } = await lanes('#/?target=master', manyPrs(250));
    // 250 opened in 2026, all on master, in place of the fixture's 2026 file.
    expect(
      section.getByText('The 200 most recently opened of 250 PRs open at some point in the period, in the PR table’s order, by Opened, descending.'),
    ).toBeTruthy();
    const list = section.getByRole("list", { name: /PRs in the lanes/ });
    const links = within(list).getAllByRole('link');
    expect(links).toHaveLength(200);
    expect(links[0]?.textContent).toBe('#70249');
    expect(links.at(-1)?.textContent).toBe('#70050');
  });

  it('describes the lanes for a reader who cannot see the canvas', async () => {
    const { section } = await lanes('#/?target=all');
    const figure = section.getByRole('figure', { name: 'Each PR’s timeline, one per row' });
    expect(figure.getAttribute('aria-describedby')).toBeTruthy();
    const summary = document.getElementById(figure.getAttribute('aria-describedby') as string);
    expect(summary?.textContent).toMatch(
      /^The timelines of 12 PRs, one per row, in the PR table’s order, by Opened, descending, each drawn only within the calendar shown, 15 May 2026 to 15 Nov 2026, inside the period: from #67250/,
    );
    expect(summary?.textContent).toMatch(/ What became of them by the last fetch, shown or not: 6 merged, /);
    // The room after the last fetch reaches the period's end, so the calendar is the period and says nothing more.
    expect(section.queryByText(/^The calendar runs over/)).toBeNull();
    // The line saying which PRs and in what order shows whatever their count.
    expect(section.getByText('12 PRs open at some point in the period, in the PR table’s order, by Opened, descending.')).toBeTruthy();
    expect(section.getByRole('img').getAttribute('aria-label')).toBe('12 lanes, one per PR; each is a link in the list below.');
  });

  it('opens a PR’s timeline from its link', async () => {
    const { section, loc } = await lanes('#/?target=all');
    const list = section.getByRole("list", { name: /PRs in the lanes/ });
    const link = within(list).getByRole('link', { name: '#66500' });
    expect(link.getAttribute('href')).toBe('#/?target=all&pr=66500');
    await fireEvent.click(link);
    expect(loc.hash()).toBe('#/?target=all&pr=66500');
    expect(await screen.findByRole('region', { name: 'Pull request #66500' })).toBeTruthy();
  });

  it('opens the PR of a tapped lane, from the tap’s own place, with no pointer move before it', async () => {
    const { section, loc } = await lanes('#/?target=all');
    const canvas = section.getByRole('img').querySelector('canvas') as HTMLCanvasElement;
    // 12 lanes are 14 pixels apart under a 4-pixel margin: y 4 + 14 + 7 is the second, #67100.
    const click = new MouseEvent('click', { bubbles: true });
    Object.defineProperty(click, 'offsetY', { value: 4 + 14 + 7 });
    await fireEvent(canvas, click);
    expect(loc.hash()).toBe('#/?target=all&pr=67100');
  });

  it('lists the PR table’s first 200 rows in the order the table is sorted, and says so', async () => {
    const { section, loc } = await lanes('#/?target=master&sort=number', manyPrs(250));
    expect(section.getByText('The first 200 in the PR table’s order, by PR, ascending, of 250 PRs open at some point in the period.')).toBeTruthy();
    const links = () => within(section.getByRole('list', { name: /PRs in the lanes/ })).getAllByRole('link');
    expect(links()[0]?.textContent).toBe('#70000');
    expect(links()[1]?.textContent).toBe('#70001');
    expect(links().at(-1)?.textContent).toBe('#70199');
    const table = within(screen.getByRole('region', { name: 'Pull requests' }));
    await fireEvent.click(table.getByRole('button', { name: /^PR/ }));
    expect(loc.hash()).toBe('#/?target=master&sort=-number');
    expect(links()[0]?.textContent).toBe('#70249');
    expect(section.getByText('The first 200 in the PR table’s order, by PR, descending, of 250 PRs open at some point in the period.')).toBeTruthy();
  });

  it('follows a week chosen in a chart, as the PR table does', async () => {
    const { section } = await lanes('#/?target=all&week=2026-05-18');
    const links = within(section.getByRole('list', { name: /PRs in the lanes/ })).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['#66510', '#66500']);
    // The calendar runs from #66500's opening to #66510's close, not over the whole history, and says so.
    expect(section.getByText('The calendar runs over the part of the period these PRs take up, 18 May 2026 to 1 Jun 2026.')).toBeTruthy();
    expect([...section.getByRole('figure').querySelectorAll('.axis-x text')][0]?.textContent).toBe('18 May 2026');
    // The lanes say which PRs in the PR table's own words.
    expect(section.getByText('2 PRs opened in the week of 2026-05-18, in the PR table’s order, by Opened, descending.')).toBeTruthy();
    const table = within(screen.getByRole('region', { name: 'Pull requests' }));
    expect(table.getByText(/^2 PRs opened in the week of 2026-05-18$/)).toBeTruthy();
  });

  it('says so when an age band chosen in a chart narrows them', async () => {
    const { section } = await lanes('#/?target=master&week=2026-06-01&band=30-90');
    expect(
      section.getByText(
        /^1 PR open at the end of the week of 2026-06-01, aged 30–90 days, in the PR table’s order, by Opened, descending\.$/,
      ),
    ).toBeTruthy();
  });

  it('switches the time axis to days since opening', async () => {
    const { section } = await lanes('#/?target=all');
    await fireEvent.click(section.getByRole('radio', { name: 'Days since opening' }));
    expect(section.getByText(/Each row starts when its PR opened, on a log scale from an hour, and runs to its end, whatever the period/)).toBeTruthy();
    expect(section.queryByText('before opening, from the first commit')).toBeNull();
    expect(section.queryByText(/its life goes on (earlier|later) than shown/)).toBeNull();
  });

  it('draws the calendar over the period, cut at its edges, and says so in every word; days since opening, whole lives', async () => {
    // One day, 10 November 2026, the day #67250 opened; the fixture's other PRs opened before it.
    const { section } = await lanes('#/?target=all&from=2026-11-10&to=2026-11-10');
    const legend = within(section.getByRole('list', { name: 'Legend' }));
    expect(legend.getByText('its life goes on earlier than shown')).toBeTruthy();
    expect(legend.getByText('its life goes on later than shown')).toBeTruthy();
    const axis = section.getByRole('figure').querySelectorAll('.axis-x text');
    expect([...axis].map((t) => t.textContent)).toEqual(['10 Nov 2026', '03:00', '06:00', '09:00', '12:00', '15:00', '18:00', '21:00']);
    const figure = section.getByRole('figure', { name: 'Each PR’s timeline, one per row' });
    const summary = () => document.getElementById(figure.getAttribute('aria-describedby') as string)?.textContent ?? '';
    expect(summary()).toMatch(/, each drawn only within the calendar shown, 10 Nov 2026, inside the period: /);
    // The lanes span the day, so the calendar is the day and says nothing more of what it covers.
    expect(section.queryByText(/^The calendar runs over/)).toBeNull();
    expect(summary()).not.toMatch(/whole/);
    const link = within(section.getByRole('list', { name: /PRs in the lanes/ })).getByRole('link', { name: '#67250' });
    // A lane's link is described while the list is open, the only time it can be reached.
    expect(link.getAttribute('aria-describedby')).toBeNull();
    const details = section.getByText(/PRs in the lanes, as links/).closest('details') as HTMLDetailsElement;
    details.open = true;
    await fireEvent(details, new Event('toggle'));
    const description = () => document.getElementById(link.getAttribute('aria-describedby') as string)?.textContent ?? '';
    // Its first commit came the day before.
    expect(description()).toBe(
      'As the calendar shows it: its life goes on earlier than shown; opened 10 Nov 2026 16:00 UTC; 1 comment, review or bot command; 0 approvals; its life goes on later than shown.',
    );

    await fireEvent.click(section.getByRole('radio', { name: 'Days since opening' }));
    expect(summary()).toMatch(/^The whole timelines of .*, each from its opening, whatever the period: /);
    expect(summary()).not.toMatch(/calendar|shown/);
    expect(section.queryByText(/^The calendar runs over/)).toBeNull();
    expect(description()).toMatch(/^Its whole life, from its opening: opened 10 Nov 2026 \d\d:\d\d UTC; /);
    expect(description()).not.toMatch(/period/);
    expect(section.getByRole('figure').querySelectorAll('.axis-x text')[0]?.textContent).toBe('1 hour');
  });
});
