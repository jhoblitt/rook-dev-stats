// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { beforeAll, describe, expect, it } from 'vitest';
import App from '../App.svelte';
import { NAME_A, NAME_B, deletedFiles } from '../lib/__fixtures__/deleted';
import { fixturePage } from '../lib/__fixtures__/page';
import { POOLED_NOTE } from '../lib/handles';

beforeAll(() => {
  window.matchMedia = (query: string) =>
    ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
});

function section() {
  return within(screen.getByRole('region', { name: 'People' }));
}

function table(name: 'Authors' | 'Reviewers') {
  return section().getByRole('table', { name: new RegExp(`^${name}, sorted by`) });
}

/** Each body row's cells as written, the rank first. */
function cells(name: 'Authors' | 'Reviewers'): string[][] {
  return within(table(name))
    .getAllByRole('row')
    .slice(1)
    .map((r) =>
      [...r.querySelectorAll('td, th')].map((c) => {
        const copy = c.cloneNode(true) as HTMLElement;
        copy.querySelectorAll('.visually-hidden, button').forEach((n) => n.remove());
        return copy.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      }),
    );
}

const people = (name: 'Authors' | 'Reviewers') => cells(name).map((r) => r[1]);

function part(name: 'Authors' | 'Reviewers'): HTMLElement {
  return section().getByRole('heading', { level: 3, name }).closest('.part') as HTMLElement;
}

/** The line beneath a table giving the pooled deleted entry's figures, or null. */
function pooledLine(name: 'Authors' | 'Reviewers'): HTMLElement | null {
  return within(part(name)).queryByText(/^\(deleted, unknown\), not ranked or counted/);
}

describe('People', () => {
  it('lists the authors of the selected PRs opened in the period, most PRs opened first, a tie by handle', async () => {
    render(App, (await fixturePage('')).props);
    expect(section().getByRole('heading', { level: 3, name: 'Authors' })).toBeTruthy();
    expect(cells('Authors').map((r) => [r[0], r[1], r[2]])).toEqual([
      ['1', 'fixture-author-d', '2'],
      ['2', 'fixture-author-a', '1'],
      ['3', 'fixture-author-e', '1'],
      ['4', 'fixture-author-g', '1'],
      ['5', 'fixture-author-i', '1'],
    ]);
    expect(table('Authors').querySelector('th[aria-sort="descending"]')?.textContent).toMatch(/^PRs opened/);
  });

  it("writes an author's row: fixture-author-d opened #66500 and #67100", async () => {
    render(App, (await fixturePage('')).props);
    expect(cells('Authors')[0]).toEqual([
      '1',
      'fixture-author-d',
      '2',
      '2',
      '0',
      '0',
      '4',
      '95',
      '25',
      '120',
      'too few',
      'too few',
      '100%',
    ]);
    const row = within(table('Authors')).getAllByRole('row')[1] as HTMLElement;
    const response = row.querySelectorAll('td')[10] as HTMLElement;
    expect(response.getAttribute('title')).toBe('2 PRs, fewer than 5');
    expect(response.textContent).toBe('too few, 2 PRs, fewer than 5');
  });

  it('names each table by its order in its caption, keeping each label as written', async () => {
    render(App, (await fixturePage('')).props);
    expect(table('Authors').querySelector('caption')?.textContent).toBe('Authors, sorted by PRs opened, descending');
    expect(table('Reviewers').querySelector('caption')?.textContent).toBe(
      'Reviewers, sorted by PRs reviewed or commented on, descending',
    );
  });

  it("heads the reviewers' first figure as what it counts, and says what a comment and a first response are", async () => {
    render(App, (await fixturePage('')).props);
    const heads = within(table('Reviewers'))
      .getAllByRole('columnheader')
      .map((h) => h.textContent?.replace(/[↑↓]/g, '').trim());
    expect(heads[2]).toBe('PRs reviewed or commented on');
    expect(heads).not.toContain('PRs reviewed');
    const notes = section().getByText(/^\s*Nothing a person does on a pull request they opened/).closest('.notes');
    const text = notes?.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(text).toContain(
      'Nothing a person does on a pull request they opened is counted here, neither their comments on it nor their replies in its review threads.',
    );
    expect(text).toContain(
      'A comment is any such comment by a person that is not a bot command, such as a posted test result, so a row with comments and no reviews is someone who commented without reviewing.',
    );
    expect(text).toContain(
      'First responses counts the pull requests whose first response was this person’s and came before the pull request was finally merged or closed; a pull request never made ready for review has none, so it counts for no one.',
    );
    expect(text).toContain(
      'The median is of the time from a pull request being ready for review to this person’s first comment or review on it, made before the pull request was finally merged or closed.',
    );
    expect(text).not.toContain('while it was open');
    expect(text).not.toContain('while the pull request was open');
    // The author's own activity is said once, not again for review threads alone.
    expect(text).not.toContain('A reply in a review thread');
    expect(text).toContain(
      'A first response is the first comment or review on a pull request by a person other than its author; comments and reviews from bot accounts, and bot commands, do not count.',
    );
    expect(text).toContain(
      'One made before the pull request was ready counts as no time, and pull requests never made ready for review are left out.',
    );
    expect(text).not.toContain('by anyone but its author');
  });

  it("writes a reviewer's row: fixture-author-f", async () => {
    render(App, (await fixturePage('')).props);
    expect(people('Reviewers')).toEqual([
      'fixture-author-f',
      'fixture-author-a',
      'fixture-author-e',
      'fixture-author-i',
      'fixture-reviewer-k',
    ]);
    expect(cells('Reviewers')[0]).toEqual(['1', 'fixture-author-f', '3', '3', '0', '0', '1', '1', 'too few']);
  });

  it('links each handle to the person on GitHub, in a new tab', async () => {
    render(App, (await fixturePage('')).props);
    const link = within(table('Reviewers')).getByRole('link', { name: 'fixture-reviewer-k on GitHub, opens in a new tab' });
    expect(link.getAttribute('href')).toBe('https://github.com/fixture-reviewer-k');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('sorts by a column chosen, most first, then the other way, the rank following the order', async () => {
    const { props, loc } = await fixturePage('');
    render(App, props);
    const lines = () => within(table('Authors')).getByRole('button', { name: /^Lines changed/ });
    await fireEvent.click(lines());
    expect(loc.hash()).toBe('#/?target=master&authorsort=-lines');
    expect(lines().closest('th')?.getAttribute('aria-sort')).toBe('descending');
    expect(cells('Authors').map((r) => [r[0], r[1], r[9]])).toEqual([
      ['1', 'fixture-author-i', '2,200'],
      ['2', 'fixture-author-a', '250'],
      ['3', 'fixture-author-d', '120'],
      ['4', 'fixture-author-g', '70'],
      ['5', 'fixture-author-e', '4'],
    ]);
    await fireEvent.click(lines());
    expect(loc.hash()).toBe('#/?target=master&authorsort=lines');
    expect(cells('Authors')[0]?.slice(0, 2)).toEqual(['1', 'fixture-author-e']);
  });

  it('sorts by the handle from A first', async () => {
    const { props, loc } = await fixturePage('');
    render(App, props);
    await fireEvent.click(within(table('Reviewers')).getByRole('button', { name: /^Reviewer/ }));
    expect(loc.hash()).toBe('#/?target=master&reviewersort=reviewer');
    expect(people('Reviewers')[0]).toBe('fixture-author-a');
  });

  it('restores the orders from the URL', async () => {
    render(App, (await fixturePage('#/?authorsort=-lines&reviewersort=first')).props);
    expect(people('Authors')[0]).toBe('fixture-author-i');
    expect(table('Reviewers').querySelector('th[aria-sort="ascending"]')?.textContent).toMatch(/^First responses/);
  });

  it('leaves out bot accounts until asked, then marks them', async () => {
    const { props, loc } = await fixturePage('#/?target=all');
    render(App, props);
    expect(people('Authors')).not.toContain('mergify');
    expect(section().getByText(/2 bot accounts not shown/)).toBeTruthy();
    await fireEvent.click(section().getByRole('checkbox', { name: 'Show bot accounts among the authors' }));
    expect(loc.hash()).toBe('#/?target=all&bots=show');
    const bot = cells('Authors').find((r) => r[1]?.startsWith('mergify'));
    expect(bot?.[1]).toBe('mergify bot');
  });

  it('says the bot control is the Authors table’s, and why the Reviewers table lists no bot', async () => {
    render(App, (await fixturePage('#/?target=all')).props);
    const authors = section().getByRole('heading', { level: 3, name: 'Authors' }).closest('.part') as HTMLElement;
    expect(within(authors).getByRole('checkbox', { name: 'Show bot accounts among the authors' })).toBeTruthy();
    const reviewers = section().getByRole('heading', { level: 3, name: 'Reviewers' }).closest('.part') as HTMLElement;
    expect(within(reviewers).queryByRole('checkbox')).toBeNull();
    expect(within(reviewers).getByRole('status').textContent?.replace(/\s+/g, ' ').trim()).toBe(
      '5 reviewers of the selected PRs in the period, none of them a bot: the data keeps no login for a bot’s comment or review.',
    );
    expect(within(reviewers).queryByText(/not shown/)).toBeNull();
  });

  it("sets the Reviewer filter from a row, and every section follows it", async () => {
    const { props, loc } = await fixturePage('');
    render(App, props);
    await fireEvent.click(within(table('Reviewers')).getByRole('button', { name: 'Filter by fixture-author-f as reviewer' }));
    expect(loc.hash()).toBe('#/?target=master&reviewer=fixture-author-f');
    // The PRs f reviewed in the period: #64010, #66500 and #67100.
    const prs = within(screen.getByRole('region', { name: 'Pull requests' }));
    expect(prs.getByRole('status').textContent).toBe('3 PRs open at some point in the period, 2 of them opened in it');
    expect(cells('Reviewers').map((r) => [r[1], r[2]])).toContainEqual(['fixture-author-f', '3']);
    expect(
      within(table('Reviewers')).getByRole('button', { name: 'Filter by fixture-author-f as reviewer' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(people('Authors')).toEqual(['fixture-author-d']);
  });

  it('says "no PRs match" for an empty selection', async () => {
    render(App, (await fixturePage('#/?component=filesystem&kind=docs')).props);
    expect(section().getByText('no PRs match')).toBeTruthy();
    expect(section().queryByRole('table')).toBeNull();
  });
});

describe('People with deleted accounts', () => {
  // #66510 is Ada's, #66700 Åsa's and #67000 the pooled entry's; a deleted
  // account commented on #66700.
  it('gives a named deleted author a row of their own, ranked as anyone, written "(deleted)" and the name, with no link', async () => {
    render(App, (await fixturePage('', deletedFiles())).props);
    expect(cells('Authors').map((r) => [r[0], r[1], r[2]])).toEqual([
      ['1', 'fixture-author-d', '2'],
      ['2', `(deleted) ${NAME_A}`, '1'],
      ['3', `(deleted) ${NAME_B}`, '1'],
      ['4', 'fixture-author-a', '1'],
    ]);
    expect(within(table('Authors')).queryByRole('link', { name: /deleted/ })).toBeNull();
  });

  it('gives the pooled entry no row among the authors, counts it as no author, and gives its figures in a line beneath the table', async () => {
    render(App, (await fixturePage('', deletedFiles())).props);
    expect(people('Authors')).not.toContain('(deleted, unknown)');
    expect(within(part('Authors')).getByRole('status').textContent?.replace(/\s+/g, ' ').trim()).toBe(
      '4 authors of the selected PRs opened in the period, and 1 bot account not shown',
    );
    const line = pooledLine('Authors') as HTMLElement;
    expect(table('Authors').compareDocumentPosition(line)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(line.textContent).toMatch(/^\(deleted, unknown\), not ranked or counted among the authors above, opened 1 PR: /);
    expect(line.textContent).toContain(`It pools ${POOLED_NOTE}.`);
  });

  it('gives the pooled entry no row among the reviewers, counts it as no reviewer, and gives its figures in a line beneath the table', async () => {
    render(App, (await fixturePage('', deletedFiles())).props);
    expect(people('Reviewers')).not.toContain('(deleted, unknown)');
    expect(people('Reviewers').filter((p) => p !== undefined && (p.includes(NAME_A) || p.includes(NAME_B)))).toEqual([]);
    expect(within(part('Reviewers')).getByRole('status').textContent?.replace(/\s+/g, ' ').trim()).toMatch(
      /^5 reviewers of the selected PRs in the period/,
    );
    const line = pooledLine('Reviewers') as HTMLElement;
    expect(table('Reviewers').compareDocumentPosition(line)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(line.textContent).toMatch(
      /^\(deleted, unknown\), not ranked or counted among the reviewers above, reviewed or commented on 1 PR: .*; 1 comment; /,
    );
    expect(line.textContent).toContain(`It pools ${POOLED_NOTE}.`);
    expect(part('Reviewers').querySelector('.notes')?.textContent?.replace(/\s+/g, ' ')).toContain(
      'A deleted account’s pull requests can be credited to the name on their commits, but its comments and reviews carry no name, so they are all counted for “(deleted, unknown)” beneath the table, and no “(deleted)” author with a name has a row here.',
    );
  });

  it('has no pooled line beneath the Authors table when the pooled entry opened none of the selected PRs', async () => {
    // Åsa's #66700, on which a deleted account commented.
    render(App, (await fixturePage(`#/?author=${encodeURIComponent(`ghost:${NAME_B}`)}`, deletedFiles())).props);
    expect(pooledLine('Authors')).toBeNull();
    expect(pooledLine('Reviewers')).not.toBeNull();
  });

  it('has no pooled line beneath the Reviewers table when no deleted account reviewed or commented on the selected PRs', async () => {
    render(App, (await fixturePage('#/?author=fixture-author-d', deletedFiles())).props);
    expect(pooledLine('Authors')).toBeNull();
    expect(pooledLine('Reviewers')).toBeNull();
    expect(people('Reviewers').length).toBeGreaterThan(0);
  });

  it('filters by a named deleted author from their row, the address carrying the name', async () => {
    const { props, loc } = await fixturePage('', deletedFiles());
    render(App, props);
    await fireEvent.click(within(table('Authors')).getByRole('button', { name: `Filter by (deleted) ${NAME_B} as author` }));
    expect(loc.hash()).toBe(`#/?target=master&author=${encodeURIComponent(`ghost:${NAME_B}`)}`);
    expect(people('Authors')).toEqual([`(deleted) ${NAME_B}`]);
  });
});
