// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { beforeAll, describe, expect, it } from 'vitest';
import App from '../App.svelte';
import { fixturePage, meta } from '../lib/__fixtures__/page';
import { periodRange } from '../lib/filters';
import { formatShare } from '../lib/format';
import { comparison } from '../lib/llm';
import { openedIn, select } from '../lib/select';
import { defaultFilters } from '../lib/state';
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

const SHARE = 'Share of PRs opened that disclose AI use, per week';
const FAMILIES = 'Share of PRs opened naming each tool, per week';
const COMPARE = 'AI use disclosed against not disclosed, PRs opened in the period';

function section() {
  return within(screen.getByRole('region', { name: 'AI use' }));
}

function cells(figure: HTMLElement): string[][] {
  return within(figure)
    .getAllByRole('row')
    .slice(1)
    .map((r) => [...r.querySelectorAll('td')].map((td) => td.textContent?.trim() ?? ''));
}

describe('LlmUse', () => {
  it('draws the share disclosing per week that the library computes', async () => {
    render(App, (await fixturePage('')).props);
    const shares = weekly(data, rows, period, 'disclosureShare').values['disclosed'] ?? [];
    const figure = section().getByRole('figure', { name: SHARE });
    expect(cells(figure)).toEqual(shares.map((v) => [v === null ? 'no PRs opened' : formatShare(v)]));
  });

  it('draws each tool family used as a line of one plot, on one scale, named in the legend above it', async () => {
    render(App, (await fixturePage('')).props);
    const figure = section().getByRole('figure', { name: FAMILIES });
    expect(figure.querySelectorAll('svg[role="group"]')).toHaveLength(1);
    expect(figure.querySelectorAll('.plot-panel')).toHaveLength(1);
    expect(figure.querySelectorAll('.axis-y')).toHaveLength(1);
    expect(figure.querySelectorAll('.plot-panel .line')).toHaveLength(2);
    expect(figure.textContent).toContain('do not add up to the share disclosing');
    const legend = within(figure).getByRole('list', { name: 'Legend' });
    const entries = within(legend).getAllByRole('listitem').map((li) => li.textContent?.trim());
    expect(entries.slice(0, 2)).toEqual(['Claude', 'GitHub Copilot']);
    expect(legend.compareDocumentPosition(figure.querySelector('svg[role="group"]') as Element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const claude = weekly(data, rows, period, 'disclosureShare').values['claude'] ?? [];
    expect(cells(figure).map((c) => c[0])).toEqual(claude.map((v) => (v === null ? 'no PRs opened' : formatShare(v))));
  });

  it('draws the tools’ chart as tall as the share chart above it, whatever the number of families', async () => {
    render(App, (await fixturePage('')).props);
    const height = (name: string) => section().getByRole('figure', { name }).querySelector('svg[role="group"]')?.getAttribute('height');
    expect(height(FAMILIES)).toBe(height(SHARE));
  });

  it('reads out every family’s share in a bucket, on hover and in its name', async () => {
    render(App, (await fixturePage('')).props);
    const figure = section().getByRole('figure', { name: FAMILIES });
    const shares = weekly(data, rows, period, 'disclosureShare').values;
    const buttons = within(figure).getAllByRole('button');
    const i = (shares['claude'] ?? []).findIndex((v) => v !== null);
    const bucket = buttons[i] as HTMLElement;
    const value = (id: string) => {
      const v = shares[id]?.[i] ?? null;
      return v === null ? 'no PRs opened' : formatShare(v);
    };
    expect(bucket.getAttribute('aria-label')).toContain(`Claude ${value('claude')}, GitHub Copilot ${value('copilot')}`);
    await fireEvent.pointerEnter(bucket);
    const tip = figure.querySelector('.tip') as HTMLElement;
    expect([...tip.querySelectorAll('tr')].map((r) => r.querySelector('.label')?.textContent)).toEqual(['Claude', 'GitHub Copilot']);
  });

  it('sets the two groups side by side with the library’s figures and what each rests on', async () => {
    render(App, (await fixturePage('')).props);
    const figure = section().getByRole('figure', { name: COMPARE });
    const expected = comparison(data, openedIn(data, rows, period)).map((r) => r.cells.map((c) => [c.text, c.basis ?? '']));
    const shown = within(figure)
      .getAllByRole('row')
      .slice(1)
      .map((r) => [...r.querySelectorAll('td')].map((td) => [td.querySelector('.value')?.textContent ?? '', td.querySelector('.count')?.textContent ?? '']));
    expect(shown).toEqual(expected);
    expect(within(figure).getByRole('rowheader', { name: 'Lines changed' })).toBeTruthy();
    expect(within(figure).getByRole('rowheader', { name: 'Merged within 30 days of opening' })).toBeTruthy();
    expect(within(figure).queryByRole('rowheader', { name: 'Time to merge' })).toBeNull();
    expect(figure.textContent).toContain('too few to say');
    expect(within(figure).getAllByRole('columnheader').map((h) => h.textContent?.trim())).toEqual([
      'Figure',
      'AI use not disclosed',
      'AI use disclosed',
    ]);
  });

  it("says that AI use not disclosed is not no AI, and links to the methods page's disclosure section", async () => {
    render(App, (await fixturePage('')).props);
    const region = screen.getByRole('region', { name: 'AI use' });
    expect(region.textContent).toContain('“AI use not disclosed” is not “no AI”');
    expect(region.textContent).toMatch(/kind, size and author/);
    expect(region.textContent).toMatch(/Disclosed PRs are newer on average, so the share merged at a long horizon is about fewer of them,\s+and only their earliest ones, opened when disclosure was rarer\. To compare PRs of like size, use the Size filter\./);
    const link = within(region).getByRole('link', { name: /How disclosure is detected/ });
    expect(link.getAttribute('href')).toBe('#/methods?target=master&section=disclosure');
  });

  it('says "no PRs match" in every chart when the selection is empty', async () => {
    render(App, (await fixturePage('#/?component=cephfs&kind=docs')).props);
    for (const name of [SHARE, FAMILIES, COMPARE]) {
      expect(section().getByRole('figure', { name }).textContent).toContain('no PRs match');
    }
  });

  it('says what is missing when PRs match but none discloses', async () => {
    render(App, (await fixturePage('#/?disclosure=not-disclosed')).props);
    const figure = section().getByRole('figure', { name: FAMILIES });
    expect(figure.textContent).toContain('no PR opened in this period discloses AI use');
    expect(figure.textContent).not.toContain('no PRs match');
    const compare = section().getByRole('figure', { name: COMPARE });
    expect(cells(compare)[0]?.[1]).toBe('no PRs');
  });
});
