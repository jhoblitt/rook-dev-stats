// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import App from '../App.svelte';
import { NAMED_A, NAME_A, POOLED, deletedMeta } from '../lib/__fixtures__/deleted';
import { BASE, fixtureFetch, withEarlierYear } from '../lib/__fixtures__/fetch';
import rawEvents2026 from '../lib/__fixtures__/data/events-2026.json';
import rawMeta from '../lib/__fixtures__/data/meta.json';
import rawPrs2026 from '../lib/__fixtures__/data/prs-2026.json';
import rawTable2026 from '../lib/__fixtures__/data/table-2026.json';
import { fixturePage, memoryLocation, meta } from '../lib/__fixtures__/page';
import { DataLoader } from '../lib/data';
import { POOLED_NOTE } from '../lib/handles';
import { createDataStore, createViewStore, yearsForState } from '../lib/page';
import { createStateStore } from '../lib/state';
import { at } from '../lib/stats/testing';

beforeAll(() => {
  window.matchMedia = (query: string) =>
    ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;
});

type Columns = Record<string, unknown[]>;
const append = (raw: unknown, extra: Record<string, unknown[]>): Columns =>
  Object.fromEntries(Object.entries(raw as Columns).map(([k, col]) => [k, [...col, ...(extra[k] ?? [])]]));

/** An element's text as drawn: what is only for assistive technology left out, white space collapsed. */
function shown(el: HTMLElement): string {
  const copy = el.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('.visually-hidden').forEach((n) => n.remove());
  return copy.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

const SHA = (c: string) => c.repeat(40);
const PR = 'https://github.com/ceph/ceph/pull/67300';
const OPENED = at('2026-08-03T09:00:00Z');
const hour = (h: number) => OPENED + h * 3600;
const KINDS = [...rawMeta.event_kinds, 'review_author'];

// #67300's author is the fixture's person 0, fixture-author-e; the comment
// and reviews by others name persons 1 to 4.
const AUTHOR = 'fixture-author-e, the author';

/** Every event kind on one PR, an hour apart, with the ref each address is built from and who made it. */
const EVERY: { kind: string; ref: string; sub?: number; actor?: number; name: string; href: string | null }[] = [
  { kind: 'comment_other', ref: '101', actor: 1, name: 'Comment by another person (fixture-author-f)', href: `${PR}#issuecomment-101` },
  { kind: 'comment_author', ref: '102', name: `Comment by the author (${AUTHOR})`, href: `${PR}#issuecomment-102` },
  { kind: 'command_author', ref: '103', sub: 0, name: `Bot command by the author: jenkins test (${AUTHOR})`, href: `${PR}#issuecomment-103` },
  { kind: 'command_other', ref: '104', sub: 1, name: 'Bot command by another person: /config check ok', href: `${PR}#issuecomment-104` },
  { kind: 'bot_account', ref: '105', name: 'Comment by a bot account', href: `${PR}#issuecomment-105` },
  { kind: 'review_approved', ref: '201', actor: 2, name: 'Review approving (fixture-author-a)', href: `${PR}#pullrequestreview-201` },
  { kind: 'review_changes', ref: '202', actor: 3, name: 'Review requesting changes (fixture-author-i)', href: `${PR}#pullrequestreview-202` },
  { kind: 'review_commented', ref: '203', actor: 4, name: 'Review commenting (fixture-reviewer-k)', href: `${PR}#pullrequestreview-203` },
  { kind: 'bot_review', ref: '204', name: 'Review by a bot', href: `${PR}#pullrequestreview-204` },
  { kind: 'review_author', ref: '205', name: `Reply by the author in a review thread (${AUTHOR})`, href: `${PR}#pullrequestreview-205` },
  { kind: 'draft', ref: '301', name: 'Converted to draft', href: `${PR}#event-301` },
  { kind: 'ready', ref: '302', name: 'Marked ready for review', href: `${PR}#event-302` },
  { kind: 'force_push', ref: SHA('a'), name: 'Force-push', href: `https://github.com/ceph/ceph/commit/${SHA('a')}` },
  { kind: 'force_push', ref: '', name: 'Force-push', href: null },
  { kind: 'closed', ref: '303', name: 'Closed for 1 hour', href: `${PR}#event-303` },
  { kind: 'reopened', ref: '', name: 'Reopened after 1 hour closed', href: PR },
  { kind: 'merged', ref: SHA('b'), name: 'Merged', href: `https://github.com/ceph/ceph/commit/${SHA('b')}` },
];

/** The fixture with #67300 added as the 2026 file's last row, carrying every event kind. */
function withEveryKind(): Record<string, unknown> {
  const row = (rawPrs2026 as Columns)['number']?.length as number;
  const prs = append(rawPrs2026, {
    number: [67300],
    created: [OPENED],
    ready: [OPENED],
    closed: [hour(EVERY.length)],
    state: [1],
    base: [0],
    draft: [0],
    opened_draft: [0],
    reopened: [1],
    in_window: [1],
    additions: [10],
    deletions: [2],
    files: [1],
    commits: [1],
    first_commit: [hour(-20)],
    last_commit: [hour(13)],
    first_response: [hour(1)],
    first_approval: [hour(6)],
    human_reviews: [3],
    bot_reviews: [1],
    bot_commands: [2],
    disclosure: [0],
    families: [[]],
    components: [[]],
    standing: [-1],
    kind: [-1],
    author: [0],
    backport_link: [0],
  });
  const events = append(rawEvents2026, {
    pr: EVERY.map(() => row),
    at: EVERY.map((_, i) => hour(i + 1)),
    kind: EVERY.map((e) => KINDS.indexOf(e.kind)),
    sub: EVERY.map((e) => e.sub ?? -1),
    actor: EVERY.map((e) => e.actor ?? -1),
  });
  const table = append(rawTable2026, {
    titles: ['mgr: a PR with every event'],
    authors: ['someone'],
    commits: [[[SHA('c'), hour(-20), hour(13)]]],
    refs: EVERY.map((e) => e.ref),
    issues: [[]],
    backport_of: [0],
    kind_source: [''],
  });
  return {
    'meta.json': { ...rawMeta, event_kinds: KINDS },
    'prs-2026.json': prs,
    'events-2026.json': events,
    'table-2026.json': table,
  };
}

async function timeline(hash: string, files: Record<string, unknown> = {}) {
  const { props } = await fixturePage(hash, files);
  render(App, { props });
  return screen.findByRole('region', { name: /^Pull request #/ });
}

describe('PrTimeline', () => {
  it('draws one mark per event, in time order, each linked to the address its id or SHA gives', async () => {
    const section = await timeline('#/?target=all&pr=67300', withEveryKind());
    const group = await within(section).findByRole('group', { name: 'The marks on the line, in time order' });
    const marks = within(group).getAllByRole('link');
    const named = marks.map((m) => m.getAttribute('aria-label') ?? '');
    const expected = [
      'First commit',
      `Opened (${AUTHOR})`,
      ...EVERY.slice(0, 12).map((e) => e.name),
      'Last commit',
      ...EVERY.slice(12).map((e) => e.name),
    ];
    expect(named.map((n) => n.replace(/, \d+ \w+ \d{4} \d\d:\d\d UTC.*$/, ''))).toEqual(expected);

    const events = marks.filter((m) => !/^(First commit|Opened|Last commit)/.test(m.getAttribute('aria-label') ?? ''));
    expect(events.map((m) => m.getAttribute('href'))).toEqual(EVERY.map((e) => e.href));
    expect(named[2]).toBe('Comment by another person (fixture-author-f), 3 Aug 2026 10:00 UTC');
    expect(named[named.length - 4]).toBe('Force-push, 3 Aug 2026 23:00 UTC, address not recorded');
    for (const m of marks.filter((m) => m.hasAttribute('href'))) {
      expect(m.getAttribute('target')).toBe('_blank');
      expect(m.getAttribute('rel')).toBe('noopener noreferrer');
    }
    expect(within(section).getByText('Closed and reopened 1 time: for 1 hour.')).toBeTruthy();
  });

  it('says who made each mark in the events table, each person linked to GitHub, the author and bots said so', async () => {
    const section = await timeline('#/?target=all&pr=67300', withEveryKind());
    const table = await within(section).findByRole('table');
    const heads = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(heads).toEqual(['When (UTC)', 'What', 'Who', 'On GitHub']);
    const who = (what: string) => {
      const row = within(table).getByRole('rowheader', { name: what }).closest('tr') as HTMLElement;
      return row.querySelector('td.who') as HTMLElement;
    };
    const other = who('Review approving');
    expect(other.textContent?.replace(/\s+/g, ' ').trim()).toBe('fixture-author-a');
    expect(within(other).getByRole('link', { name: 'fixture-author-a on GitHub, opens in a new tab' }).getAttribute('href')).toBe(
      'https://github.com/fixture-author-a',
    );
    // The handle is an inline box: the space inside it before the comma is not drawn.
    expect(who('Comment by the author').textContent?.replace(/\s+/g, ' ').replace(' ,', ',').trim()).toBe(
      'fixture-author-e, the author',
    );
    expect(who('Comment by a bot account').textContent?.trim()).toBe('a bot');
    expect(who('Bot command by another person: /config check ok').textContent?.trim()).toBe('');
    expect(within(table).queryAllByRole('button', { name: /^Filter by/ })).toHaveLength(0);
  });

  it('does not take another person’s comment for the author’s when both are deleted accounts', async () => {
    const files = withEveryKind();
    const ghost = rawMeta.people.length;
    const prs = files['prs-2026.json'] as Columns;
    const events = files['events-2026.json'] as Columns;
    const comment = EVERY.findIndex((e) => e.kind === 'comment_other');
    const first = (events['pr'] as number[]).length - EVERY.length;
    const author = (prs['author'] as number[]).map((a, i, all) => (i === all.length - 1 ? ghost : a));
    const actor = (events['actor'] as number[]).map((a, i) => (i === first + comment ? ghost : a));
    const section = await timeline('#/?target=all&pr=67300', {
      ...files,
      'meta.json': { ...(files['meta.json'] as object), people: [...rawMeta.people, 'ghost'] },
      'prs-2026.json': { ...prs, author },
      'events-2026.json': { ...events, actor },
    });
    const group = await within(section).findByRole('group', { name: 'The marks on the line, in time order' });
    expect(within(group).getByRole('link', { name: /^Comment by another person/ }).getAttribute('aria-label')).toBe(
      'Comment by another person ((deleted, unknown)), 3 Aug 2026 10:00 UTC',
    );
    const row = within(await within(section).findByRole('table')).getByRole('rowheader', { name: 'Comment by another person' });
    const who = row.closest('tr')?.querySelector('td.who') as HTMLElement;
    expect(shown(who)).toBe('(deleted, unknown)');
    // What the pooled entry stands for is said to assistive technology, and on hover.
    expect(who.querySelector('.visually-hidden')?.textContent).toBe(` (${POOLED_NOTE})`);
    expect(within(who).getByText('(deleted, unknown)').getAttribute('title')).toBe(POOLED_NOTE);
    expect(within(group).getByRole('link', { name: /^Opened/ }).getAttribute('aria-label')).toMatch(/^Opened \(\(deleted, unknown\), the author\)/);
  });

  it('names a deleted author by the name on the commits, with no link, and a deleted account’s comment on it as not theirs', async () => {
    const files = withEveryKind();
    const prs = files['prs-2026.json'] as Columns;
    const events = files['events-2026.json'] as Columns;
    const comment = EVERY.findIndex((e) => e.kind === 'comment_other');
    const first = (events['pr'] as number[]).length - EVERY.length;
    const author = (prs['author'] as number[]).map((a, i, all) => (i === all.length - 1 ? NAMED_A : a));
    const actor = (events['actor'] as number[]).map((a, i) => (i === first + comment ? POOLED : a));
    const section = await timeline('#/?target=all&pr=67300', {
      ...files,
      'meta.json': { ...deletedMeta(), event_kinds: KINDS },
      'prs-2026.json': { ...prs, author },
      'events-2026.json': { ...events, actor },
    });
    const group = await within(section).findByRole('group', { name: 'The marks on the line, in time order' });
    expect(within(group).getByRole('link', { name: /^Opened/ }).getAttribute('aria-label')).toMatch(
      new RegExp(`^Opened \\(\\(deleted\\) ${NAME_A}, the author\\)`),
    );
    expect(within(group).getByRole('link', { name: /^Comment by another person/ }).getAttribute('aria-label')).toBe(
      'Comment by another person ((deleted, unknown)), 3 Aug 2026 10:00 UTC',
    );
    const table = await within(section).findByRole('table');
    const who = (what: string) => within(table).getByRole('rowheader', { name: what }).closest('tr')?.querySelector('td.who') as HTMLElement;
    expect(shown(who('Comment by the author')).replace(' ,', ',')).toBe(`(deleted) ${NAME_A}, the author`);
    expect(within(who('Comment by the author')).queryByRole('link')).toBeNull();
    expect(shown(who('Comment by another person'))).toBe('(deleted, unknown)');
  });

  it('says who made a mark when it is hovered or focused', async () => {
    const section = await timeline('#/?target=all&pr=67300', withEveryKind());
    const group = await within(section).findByRole('group', { name: 'The marks on the line, in time order' });
    const mark = within(group).getByRole('link', { name: /^Review commenting \(fixture-reviewer-k\)/ });
    await fireEvent.focus(mark);
    expect(section.querySelector('.tip-who')?.textContent).toBe('by fixture-reviewer-k');
    await fireEvent.blur(mark);
    const own = within(group).getByRole('link', { name: /^Comment by the author/ });
    await fireEvent.pointerEnter(own);
    expect(section.querySelector('.tip-who')?.textContent).toBe(`by ${AUTHOR}`);
    await fireEvent.pointerLeave(own);
    await fireEvent.pointerEnter(within(group).getByRole('link', { name: /^Review by a bot/ }));
    expect(section.querySelector('.tip-who')?.textContent).toBe('by a bot');
  });

  it('takes the marks as one stop for the keyboard, the arrow keys moving along them in time order', async () => {
    const section = await timeline('#/?target=all&pr=67300', withEveryKind());
    const group = await within(section).findByRole('group', { name: 'The marks on the line, in time order' });
    const marks = within(group).getAllByRole('link');
    expect(marks.map((m) => m.tabIndex).filter((t) => t === 0)).toHaveLength(1);
    (marks[0] as HTMLElement).focus();
    await fireEvent.keyDown(marks[0] as HTMLElement, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(marks[1]);
    await fireEvent.keyDown(marks[1] as HTMLElement, { key: 'End' });
    expect(document.activeElement).toBe(marks.at(-1));
    expect(marks.at(-1)?.tabIndex).toBe(0);
  });

  it('gives the PR’s title, branch, commits and disclosure under the heading', async () => {
    const section = await timeline('#/?target=all&pr=67300', withEveryKind());
    const line = await within(section).findByText('mgr: a PR with every event');
    expect(line.parentElement?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'mgr: a PR with every event master · 1 commit · AI use not disclosed',
    );
  });

  it('names each link of the events table for what it opens', async () => {
    const section = await timeline('#/?target=all&pr=67300', withEveryKind());
    const table = await within(section).findByRole('table');
    expect(within(table).getByRole('link', { name: 'Review approving (fixture-author-a), 3 Aug 2026 15:00 UTC, on GitHub' }).getAttribute('href')).toBe(
      `${PR}#pullrequestreview-201`,
    );
    expect(within(table).queryAllByRole('link', { name: 'open' })).toHaveLength(0);
    expect(within(section).getByRole('group', { name: 'Legend' })).toBeTruthy();
  });

  it('starts a new PR’s timeline afresh, not carrying over the last one’s focused mark', async () => {
    const { props } = await fixturePage('#/?target=all&pr=66600');
    render(App, { props });
    const first = await screen.findByRole('region', { name: 'Pull request #66600' });
    const marks = within(await within(first).findByRole('group', { name: /^The marks/ })).getAllByRole('link');
    (marks[0] as HTMLElement).focus();
    await fireEvent.keyDown(marks[0] as HTMLElement, { key: 'End' });
    expect(marks.at(-1)?.tabIndex).toBe(0);
    // #66100 is in the same year's table, so only the key starts its chart afresh.
    props.page.selection.update((st) => ({ ...st, pr: 66100 }));
    const next = await screen.findByRole('region', { name: 'Pull request #66100' });
    const nextMarks = within(await within(next).findByRole('group', { name: /^The marks/ })).getAllByRole('link');
    expect(nextMarks.map((m) => m.tabIndex).indexOf(0)).toBe(0);
  });

  it('heads the timeline with the PR’s number, linked, and lists its commits by short SHA', async () => {
    const section = await timeline('#/?target=all&pr=67300', withEveryKind());
    const heading = within(section).getByRole('heading', { level: 2 });
    expect(within(heading).getByRole('link', { name: '#67300' }).getAttribute('href')).toBe(PR);
    const commit = await within(section).findByRole('link', { name: /^Commit ccccccc/ });
    expect(commit.getAttribute('href')).toBe(`${PR}/commits/${SHA('c')}`);
    expect(commit.textContent).toBe('ccccccc');
  });

  it('leaves an unknown first commit off the line and says so', async () => {
    const section = await timeline('#/?target=all&pr=67000');
    const group = await within(section).findByRole('group', { name: 'The marks on the line, in time order' });
    const names = within(group)
      .getAllByRole('link')
      .map((m) => m.getAttribute('aria-label') ?? '');
    expect(names.some((n) => n.startsWith('First commit'))).toBe(false);
    expect(names.some((n) => n.startsWith('Opened'))).toBe(true);
    expect(within(section).getByText(/The first commit is unknown: .* It is left off the line\./)).toBeTruthy();
    expect(within(section).getByText('unknown')).toBeTruthy();
  });

  it('says "no such PR" for a number not in the data, and draws nothing', async () => {
    const section = await timeline('#/?target=all&pr=12345');
    // The number is looked up in the index first: the period loads one year.
    expect(await within(section).findByText(/no such PR: #12345 is not in the data/)).toBeTruthy();
    expect(within(section).queryByRole('group')).toBeNull();
    expect(within(section).queryByRole('figure')).toBeNull();
  });

  it('says so when the PR’s table cannot be loaded', async () => {
    const section = await timeline('#/?target=all&pr=66500', { 'table-2026.json': undefined });
    expect(await within(section).findByRole('alert')).toBeTruthy();
    expect(within(section).getByRole('alert').textContent).toMatch(/table-2026\.json.*Reloading\s+the\s+page\s+will\s+try\s+again\./s);
  });
});

describe('before the timeline is on screen', () => {
  // An IntersectionObserver that reports nothing until a spec says an element came into view.
  const observed: { node: Element; cb: (entries: { isIntersecting: boolean }[]) => void }[] = [];
  const real = globalThis.IntersectionObserver;
  beforeAll(() => {
    globalThis.IntersectionObserver = class {
      readonly cb: (entries: { isIntersecting: boolean }[]) => void;
      constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
        this.cb = cb;
      }
      observe(node: Element) {
        observed.push({ node, cb: this.cb });
      }
      disconnect() {}
    } as unknown as typeof IntersectionObserver;
  });
  afterAll(() => {
    globalThis.IntersectionObserver = real;
  });

  it('fetches no table file for a PR the link names until its section is shown, then draws it', async () => {
    const loc = memoryLocation('#/?target=all&pr=67000');
    const selection = createStateStore(meta, loc);
    const fetched = fixtureFetch();
    const loader = new DataLoader(meta, BASE, fetched.fetch);
    const years = yearsForState(meta, get(selection));
    const data = createDataStore(loader, selection, years, await loader.load(years));
    render(App, { props: { page: { meta, selection, data, view: createViewStore(selection, data), loader } } });
    const section = await screen.findByRole('region', { name: 'Pull request #67000' });
    await new Promise((r) => setTimeout(r, 20));
    const tables = () => fetched.requested.filter((u) => u.includes('table-'));
    expect(tables()).toEqual([]);
    expect(within(section).getByText('The timeline of #67000 loads when this section is on screen.')).toBeTruthy();
    // Only the timeline's own section comes into view; the PR table stays off screen.
    for (const o of observed) if (o.node === section) o.cb([{ isIntersecting: true }]);
    await waitFor(() => expect(tables()).toEqual([`${BASE}table-2026.json`]));
    expect(await within(section).findByRole('group', { name: 'The marks on the line, in time order' })).toBeTruthy();
  });

  it('looks up a PR outside the loaded years only once its section is shown, then fetches the index and its one year', async () => {
    // #60010 is in 2025's files, which the last six months do not load.
    const { props, requested } = await fixturePage('#/?target=all&from=2026-05-15&pr=60010', withEarlierYear());
    const before = requested.length;
    render(App, { props });
    const section = await screen.findByRole('region', { name: 'Pull request #60010' });
    await new Promise((r) => setTimeout(r, 20));
    expect(requested.slice(before)).toEqual([]);
    expect(within(section).getByRole('status').textContent).toBe('Looking for #60010 in the years this period does not load…');
    for (const o of observed) if (o.node === section) o.cb([{ isIntersecting: true }]);
    expect(await within(section).findByRole('figure', { name: 'The life of #60010' })).toBeTruthy();
    expect(requested.slice(before)).toEqual([
      `${BASE}index.json`,
      `${BASE}prs-2025.json`,
      `${BASE}events-2025.json`,
      `${BASE}table-2025.json`,
    ]);
  });
});

// The chosen PR's section: what it is, then its timeline, between the lanes
// and the PR table, and the reader brought to it when a PR is chosen.
describe('the chosen PR’s section', () => {
  const scrolled: Element[] = [];
  const real = Element.prototype.scrollIntoView;
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
      scrolled.push(this);
    });
  });
  afterEach(() => {
    scrolled.length = 0;
  });
  afterAll(() => {
    Element.prototype.scrollIntoView = real;
  });

  it('sits between the lanes and the PR table, its panel before its timeline', async () => {
    const section = await timeline('#/?target=all&pr=66600');
    const heads = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent?.trim());
    const at = heads.indexOf('Pull request #66600');
    expect(heads.slice(at - 1, at + 2)).toEqual(['Timelines', 'Pull request #66600', 'Pull requests']);
    const panel = within(section).getByRole('group', { name: 'Selected PR #66600' });
    const chart = await within(section).findByRole('figure', { name: 'The life of #66600' });
    expect(panel.compareDocumentPosition(chart) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('leaves the reader where the page starts for a PR the address names on arrival', async () => {
    await timeline('#/?target=all&pr=66600');
    await new Promise((r) => setTimeout(r, 20));
    expect(scrolled).toEqual([]);
    expect(document.activeElement?.id).not.toBe('pr-heading');
  });

  it('brings the reader to it, its heading focused, when a PR is chosen from a table row', async () => {
    const { props } = await fixturePage('#/?target=all');
    render(App, { props });
    const table = within(screen.getByRole('region', { name: 'Pull requests' }));
    await fireEvent.click(await table.findByRole('button', { name: 'doc: fix a typo' }));
    const section = await screen.findByRole('region', { name: 'Pull request #66510' });
    await waitFor(() => expect(scrolled).toEqual([section]));
    expect(document.activeElement).toBe(within(section).getByRole('heading', { level: 2 }));
  });

  it('brings the reader to it from a lane, and to the next PR chosen from the panel', async () => {
    const { props } = await fixturePage('#/?target=all');
    render(App, { props });
    const lanes = within(screen.getByRole('region', { name: 'Timelines' }));
    await fireEvent.click(within(lanes.getByRole('list', { name: /PRs in the lanes/ })).getByRole('link', { name: '#66800' }));
    const section = await screen.findByRole('region', { name: 'Pull request #66800' });
    await waitFor(() => expect(scrolled).toEqual([section]));
    expect(document.activeElement?.id).toBe('pr-heading');
    // #66800 backports #66500: showing that one brings the reader to the section's top again.
    await fireEvent.click(await within(section).findByRole('button', { name: 'Show #66500 here' }));
    await screen.findByRole('region', { name: 'Pull request #66500' });
    await waitFor(() => expect(scrolled).toHaveLength(2));
  });

  it('says in one line when the filters leave the chosen PR out of the selection', async () => {
    const line = /^This pull request is not in the current selection/;
    // #66800 is a backport, to squid: outside the default target, master.
    let section = await timeline('#/?target=master&pr=66800');
    expect(within(section).getByText(line)).toBeTruthy();
    cleanup();
    section = await timeline('#/?target=all&pr=66800');
    expect(within(section).queryByText(line)).toBeNull();
    cleanup();
    // #66600 is fixture-author-f's, not fixture-author-d's.
    section = await timeline('#/?target=all&author=fixture-author-d&pr=66600');
    expect(within(section).getByText(line).textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'This pull request is not in the current selection: the filters leave it out, so no chart, lane or table on this page counts it.',
    );
    expect(await within(section).findByRole('figure', { name: 'The life of #66600' })).toBeTruthy();
  });
});

describe('a PR in a year the period does not load', () => {
  // 2025's files hold #60010 alone, merged 2025-06-10; the last six months,
  // from 2026-05-15, load 2026's alone.
  const earlier = withEarlierYear();
  const line = /^This pull request is not in the current selection/;

  async function shown(hash: string, files: Record<string, unknown> = earlier) {
    const { props, requested } = await fixturePage(hash, files);
    render(App, { props });
    const section = await screen.findByRole('region', { name: /^Pull request #/ });
    return { section, requested };
  }

  it('does not fetch the index, nor any earlier year, for a PR the loaded years hold', async () => {
    const { section, requested } = await shown('#/?target=all&from=2026-05-15&pr=66500');
    await within(section).findByRole('figure', { name: 'The life of #66500' });
    expect(requested.filter((u) => u.endsWith('index.json') || u.includes('-2025'))).toEqual([]);
  });

  it('finds it through the index, loads its one year, and draws its panel and timeline, saying the selection leaves it out', async () => {
    const { section, requested } = await shown('#/?target=all&from=2026-05-15&pr=60010');
    expect(await within(section).findByRole('figure', { name: 'The life of #60010' })).toBeTruthy();
    expect(within(section).getByText(line)).toBeTruthy();
    expect(within(section).getByRole('group', { name: 'Selected PR #60010' })).toBeTruthy();
    expect(requested.filter((u) => u.endsWith('index.json'))).toHaveLength(1);
    expect(requested.filter((u) => u.includes('-2025'))).toEqual([
      `${BASE}prs-2025.json`,
      `${BASE}events-2025.json`,
      `${BASE}table-2025.json`,
    ]);
  });

  it('leaves the figures to the period: the year loaded for the PR joins no chart, lane or table', async () => {
    const { props } = await fixturePage('#/?target=all&from=2026-05-15&pr=60010', earlier);
    render(App, { props });
    await screen.findByRole('figure', { name: 'The life of #60010' });
    expect(get(props.page.view).dataset.years.map((y) => y.year)).toEqual([2026]);
    const lanes = within(screen.getByRole('region', { name: 'Timelines' }));
    expect(within(lanes.getByRole('list', { name: /PRs in the lanes/ })).queryByRole('link', { name: '#60010' })).toBeNull();
  });

  it('says "no such PR" for a number in no year, after asking the index once', async () => {
    const { section, requested } = await shown('#/?target=all&from=2026-05-15&pr=12345');
    expect(await within(section).findByText(/no such PR: #12345 is not in the data/)).toBeTruthy();
    expect(within(section).queryByRole('figure')).toBeNull();
    expect(requested.filter((u) => u.endsWith('index.json'))).toHaveLength(1);
    expect(requested.filter((u) => u.includes('-2025'))).toEqual([]);
  });

  it('says so when the index cannot be loaded', async () => {
    const { section } = await shown('#/?target=all&from=2026-05-15&pr=60010', { ...earlier, 'index.json': undefined });
    const alert = await within(section).findByRole('alert');
    expect(alert.textContent).toMatch(/#60010 could not be looked up in the years this period does not load: index\.json: HTTP 404/);
  });

  it('says so when the year that holds it cannot be loaded', async () => {
    const { section } = await shown('#/?target=all&from=2026-05-15&pr=60010', { ...earlier, 'events-2025.json': undefined });
    const alert = await within(section).findByRole('alert');
    expect(alert.textContent).toMatch(/events-2025\.json: HTTP 404/);
  });

  it('shows it in the selection once the period reaches back to its year', async () => {
    const { section } = await shown('#/?target=all&from=2025-03-01&pr=60010');
    expect(await within(section).findByRole('figure', { name: 'The life of #60010' })).toBeTruthy();
    expect(within(section).queryByText(line)).toBeNull();
  });

  it('offers a backport’s original from a year not loaded, and shows it from there', async () => {
    // #65220, open on reef, made a backport of #60010.
    const table = { ...rawTable2026, backport_of: rawTable2026.backport_of.map((b, i) => (i === 1 ? 60010 : b)) };
    const { section } = await shown('#/?target=all&from=2026-05-15&pr=65220', { ...earlier, 'table-2026.json': table });
    await fireEvent.click(await within(section).findByRole('button', { name: 'Show #60010 here' }));
    expect(await screen.findByRole('figure', { name: 'The life of #60010' })).toBeTruthy();
  });
});
