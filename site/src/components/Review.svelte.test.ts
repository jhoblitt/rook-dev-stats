// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { beforeAll, describe, expect, it } from 'vitest';
import App from '../App.svelte';
import rawEvents2026 from '../lib/__fixtures__/data/events-2026.json';
import rawMeta from '../lib/__fixtures__/data/meta.json';
import { fixturePage, meta } from '../lib/__fixtures__/page';
import { periodRange } from '../lib/filters';
import { formatDays, formatShare } from '../lib/format';
import { openedIn, select } from '../lib/select';
import { defaultFilters } from '../lib/state';
import { type Curve, outcomeCurve } from '../lib/stats/curve';
import { COLOURS } from '../lib/colours';
import { formatRatio } from '../lib/review';
import { awaitingResponse } from '../lib/stats/backlog';
import { capacity } from '../lib/stats/capacity';
import { reviewLoad } from '../lib/stats/reviewers';
import { fixture } from '../lib/stats/testing';
import { weekly } from '../lib/stats/weekly';

/** What a capacity chart's partial week says beside its coverage. */
const PARTIAL_NOTE =
  "each ratio divides two partial counts; the PRs waiting are counted at the week's end, " +
  "or at the period's end or the data's last fetch if sooner";

const NEW_COMMANDS = ['zeta', 'eta', 'theta', 'iota', 'kappa', 'lambda'];

/** The fixture with six more commands, each run once on #66500 after its own events. */
function manyCommands(): Record<string, unknown> {
  const m = { ...rawMeta, commands: [...rawMeta.commands, ...NEW_COMMANDS.map((n) => ({ id: n, name: n }))] };
  const columns = rawEvents2026 as Record<string, number[]>;
  // #66500 is the 2026 file's row 3; its events end before row 4's begin.
  const at = (columns['pr'] as number[]).indexOf(4);
  const added: Record<string, number[]> = {
    pr: NEW_COMMANDS.map(() => 3),
    at: NEW_COMMANDS.map((_, k) => 1779450000 + k),
    kind: NEW_COMMANDS.map(() => rawMeta.event_kinds.indexOf('command_other')),
    sub: NEW_COMMANDS.map((_, k) => rawMeta.commands.length + k),
    actor: NEW_COMMANDS.map(() => -1),
  };
  const events = Object.fromEntries(
    Object.entries(columns).map(([key, col]) => [key, [...col.slice(0, at), ...(added[key] as number[]), ...col.slice(at)]]),
  );
  return { 'meta.json': m, 'events-2026.json': events };
}

beforeAll(() => {
  window.matchMedia = (query: string) =>
    ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;
});

const data = fixture();
const filters = defaultFilters(meta);
const period = periodRange(filters);
const rows = select(data, filters);
const opened = openedIn(data, rows, period);

const TITLES = [
  'Review capacity against arrivals, per week',
  'Human and bot reviews per week',
  'Time to first response',
  'Time to first approval',
  'Time to merge',
  'Wait for a first response, by week opened',
  'Wait for a first approval, by week opened',
  'Wait to merge, by week opened',
  'Time after first approval',
  'First commit to opened',
  'First commit to opened, by week opened',
  'Opened to last commit',
  'Opened to last commit, by week opened',
  'Last commit to final disposition',
  'Last commit to final disposition, by week opened',
  'Bot commands per week, by command',
];

function section() {
  return within(screen.getByRole('region', { name: 'Review' }));
}

function figure(name: string): HTMLElement {
  return section().getByRole('figure', { name });
}

/** The text of each body row's cells in a figure's table. */
function cells(f: HTMLElement): string[][] {
  return within(f)
    .getAllByRole('row')
    .slice(1)
    .map((r) => [...r.querySelectorAll('td')].map((td) => td.textContent ?? ''));
}

/** A curve's shares at `day`, read straight off the library's result. */
function sharesAt(curve: Curve, day: number): number[] {
  const names = Object.keys(curve.shares);
  let i = -1;
  while (i + 1 < curve.days.length && (curve.days[i + 1] as number) <= day) i++;
  return names.map((n, k) => (i === -1 ? (k === names.length - 1 && names.length === 3 ? 1 : 0) : (curve.shares[n] as number[])[i] as number));
}

describe('the note on reviews before GitHub recorded them', () => {
  // Each spec renders the whole app; a loaded CI runner has taken more than the default five seconds.
  const SLOW = 30_000;
  // The fixture with a window from 2014, so a period can start before reviews were recorded.
  const early = { 'meta.json': { ...rawMeta, window_start: Date.UTC(2014, 0, 1) / 1000 } };
  const NOTE = /^GitHub recorded no reviews of pull requests before 14 Sep 2016, and this period starts earlier/;
  const notes = () => screen.queryAllByRole('note').filter((n) => NOTE.test(n.textContent ?? ''));

  it('is absent for a period from 2017', async () => {
    render(App, (await fixturePage('#/?from=2017-01-01', early)).props);
    expect(notes()).toEqual([]);
  }, SLOW);

  it('shows once, above the first section, for a period from 2014, naming the sections it concerns and linking to the methods section', async () => {
    render(App, (await fixturePage('#/?from=2014-01-01', early)).props);
    const shown = notes();
    expect(shown).toHaveLength(1);
    const note = shown[0] as HTMLElement;
    expect(note.closest('section')).toBeNull();
    // Below the filter bar and the status line, above the first of the report's sections.
    const filterBar = document.querySelector('section.filter-bar') as HTMLElement;
    const status = document.querySelector('p.loading') as HTMLElement;
    const first = document.getElementById('velocity') as HTMLElement;
    expect(filterBar.compareDocumentPosition(note)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(status.compareDocumentPosition(note)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(note.compareDocumentPosition(first)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(note.textContent).toContain('In the Review, AI use and People sections');
    expect(note.textContent).toContain('its first responses count only comments then, not reviews');
    expect(within(note).getByRole('link').getAttribute('href')).toBe(
      '#/methods?target=master&section=limits-reviews-before-github-recorded-them',
    );
    for (const name of ['Review', 'AI use', 'People']) {
      const region = screen.getByRole('region', { name });
      expect(within(region).queryAllByRole('note').filter((n) => NOTE.test(n.textContent ?? ''))).toEqual([]);
    }
  }, SLOW);
});

describe('Review', () => {
  it('draws every chart, in order', async () => {
    render(App, (await fixturePage('')).props);
    expect(section().getAllByRole('figure').map((f) => f.querySelector('h3')?.textContent)).toEqual(TITLES);
  });

  it('tabulates the people giving reviews, the two ratios with their counts, and the PRs waiting', async () => {
    render(App, (await fixturePage('')).props);
    const c = capacity(
      weekly(data, rows, period, 'opened'),
      weekly(data, rows, period, 'reviews'),
      weekly(data, rows, period, 'reviewers'),
      awaitingResponse(data, rows, period),
    );
    const value = (v: number | null, missing: string) => (v === null ? missing : formatRatio(v));
    expect(cells(figure(TITLES[0]!))).toEqual(
      c.week.map((_, i) => [
        formatRatio(c.reviewers[i] as number),
        formatRatio(c.opened[i] as number),
        value(c.openedPerReviewer[i] ?? null, 'no one giving reviews'),
        formatRatio(c.reviews[i] as number),
        value(c.reviewsPerOpened[i] ?? null, 'no PRs opened'),
        formatRatio(c.waiting[i] as number),
      ]),
    );
  });

  it('draws the human and bot reviews the library counts', async () => {
    render(App, (await fixturePage('')).props);
    const r = weekly(data, rows, period, 'reviews').values;
    const human = r['human'] as number[];
    const bot = r['bot'] as number[];
    expect(cells(figure(TITLES[1]!))).toEqual(human.map((h, i) => [h, bot[i] as number, h + (bot[i] as number)].map(String)));
  });

  it('draws the merge curve of the PRs opened in the period', async () => {
    render(App, (await fixturePage('')).props);
    const curve = outcomeCurve(data, opened, 'merge');
    const f = figure('Time to merge');
    const milestones = [1 / 24, 1, 2, 7, 14, 30, 60, 90, curve.days.at(-1) as number];
    expect(cells(f)).toEqual(milestones.map((m) => sharesAt(curve, m).map(formatShare)));
    expect(f.textContent).toContain('Median 48 days');
    // Four of seven merged, two still open: nine in ten can no longer merge.
    expect(f.textContent).toContain('90th percentile not reached: 57% merged');
  });

  it('draws the waits by week opened, telling "not yet known" from "not reached" and from no PRs', async () => {
    render(App, (await fixturePage('')).props);
    const w = weekly(data, rows, period, { kind: 'waitingByWeekOpened', span: 'merge', quantiles: [0.5, 0.9] }).values;
    const f = figure('Wait to merge, by week opened');
    const rowsOf = cells(f);
    const known = (w['0.5'] ?? []).flatMap((q, i) => (q.state === 'known' ? [[i, formatDays(q.days)] as const] : []));
    for (const [i, text] of known) expect(rowsOf[i]?.[0]).toBe(text);
    expect(rowsOf[3]?.[0]).toBe('not yet known');
    expect(rowsOf[1]?.[1]).toBe('not reached: 50% merged');
    expect(rowsOf[0]?.[0]).toBe('no PRs opened');
    expect(f.querySelectorAll('.unreached').length).toBeGreaterThan(0);
    expect(within(f).getByRole('list', { name: 'Legend' }).textContent).toMatch(/not yet known.*not reached/);
    expect(f.querySelector('.visually-hidden')?.textContent).toMatch(
      /No PRs opened in 21 weeks\. Partial: week of 2026-05-11, 3 of 7 days; week of 2026-11-09, 6 of 7 days\.$/,
    );
  });

  it('draws the bot commands by command, with their use', async () => {
    render(App, (await fixturePage('')).props);
    const f = figure('Bot commands per week, by command');
    const backport = weekly(data, rows, period, 'commands').values['mergify-backport'] as number[];
    expect(cells(f).map((r) => r[0])).toEqual(backport.map(String));
    expect(f.querySelectorAll('.command')).toHaveLength(1);
    expect(within(f).queryByRole('button', { name: /^show / })).toBeNull();
    expect(f.textContent).toContain('@mergifyio backport');
    expect(f.textContent).toMatch(/PRs opened in the period with a bot command\s*14%/);
    expect(f.textContent).toMatch(/bot commands on merged PRs\s*mean 0\.3 · median 0 · 90th percentile 1/);
  });

  it('shows the six busiest commands, ties by name, and the rest behind a control a keyboard reaches', async () => {
    render(App, (await fixturePage('', manyCommands())).props);
    const f = figure('Bot commands per week, by command');
    const names = () => [...f.querySelectorAll('.command-name')].map((p) => p.textContent);
    // Seven commands used once each: by name.
    expect(names()).toEqual(['@mergifyio backport', 'eta', 'iota', 'kappa', 'lambda', 'theta']);
    const more = within(f).getByRole('button', { name: 'show all 7 commands' });
    expect(more.tagName).toBe('BUTTON');
    expect(more.getAttribute('aria-expanded')).toBe('false');
    // The table and the text alternative cover every command, shown or not.
    expect(within(f).getAllByRole('columnheader').map((h) => h.textContent)).toContain('zeta');
    expect(f.querySelector('.visually-hidden')?.textContent).toContain('1 zeta');
    await fireEvent.click(more);
    expect(names()).toHaveLength(7);
    expect(within(f).getByRole('button', { name: 'show the 6 busiest commands' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('draws people giving reviews, the two ratios and the PRs waiting in four panels of neutral lines, each on its own scale', async () => {
    render(App, (await fixturePage('')).props);
    const f = figure(TITLES[0]!);
    const panels = [...f.querySelectorAll('.plot-panel')];
    expect(panels.map((p) => [p.querySelectorAll('.bar').length, p.querySelectorAll('.line').length])).toEqual([
      [0, 1],
      [0, 1],
      [0, 1],
      [0, 1],
    ]);
    expect([...f.querySelectorAll('.axis-y .unit')].map((u) => u.textContent)).toEqual([
      'people giving reviews per week',
      'PRs opened per person giving reviews',
      'human reviews per PR opened',
      'PRs waiting for a first response, at the end of each week',
    ]);
    for (const l of f.querySelectorAll('.line')) expect(l.getAttribute('style')).toContain(COLOURS.statistic);
    // Every panel labels at least three values.
    for (const a of f.querySelectorAll('.axis-y')) expect(a.querySelectorAll('text:not(.unit)').length).toBeGreaterThanOrEqual(3);
    // The panel titles name the lines; the key only explains the partial weeks.
    expect(within(within(f).getByRole('list', { name: 'Legend' })).getAllByRole('listitem').map((i) => i.textContent?.trim())).toEqual([
      'partial week',
    ]);
  });

  it('says under the title what the reviews-per-PR panel divides', async () => {
    render(App, (await fixturePage('')).props);
    const f = figure(TITLES[0]!);
    expect(f.querySelector('.note')?.textContent).toBe(
      '"Human reviews per PR opened" compares two flows of the same week, not one group of PRs followed over time: ' +
        'the human reviews done that week, on any selected PR, against the PRs opened that week.',
    );
  });

  it('leaves a gap where a ratio has no divisor, and says why', async () => {
    render(App, (await fixturePage('')).props);
    const f = figure(TITLES[0]!);
    // 06-01: one PR opened, no one giving reviews.
    expect(within(f).getByRole('button', { name: /^week of 2026-06-01:/ }).getAttribute('aria-label')).toBe(
      'week of 2026-06-01: people giving reviews 0, PRs opened 1, PRs opened per person giving reviews no one giving reviews, ' +
        'human reviews 0, human reviews per PR opened 0, PRs waiting for a first response 1',
    );
  });

  it('says how many people did the reviews when there were ten or fewer, with no names', async () => {
    render(App, (await fixturePage('')).props);
    expect(reviewLoad(data, rows, period, 10)).toEqual({ reviewers: 4, share: 1 });
    expect(section().getByText('4 people did all of the human reviews in this period.')).toBeTruthy();
  });

  it('names the first span for backports when only PRs that link their originals are selected, whatever the target', async () => {
    for (const hash of ['#/?target=backports&backport=linked', '#/?target=master&backport=linked']) {
      render(App, (await fixturePage(hash)).props);
      expect(figure('Original work to backport opened').textContent, hash).not.toContain('For a backport');
      expect(figure('Original work to backport opened, by week opened')).toBeTruthy();
      cleanup();
    }
  });

  it('keeps the plain title under backports and other branches, which holds more than backports, and notes it', async () => {
    render(App, (await fixturePage('#/?target=backports')).props);
    expect(section().queryByText(/Original work to backport opened/)).toBeNull();
    expect(figure('First commit to opened').textContent).toContain('For a backport, the first commit is the original work’s');
  });

  it('keeps the plain title, with no note, on the default view', async () => {
    render(App, (await fixturePage('')).props);
    expect(section().queryByText(/Original work to backport opened/)).toBeNull();
    expect(figure('First commit to opened').textContent).not.toContain('For a backport');
  });

  it('keeps the plain title with every branch selected, and notes what a backport\'s first commit is', async () => {
    render(App, (await fixturePage('#/?target=all')).props);
    const f = figure('First commit to opened');
    expect(f.textContent).toContain('For a backport, the first commit is the original work’s');
    expect(figure('First commit to opened, by week opened').textContent).toContain('For a backport');
  });

  it('says what is missing, not "no PRs match", when PRs match but none was opened in the period', async () => {
    // Only PRs opened earlier are active in 2026-11-12 to 2026-11-15.
    render(App, (await fixturePage('#/?from=2026-11-12&to=2026-11-15')).props);
    expect(rows.length).toBeGreaterThan(0);
    const f = figure('Time to merge');
    expect(f.textContent).toContain('no PR was opened in this period');
    expect(f.textContent).not.toContain('no PRs match');
    expect(figure('Wait to merge, by week opened').textContent).toContain('no PR was opened in this period');
    const capacityFigure = figure(TITLES[0]!);
    expect(capacityFigure.textContent).toContain(
      'no PR was opened in this period, so there are no arrivals to set review against',
    );
    expect(capacityFigure.querySelector('svg')).toBeNull();
  });

  it('marks the weeks the period and the fetch cut short in the count charts', async () => {
    render(App, (await fixturePage('')).props);
    const heads0 = within(figure(TITLES[0]!))
      .getAllByRole('rowheader')
      .map((h) => h.textContent);
    expect(heads0[0]).toBe(`week of 2026-05-11, partial: 3 of 7 days; ${PARTIAL_NOTE}`);
    expect(heads0.at(-1)).toBe(`week of 2026-11-09, partial: 6 of 7 days; ${PARTIAL_NOTE}`);
    for (const name of [TITLES[1]!, 'Bot commands per week, by command']) {
      const heads = within(figure(name))
        .getAllByRole('rowheader')
        .map((h) => h.textContent);
      expect(heads[0]).toBe('week of 2026-05-11, partial: 3 of 7 days');
      expect(heads.at(-1)).toBe('week of 2026-11-09, partial: 6 of 7 days');
    }
  });

  it('uses no disclosure colour anywhere: Velocity keeps the split by disclosure', async () => {
    render(App, (await fixturePage('')).props);
    const marks = [...screen.getByRole('region', { name: 'Review' }).querySelectorAll<SVGElement>('[style]')];
    expect(marks.length).toBeGreaterThan(0);
    expect(marks.filter((m) => /var\(--series-[12]\)/.test(m.getAttribute('style') ?? ''))).toEqual([]);
  });

  it('says "no PRs match" in every chart when the selection is empty', async () => {
    render(App, (await fixturePage('#/?component=filesystem&kind=docs')).props);
    for (const name of TITLES) {
      const f = figure(name);
      expect(f.textContent).toContain('no PRs match');
      expect(f.querySelector('svg')).toBeNull();
    }
    expect(section().queryByText(/busiest reviewers/)).toBeNull();
  });

  it('writes a week opened, chosen in a wait chart, to the URL', async () => {
    const { props, loc } = await fixturePage('');
    render(App, props);
    const f = figure('Wait to merge, by week opened');
    await fireEvent.click(within(f).getByRole('button', { name: /^week of 2026-07-06:/ }));
    expect(loc.hash()).toBe('#/?target=master&week=2026-07-06');
  });
});
