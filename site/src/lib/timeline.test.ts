import { describe, expect, it } from 'vitest';
import { NAMED_A, NAME_A, POOLED, deletedMeta } from './__fixtures__/deleted';
import { type Commit, type TableYear, parseMeta } from './data';
import { META, at, dataset, type Event, type Row } from './stats/testing';
import {
  LAYOUT,
  MARK_STYLES,
  DISCLOSURE_WORDS,
  ROWS,
  describeTimeline,
  markName,
  prTimeline,
  reopenedText,
  timelineLayout,
  timelineLegend,
  type PlacedClosed,
  whoText,
} from './timeline';
import { labelWidth } from './timeline-axis';
import { DAY } from './filters';

const KINDS = [...META.event_kinds, 'review_author'];
const SHA = (c: string) => c.repeat(40);
const PR = 'https://github.com/ceph/ceph/pull/70000';

/** A table for a one-year dataset: refs aligned with its sorted events, commits per row. */
function table(rows: number, refs: string[], commits: (readonly Commit[])[] = []): TableYear {
  return {
    titles: Array.from({ length: rows }, () => 'a title'),
    authors: Array.from({ length: rows }, () => 'someone'),
    commits: Array.from({ length: rows }, (_, r) => commits[r] ?? []),
    refs,
    issues: Array.from({ length: rows }, () => []),
    backport_of: Array.from({ length: rows }, () => 0),
    kind_source: Array.from({ length: rows }, () => ''),
  };
}

// #70000 has an event of every kind, one an hour from 10:00 on 3 Aug 2026,
// after a first commit on 1 Aug and an opening at 09:00 on 3 Aug.
const OPENED = at('2026-08-03T09:00:00Z');
const hour = (h: number) => OPENED + h * 3600;
const EVERY: { kind: string; ref: string; sub?: number }[] = [
  { kind: 'comment_other', ref: '101' },
  { kind: 'comment_author', ref: '102' },
  { kind: 'command_author', ref: '103', sub: 0 },
  { kind: 'command_other', ref: '104', sub: 1 },
  { kind: 'bot_account', ref: '105' },
  { kind: 'review_approved', ref: '201' },
  { kind: 'review_changes', ref: '202' },
  { kind: 'review_commented', ref: '203' },
  { kind: 'bot_review', ref: '204' },
  { kind: 'review_author', ref: '205' },
  { kind: 'draft', ref: '301' },
  { kind: 'ready', ref: '302' },
  { kind: 'force_push', ref: SHA('a') },
  { kind: 'force_push', ref: '' },
  { kind: 'closed', ref: '303' },
  { kind: 'reopened', ref: '' },
  { kind: 'merged', ref: SHA('b') },
];
const FIRST = at('2026-08-01T12:00:00Z');
const LAST = hour(13);
const MERGED = hour(EVERY.length);

function everyKind() {
  const rows: Row[] = [
    { number: 70000, created: OPENED, first_commit: FIRST, last_commit: LAST, state: 1, closed: MERGED, reopened: 1 },
  ];
  const events: Event[] = EVERY.map((e, i) => ({ pr: 0, at: hour(i + 1), kind: e.kind, ...(e.sub === undefined ? {} : { sub: e.sub }) }));
  const data = dataset(rows, events, { event_kinds: KINDS });
  const commits: Commit[] = [
    [SHA('c'), FIRST, FIRST],
    [SHA('d'), hour(2), LAST],
  ];
  return { data, table: table(1, EVERY.map((e) => e.ref), [commits]) };
}

describe('prTimeline', () => {
  it('has one mark per event, in time order, with the first commit, the opening and the last commit', () => {
    const { data, table: t } = everyKind();
    const tl = prTimeline(data, 0, t);
    expect(tl.marks.map((m) => m.kind)).toEqual([
      'first_commit',
      'opened',
      ...EVERY.slice(0, 12).map((e) => e.kind),
      'last_commit',
      ...EVERY.slice(12).map((e) => e.kind),
    ]);
    const times = tl.marks.map((m) => m.at);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(tl.marks.filter((m) => m.event !== null).map((m) => m.event)).toEqual(EVERY.map((_, i) => i));
  });

  it('gives each mark the address its id or SHA makes', () => {
    const { data, table: t } = everyKind();
    const href = Object.fromEntries(
      prTimeline(data, 0, t)
        .marks.filter((m) => m.event !== null)
        .map((m) => [`${m.kind}:${m.event}`, m.href]),
    );
    expect(href).toEqual({
      'comment_other:0': `${PR}#issuecomment-101`,
      'comment_author:1': `${PR}#issuecomment-102`,
      'command_author:2': `${PR}#issuecomment-103`,
      'command_other:3': `${PR}#issuecomment-104`,
      'bot_account:4': `${PR}#issuecomment-105`,
      'review_approved:5': `${PR}#pullrequestreview-201`,
      'review_changes:6': `${PR}#pullrequestreview-202`,
      'review_commented:7': `${PR}#pullrequestreview-203`,
      'bot_review:8': `${PR}#pullrequestreview-204`,
      'review_author:9': `${PR}#pullrequestreview-205`,
      'draft:10': `${PR}#event-301`,
      'ready:11': `${PR}#event-302`,
      'force_push:12': `https://github.com/ceph/ceph/commit/${SHA('a')}`,
      'force_push:13': null,
      'closed:14': `${PR}#event-303`,
      'reopened:15': PR,
      'merged:16': `https://github.com/ceph/ceph/commit/${SHA('b')}`,
    });
  });

  it('links the opening to the PR and the first and last commits to theirs', () => {
    const { data, table: t } = everyKind();
    const marks = prTimeline(data, 0, t).marks;
    const of = (kind: string) => marks.find((m) => m.kind === kind)?.href;
    expect(of('opened')).toBe(PR);
    expect(of('first_commit')).toBe(`${PR}/commits/${SHA('c')}`);
    expect(of('last_commit')).toBe(`${PR}/commits/${SHA('d')}`);
  });

  it('names a command by its command', () => {
    const { data, table: t } = everyKind();
    const marks = prTimeline(data, 0, t).marks;
    expect(marks.find((m) => m.kind === 'command_author')?.detail).toBe(META.commands[0]?.name);
    expect(marks.find((m) => m.kind === 'command_other')?.detail).toBe(META.commands[1]?.name);
  });

  it('ends a merged PR at its merge, with no close beside it', () => {
    const { data, table: t } = everyKind();
    const tl = prTimeline(data, 0, t);
    expect(tl.disposition).toEqual({ state: 'merged', at: MERGED });
    expect(tl.marks.filter((m) => m.kind === 'merged')).toHaveLength(1);
    expect(tl.marks.filter((m) => m.kind === 'closed')).toHaveLength(1);
  });

  it('keeps the stretches the PR spent closed and counts its reopenings', () => {
    const { data, table: t } = everyKind();
    const tl = prTimeline(data, 0, t);
    expect(tl.closedStretches).toEqual([{ from: hour(15), to: hour(16) }]);
    expect(tl.reopened).toBe(1);
  });

  it('says on both marks of a closed stretch how long it lasted, and lists every stretch in the summary', () => {
    // #67071's course: closed and reopened at one second, twice, then for 30 and 60 days.
    const t0 = OPENED;
    const closings: [number, number][] = [
      [t0 + DAY, t0 + DAY],
      [t0 + 2 * DAY, t0 + 2 * DAY + 20],
      [t0 + 3 * DAY, t0 + 33 * DAY],
      [t0 + 40 * DAY, t0 + 100 * DAY],
    ];
    const events: Event[] = closings.flatMap(([c, r]) => [
      { pr: 0, at: c, kind: 'closed' },
      { pr: 0, at: r, kind: 'reopened' },
    ]);
    const data = dataset([{ number: 70000, created: t0, reopened: 4 }], events);
    const tl = prTimeline(data, 0, table(1, events.map((e) => (e.kind === 'closed' ? '7' : ''))));
    const names = tl.marks.filter((m) => m.event !== null).map(markName);
    expect(names.slice(0, 4)).toEqual([
      'Closed for under a minute, 4 Aug 2026 09:00 UTC',
      'Reopened after under a minute closed, 4 Aug 2026 09:00 UTC',
      'Closed for under a minute, 5 Aug 2026 09:00 UTC',
      'Reopened after under a minute closed, 5 Aug 2026 09:00 UTC',
    ]);
    expect(names[4]).toBe('Closed for 30 days, 6 Aug 2026 09:00 UTC');
    expect(reopenedText(tl)).toBe('Closed and reopened 4 times: for under a minute, under a minute, 30 days and 60 days.');
  });

  it('heads the timeline with the PR’s title, branch, commits and disclosure in words', () => {
    const trailer = META.disclosure.indexOf('trailer');
    const data = dataset([{ number: 70000, created: OPENED, base: 1, commits: 3, disclosure: trailer }]);
    const tl = prTimeline(data, 0, { ...table(1, []), titles: ['rgw: a <b>bold</b> title'] });
    expect([tl.title, tl.base, tl.commitCount, tl.disclosure]).toEqual(['rgw: a <b>bold</b> title', 'reef', 3, 'AI use disclosed in a trailer']);
    expect(prTimeline(dataset([{ number: 70000, created: OPENED }]), 0, table(1, [])).disclosure).toBe('AI use not disclosed');
  });

  it('says a PR whose only disclosure is the ticked AI-guidelines box discloses by it', () => {
    const checklist = META.disclosure.indexOf('checklist');
    expect(checklist).toBeGreaterThan(0);
    const data = dataset([{ number: 70000, created: OPENED, disclosure: checklist }]);
    expect(prTimeline(data, 0, table(1, [])).disclosure).toBe('AI use disclosed by the PR template’s AI-guidelines box');
  });

  it('draws a merge and the close GitHub records a second after it as the merge alone', () => {
    // #68362: reopened, then merged at 19:33:00 and closed at 19:33:01.
    const merge = at('2026-06-01T19:33:00Z');
    const data = dataset(
      [{ number: 70000, created: merge - 2 * DAY, state: 1, closed: merge, reopened: 1 }],
      [
        { pr: 0, at: merge - 3600, kind: 'closed' },
        { pr: 0, at: merge - 600, kind: 'reopened' },
        { pr: 0, at: merge, kind: 'merged' },
        { pr: 0, at: merge + 1, kind: 'closed' },
      ],
    );
    const tl = prTimeline(data, 0, table(1, ['5', '', SHA('b'), '6']));
    expect(tl.marks.map((m) => m.kind)).toEqual(['opened', 'closed', 'reopened', 'merged']);
    expect(tl.disposition).toEqual({ state: 'merged', at: merge });
  });

  it('does not take the final close of a PR closed unmerged for a closed stretch', () => {
    const closed = at('2026-08-10T00:00:00Z');
    const data = dataset([{ number: 70000, created: OPENED, state: 2, closed }], [{ pr: 0, at: closed, kind: 'closed' }]);
    const tl = prTimeline(data, 0, table(1, ['77']));
    expect(tl.closedStretches).toEqual([]);
    expect(tl.disposition).toEqual({ state: 'closed', at: closed });
    expect(tl.marks.map((m) => m.kind)).toEqual(['opened', 'closed']);
  });

  it('marks a finished PR whose ending event is missing at its closing time, linked to the PR', () => {
    const closed = at('2026-08-10T00:00:00Z');
    const data = dataset([{ number: 70000, created: OPENED, state: 1, closed }]);
    const end = prTimeline(data, 0, table(1, [])).marks.at(-1);
    expect(end).toMatchObject({ kind: 'merged', at: closed, href: PR, event: null });
  });

  it('leaves an unknown first commit off and says so', () => {
    const data = dataset([{ number: 70000, created: OPENED, first_commit: -1, last_commit: hour(2) }]);
    const tl = prTimeline(data, 0, table(1, [], [[[SHA('e'), hour(1), hour(2)]]]));
    expect(tl.marks.map((m) => m.kind)).not.toContain('first_commit');
    expect(tl.firstCommitNote).toBe('The first commit is unknown: its author date is after the opening, so the history was rewritten.');
    expect(tl.spans[0]).toMatchObject({ key: 'firstCommitToOpened', days: null, text: 'First commit to opened: unknown' });
  });

  it('says why when there is no commit at all', () => {
    const data = dataset([{ number: 70000, created: OPENED, commits: 0 }]);
    const tl = prTimeline(data, 0, table(1, []));
    expect(tl.firstCommitNote).toBe('The first commit is unknown: no commits were recorded.');
    expect(tl.lastCommitNote).toBe('The last commit is unknown: no commits were recorded.');
  });

  it('runs a PR still open to the last fetch, linked to the PR, its spans so far', () => {
    const now = META.fetched_through;
    const data = dataset([{ number: 70000, created: OPENED, first_commit: OPENED - 3600, last_commit: OPENED + 86400 }]);
    const tl = prTimeline(data, 0, table(1, []));
    expect(tl.disposition).toEqual({ state: 'open', at: now });
    expect(tl.marks.at(-1)).toMatchObject({ kind: 'open_now', at: now, href: PR });
    expect(tl.spans.map((s) => s.text)).toEqual([
      'First commit to opened: 1 hour',
      'Opened to last commit: 24 hours so far',
      `Last commit to final disposition: ${Math.round((now - OPENED - 86400) / 86400)} days so far`,
    ]);
  });

  it('measures the three spans of a finished PR, clamping a last commit before the opening at zero', () => {
    const data = dataset([
      {
        number: 70000,
        created: OPENED,
        first_commit: OPENED - 30 * 86400,
        last_commit: OPENED - 86400,
        state: 1,
        closed: OPENED + 5 * 86400,
        base: 1,
      },
    ]);
    const tl = prTimeline(data, 0, table(1, []));
    expect(tl.spans.map((s) => [s.key, s.days, s.from, s.to])).toEqual([
      ['firstCommitToOpened', 30, OPENED - 30 * 86400, OPENED],
      ['openedToLastCommit', 0, OPENED, OPENED],
      ['afterLastCommit', 6, OPENED - 86400, OPENED + 5 * 86400],
    ]);
    // On a branch other than master, but linking no original: not worded as a backport.
    expect(tl.spans[0]?.text).toBe('First commit to opened: 30 days');
  });

  describe('the backport wording, only for a PR that links the original it backports', () => {
    const bases = { bases: ['master', 'squid', 'wip-feature-x'] };
    const row = (base: number): Row => ({ number: 26000, created: OPENED, first_commit: OPENED - 30 * DAY, state: 1, closed: OPENED + DAY, base });
    const linking = (original: number): TableYear => ({ ...table(1, []), backport_of: [original] });
    const titles = (base: number, original: number) =>
      prTimeline(dataset([row(base)], [], bases), 0, linking(original)).spans.map((s) => s.text);
    const NEUTRAL = ['First commit to opened: 30 days', 'Opened to last commit: unknown', 'Last commit to final disposition: unknown'];

    it('words a release-branch PR that links its original as a backport', () => {
      const tl = prTimeline(dataset([row(1)], [], bases), 0, linking(25000));
      expect(tl.spans[0]?.text).toBe('Original work to backport opened: 30 days');
      expect(describeTimeline(tl)).toContain('Original work to backport opened: 30 days');
    });

    it('gives a release-branch PR that links none the neutral titles', () => {
      expect(titles(1, 0)).toEqual(NEUTRAL);
      expect(describeTimeline(prTimeline(dataset([row(1)], [], bases), 0, linking(0)))).not.toContain('backport');
    });

    it('gives a feature-branch PR the neutral titles', () => {
      expect(titles(2, 0)).toEqual(NEUTRAL);
    });

    it('leaves a development-branch PR as it was', () => {
      expect(titles(0, 0)).toEqual(NEUTRAL);
    });
  });

  describe('a PR on master, the development branch', () => {
    const bases = { bases: ['master', 'release-1.21'] };
    const row = (base: number): Row => ({ number: 26000, created: OPENED, first_commit: OPENED - 30 * DAY, state: 1, closed: OPENED + DAY, base });

    it('is original work, its first span the time from its first commit, as on a release branch', () => {
      expect(prTimeline(dataset([row(0)], [], bases), 0, table(1, [])).spans[0]?.text).toBe('First commit to opened: 30 days');
      expect(prTimeline(dataset([row(1)], [], bases), 0, table(1, [])).spans[0]?.text).toBe('First commit to opened: 30 days');
    });

    it('keeps its branch’s name', () => {
      expect(prTimeline(dataset([row(0)], [], bases), 0, table(1, [])).base).toBe('master');
    });
  });

  it('lists the commits by short SHA, each linked', () => {
    const { data, table: t } = everyKind();
    expect(prTimeline(data, 0, t).commits.map((c) => [c.short, c.href])).toEqual([
      ['ccccccc', `${PR}/commits/${SHA('c')}`],
      ['ddddddd', `${PR}/commits/${SHA('d')}`],
    ]);
  });
});

describe('markName', () => {
  it('says what a mark is and when', () => {
    const { data, table: t } = everyKind();
    const marks = prTimeline(data, 0, t).marks;
    const approval = marks.find((m) => m.kind === 'review_approved');
    expect(approval && markName(approval)).toBe('Review approving, 3 Aug 2026 15:00 UTC');
  });

  it('names the command, and says when the address was not recorded', () => {
    const { data, table: t } = everyKind();
    const marks = prTimeline(data, 0, t).marks;
    const command = marks.find((m) => m.kind === 'command_other');
    expect(command && markName(command)).toBe(`Bot command by another person: ${META.commands[1]?.name}, 3 Aug 2026 13:00 UTC`);
    const push = marks.find((m) => m.kind === 'force_push' && m.href === null);
    expect(push && markName(push)).toBe('Force-push, 3 Aug 2026 23:00 UTC, address not recorded');
  });

});

// The fixture's people: 0 fixture-author-e, 1 fixture-author-f, 2
// fixture-author-a, 3 fixture-author-i, 4 fixture-reviewer-k, 7
// fixture-author-d, 10 fixture-author-j (a bot account).
describe('who made each mark', () => {
  const ACTORS: Record<string, number> = { comment_other: 1, review_approved: 2, review_changes: 3, review_commented: 4 };

  function withActors(author: number, people = META.people) {
    const events: Event[] = EVERY.map((e, i) => ({
      pr: 0,
      at: hour(i + 1),
      kind: e.kind,
      ...(e.sub === undefined ? {} : { sub: e.sub }),
      ...(ACTORS[e.kind] === undefined ? {} : { actor: ACTORS[e.kind] }),
    }));
    const data = dataset(
      [{ number: 70000, created: OPENED, first_commit: FIRST, last_commit: LAST, state: 1, closed: MERGED, reopened: 1, author }],
      events,
      { event_kinds: KINDS, people },
    );
    return prTimeline(data, 0, table(1, EVERY.map((e) => e.ref)));
  }
  const who = (tl: ReturnType<typeof withActors>, kind: string) => tl.marks.find((m) => m.kind === kind)?.who;
  const name = (tl: ReturnType<typeof withActors>, kind: string) => markName(tl.marks.find((m) => m.kind === kind) as never);

  it('names the person an event’s actor gives, for comments and reviews by others', () => {
    const tl = withActors(7);
    expect(who(tl, 'comment_other')).toEqual({
      by: 'person',
      handle: { login: 'fixture-author-f', text: 'fixture-author-f', url: 'https://github.com/fixture-author-f' },
      author: false,
      bot: false,
    });
    expect(name(tl, 'comment_other')).toBe('Comment by another person (fixture-author-f), 3 Aug 2026 10:00 UTC');
    expect(name(tl, 'review_approved')).toBe('Review approving (fixture-author-a), 3 Aug 2026 15:00 UTC');
    expect(name(tl, 'review_changes')).toBe('Review requesting changes (fixture-author-i), 3 Aug 2026 16:00 UTC');
    expect(name(tl, 'review_commented')).toBe('Review commenting (fixture-reviewer-k), 3 Aug 2026 17:00 UTC');
  });

  it('names the author for the opening and for the author’s own comments, commands and review replies', () => {
    const tl = withActors(7);
    for (const kind of ['opened', 'comment_author', 'command_author', 'review_author']) {
      expect(who(tl, kind), kind).toMatchObject({ by: 'person', author: true, handle: { login: 'fixture-author-d' } });
    }
    expect(name(tl, 'opened')).toBe('Opened (fixture-author-d, the author), 3 Aug 2026 09:00 UTC');
    expect(name(tl, 'comment_author')).toBe('Comment by the author (fixture-author-d, the author), 3 Aug 2026 11:00 UTC');
    expect(name(tl, 'command_author')).toBe(
      `Bot command by the author: ${META.commands[0]?.name} (fixture-author-d, the author), 3 Aug 2026 12:00 UTC`,
    );
  });

  it('says a bot account’s comment or review is a bot’s, naming no one', () => {
    const tl = withActors(7);
    expect(who(tl, 'bot_account')).toEqual({ by: 'bot' });
    expect(who(tl, 'bot_review')).toEqual({ by: 'bot' });
    expect(name(tl, 'bot_review')).toBe('Review by a bot, 3 Aug 2026 18:00 UTC');
    expect(whoText({ by: 'bot' })).toBe('a bot');
  });

  it('names no one where the data does not say who: another person’s bot command, and the PR’s other points', () => {
    const tl = withActors(7);
    for (const kind of ['command_other', 'first_commit', 'last_commit', 'draft', 'ready', 'force_push', 'closed', 'reopened', 'merged']) {
      expect(who(tl, kind), kind).toBeNull();
    }
    expect(name(tl, 'command_other')).toBe(`Bot command by another person: ${META.commands[1]?.name}, 3 Aug 2026 13:00 UTC`);
  });

  it('marks an author who is a bot account, and the pooled deleted account as "(deleted, unknown)", with no link', () => {
    expect(name(withActors(10), 'opened')).toBe('Opened (fixture-author-j, the author, a bot account), 3 Aug 2026 09:00 UTC');
    const people = [...META.people, 'ghost'];
    const tl = withActors(people.length - 1, people);
    expect(who(tl, 'opened')).toMatchObject({ handle: { text: '(deleted, unknown)', url: null } });
    expect(name(tl, 'opened')).toBe('Opened ((deleted, unknown), the author), 3 Aug 2026 09:00 UTC');
  });

  it('says another person’s comment is not the author’s when both are deleted accounts', () => {
    // Every comment by a deleted account is the pooled `ghost` entry's;
    // another person's comment carries an actor, and so is never the author's.
    const people = [...META.people, 'ghost'];
    const ghost = people.length - 1;
    const data = dataset(
      [{ number: 70000, created: OPENED, author: ghost }],
      [{ pr: 0, at: hour(1), kind: 'comment_other', actor: ghost }],
      { event_kinds: KINDS, people },
    );
    const tl = prTimeline(data, 0, table(1, ['101']));
    const comment = tl.marks.find((m) => m.kind === 'comment_other');
    expect(comment?.who).toMatchObject({ by: 'person', author: false, handle: { text: '(deleted, unknown)' } });
    expect(comment && markName(comment)).toBe('Comment by another person ((deleted, unknown)), 3 Aug 2026 10:00 UTC');
    expect(tl.marks.find((m) => m.kind === 'opened')?.who).toMatchObject({ author: true });
  });

  it('names a deleted author by the name on the commits, and does not take a deleted account’s comment for theirs', () => {
    // Ada's PR, with a comment by a deleted account: it is the pooled entry's,
    // and is not known to be Ada's, so it is another person's. Ada's own
    // comment, a kind that carries no actor, is hers as any author's is.
    const meta = { ...parseMeta(deletedMeta()), event_kinds: KINDS };
    const data = dataset(
      [{ number: 70000, created: OPENED, author: NAMED_A }],
      [
        { pr: 0, at: hour(1), kind: 'comment_other', actor: POOLED },
        { pr: 0, at: hour(2), kind: 'comment_author' },
      ],
      meta,
    );
    const tl = prTimeline(data, 0, table(1, ['101', '102']));
    const mark = (kind: string) => tl.marks.find((m) => m.kind === kind);
    expect(mark('opened')?.who).toEqual({
      by: 'person',
      handle: { login: `ghost:${NAME_A}`, text: `(deleted) ${NAME_A}`, url: null },
      author: true,
      bot: false,
    });
    expect(markName(mark('opened') as never)).toBe(`Opened ((deleted) ${NAME_A}, the author), 3 Aug 2026 09:00 UTC`);
    expect(mark('comment_other')?.who).toMatchObject({ author: false, handle: { login: 'ghost', text: '(deleted, unknown)' } });
    expect(markName(mark('comment_other') as never)).toBe('Comment by another person ((deleted, unknown)), 3 Aug 2026 10:00 UTC');
    expect(mark('comment_author')?.who).toMatchObject({ author: true, handle: { text: `(deleted) ${NAME_A}` } });
  });

  it('never names anyone on a mark when the actor is missing', () => {
    const { data, table: t } = everyKind();
    expect(prTimeline(data, 0, t).marks.find((m) => m.kind === 'review_changes')?.who).toBeNull();
  });
});

describe('MARK_STYLES', () => {
  it('gives no two kinds in a row the same shape', () => {
    for (const { id } of ROWS) {
      const glyphs = Object.values(MARK_STYLES)
        .filter((s) => s.row === id)
        .map((s) => s.glyph);
      expect(new Set(glyphs).size, id).toBe(glyphs.length);
    }
  });
});

describe('timelineLegend', () => {
  it('lists the kinds present, row by row from the top', () => {
    const data = dataset(
      [{ number: 70000, created: OPENED, state: 2, closed: hour(3) }],
      [
        { pr: 0, at: hour(1), kind: 'review_approved' },
        { pr: 0, at: hour(2), kind: 'comment_other' },
        { pr: 0, at: hour(3), kind: 'closed' },
      ],
    );
    const legend = timelineLegend(prTimeline(data, 0, table(1, ['1', '2', '3'])));
    expect(legend.map((l) => [l.row, l.label])).toEqual([
      ['reviews', 'Review approving'],
      ['comments', 'Comment by another person'],
      ['life', 'Opened'],
      ['life', 'Closed'],
    ]);
  });
});

describe('timelineLayout', () => {
  it('places every mark in its row, a step apart from its neighbours there', () => {
    const { data, table: t } = everyKind();
    const layout = timelineLayout(prTimeline(data, 0, t), 800);
    expect(layout.marks).toHaveLength(EVERY.length + 3);
    const rows = new Map<number, number[]>();
    for (const m of layout.marks) rows.set(m.y, [...(rows.get(m.y) ?? []), m.x]);
    for (const xs of rows.values()) {
      xs.sort((a, b) => a - b);
      for (let i = 1; i < xs.length; i++) expect((xs[i] as number) - (xs[i - 1] as number)).toBeGreaterThanOrEqual(LAYOUT.sep - 1e-6);
    }
    expect(layout.marks.find((m) => m.mark.kind === 'review_approved')?.y).toBe(LAYOUT.rowY.reviews);
    expect(layout.marks.find((m) => m.mark.kind === 'merged')?.y).toBe(LAYOUT.rowY.life);
  });

  it('breaks the PR’s line where it was closed, and draws the stretch before it opened', () => {
    const { data, table: t } = everyKind();
    const layout = timelineLayout(prTimeline(data, 0, t), 800);
    const x = (kind: string) => layout.marks.find((m) => m.mark.kind === kind)?.x as number;
    expect(layout.closed).toMatchObject([{ x0: x('closed'), x1: x('reopened'), washed: true, label: 'closed 1 h' }]);
    expect(layout.open).toEqual([
      { x0: x('opened'), x1: x('closed') },
      { x0: x('reopened'), x1: x('merged') },
    ]);
    expect(layout.before).toEqual({ x0: x('first_commit'), x1: x('opened') });
  });

  it('draws a closing of under an hour as its pair of marks, with no wash and the line unbroken', () => {
    const t0 = OPENED;
    const data = dataset(
      [{ number: 70000, created: t0, state: 1, closed: t0 + 3 * DAY, reopened: 1 }],
      [
        { pr: 0, at: t0 + DAY, kind: 'closed' },
        { pr: 0, at: t0 + DAY, kind: 'reopened' },
        { pr: 0, at: t0 + 3 * DAY, kind: 'merged' },
      ],
    );
    const layout = timelineLayout(prTimeline(data, 0, table(1, ['1', '', SHA('b')])), 800);
    expect(layout.closed).toMatchObject([{ washed: false, label: null }]);
    const x = (kind: string) => layout.marks.find((m) => m.mark.kind === kind)?.x as number;
    expect(x('reopened') - x('closed')).toBe(LAYOUT.sep);
    expect(layout.open).toEqual([{ x0: x('opened'), x1: x('merged') }]);
  });

  it('keeps a closed stretch’s label clear of a cut’s marker when the stretch is the cut', () => {
    // Crowded comments, then closed for 200 days, reopened, and more comments: the closed stretch is cut out.
    const t0 = OPENED;
    const events: Event[] = [];
    for (let k = 0; k < 30; k++) events.push({ pr: 0, at: t0 + 60 + k * 60, kind: 'comment_other' });
    events.push({ pr: 0, at: t0 + 2 * 3600, kind: 'closed' }, { pr: 0, at: t0 + 2 * 3600 + 200 * DAY, kind: 'reopened' });
    for (let k = 0; k < 30; k++) events.push({ pr: 0, at: t0 + 200 * DAY + 3 * 3600 + k * 60, kind: 'comment_other' });
    const merge = t0 + 200 * DAY + 4 * 3600;
    events.push({ pr: 0, at: merge, kind: 'merged' });
    const data = dataset([{ number: 70000, created: t0, state: 1, closed: merge, reopened: 1 }], events);
    const refs = events.map((e) => (e.kind === 'reopened' ? '' : e.kind === 'merged' ? SHA('b') : '9'));
    const tl = prTimeline(data, 0, table(1, refs));
    const layout = timelineLayout(tl, 800);
    const cut = layout.cuts.find((c) => c.from === t0 + 2 * 3600);
    expect(cut).toBeDefined();
    const mid = ((cut as { x0: number; x1: number }).x0 + (cut as { x1: number }).x1) / 2;
    const c = layout.closed[0] as PlacedClosed;
    expect(c.label).toBe('closed 200 d');
    const half = labelWidth(c.label as string) / 2;
    expect(c.labelX + half <= mid - 8 || c.labelX - half >= mid + 8).toBe(true);
  });

  it('keeps a closed label near the line’s end inside the line, rather than widening it', () => {
    // A 30-day line with a comment every day, and a 65-minute closing that
    // ends five minutes before the merge: centred on its wash, the label
    // would run past the line's end.
    const t0 = OPENED;
    const merge = t0 + 30 * DAY;
    const events: Event[] = Array.from({ length: 29 }, (_, k) => ({ pr: 0, at: t0 + (k + 1) * DAY - 12 * 3600, kind: 'comment_other' }));
    events.push(
      { pr: 0, at: merge - 70 * 60, kind: 'closed' },
      { pr: 0, at: merge - 5 * 60, kind: 'reopened' },
      { pr: 0, at: merge, kind: 'merged' },
    );
    const data = dataset([{ number: 70000, created: t0, state: 1, closed: merge, reopened: 1 }], events);
    const refs = events.map((e) => (e.kind === 'reopened' ? '' : e.kind === 'merged' ? SHA('b') : '9'));
    const layout = timelineLayout(prTimeline(data, 0, table(1, refs)), 800);
    expect(layout.cuts).toEqual([]);
    const c = layout.closed[0] as PlacedClosed;
    expect(c.label).toBe('closed 1 h');
    const half = labelWidth(c.label as string) / 2;
    // Centred, it would end past 800.
    expect((c.x0 + c.x1) / 2 + half).toBeGreaterThan(800);
    expect(layout.width).toBe(800);
    expect(c.labelX + half).toBeLessThanOrEqual(800);
  });

  it('gives a cut’s far date in its note when the start’s label covers the far side', () => {
    // #72643: a first commit 182 days before a crowded opening.
    const t0 = OPENED;
    const events: Event[] = Array.from({ length: 40 }, (_, k) => ({ pr: 0, at: t0 + 600 + k * 600, kind: 'comment_other' }));
    const merge = t0 + 8 * 3600;
    events.push({ pr: 0, at: merge, kind: 'merged' });
    const data = dataset([{ number: 70000, created: t0, first_commit: t0 - 182 * DAY, state: 1, closed: merge }], events);
    const refs = events.map((e) => (e.kind === 'merged' ? SHA('b') : '9'));
    const layout = timelineLayout(prTimeline(data, 0, table(1, refs)), 800);
    expect(layout.cuts.map((c) => c.label)).toEqual(['182 days, to 3 Aug 2026']);
    // Centred on a cut at the line's start, it would begin left of the line: it is kept inside.
    const cut = layout.cuts[0] as { label: string; labelX: number };
    expect(cut.labelX - labelWidth(cut.label) / 2).toBeGreaterThanOrEqual(4);
  });

  it('dates every window of a 206-pixel view across the whole drawn line', () => {
    // A first commit 182 days before the opening, cut out, then 150 comments
    // 20 minutes apart: a line far wider than the view.
    const t0 = OPENED;
    const events: Event[] = Array.from({ length: 150 }, (_, k) => ({ pr: 0, at: t0 + 600 + k * 1200, kind: 'comment_other' }));
    const merge = t0 + 51 * 3600;
    events.push({ pr: 0, at: merge, kind: 'merged' });
    const data = dataset([{ number: 70000, created: t0, first_commit: t0 - 182 * DAY, state: 1, closed: merge }], events);
    const refs = events.map((e) => (e.kind === 'merged' ? SHA('b') : '9'));
    const layout = timelineLayout(prTimeline(data, 0, table(1, refs)), 206);
    expect(layout.cuts).toHaveLength(1);
    expect(layout.width).toBeGreaterThan(1000);
    const dated = layout.ticks.filter((t) => t.dated).map((t) => t.at);
    for (let x = 0; x + 206 <= layout.width; x++) {
      expect(dated.some((at) => at >= x && at <= x + 206), `the window from ${x}`).toBe(true);
    }
  });

  it('prints every washed closing’s real length, moving a label aside rather than dropping it', () => {
    // Five closings of an hour or two, a few minutes apart, among crowded comments.
    const t0 = OPENED;
    const events: Event[] = [];
    for (let k = 0; k < 5; k++) {
      const c = t0 + DAY + k * 3 * 3600;
      events.push({ pr: 0, at: c, kind: 'closed' }, { pr: 0, at: c + 3600 + k * 1800, kind: 'reopened' });
    }
    for (let k = 0; k < 40; k++) events.push({ pr: 0, at: t0 + DAY + k * 60, kind: 'comment_other' });
    events.push({ pr: 0, at: t0 + 40 * DAY, kind: 'merged' });
    events.sort((a, b) => a.at - b.at);
    const data = dataset([{ number: 70000, created: t0, state: 1, closed: t0 + 40 * DAY, reopened: 5 }], events);
    const refs = events.map((e) => (e.kind === 'merged' ? SHA('b') : e.kind === 'reopened' ? '' : '9'));
    const tl = prTimeline(data, 0, table(1, refs));
    for (const available of [390, 800, 1280]) {
      const layout = timelineLayout(tl, available);
      const washed = layout.closed.filter((c) => c.washed);
      expect(washed.map((c) => c.label)).toEqual(['closed 1 h', 'closed 2 h', 'closed 2 h', 'closed 3 h', 'closed 3 h']);
      for (let i = 1; i < washed.length; i++) {
        const a = washed[i - 1] as PlacedClosed;
        const b = washed[i] as PlacedClosed;
        const half = (c: PlacedClosed) => ((c.label as string).length * 7.2) / 2;
        expect(b.labelX - half(b)).toBeGreaterThanOrEqual(a.labelX + half(a));
      }
      for (const c of washed) expect(c.labelX + ((c.label as string).length * 7.2) / 2).toBeLessThanOrEqual(layout.width);
    }
  });

  it('names the points over the line without overlap, and sets span texts apart', () => {
    const { data, table: t } = everyKind();
    const layout = timelineLayout(prTimeline(data, 0, t), 400);
    expect(layout.labels.map((l) => l.text)).toContain('opened');
    const sorted = [...layout.labels].sort((a, b) => a.x - b.x);
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1] as { x: number; text: string };
      const b = sorted[i] as { x: number; text: string };
      expect(b.x - a.x).toBeGreaterThan((a.text.length + b.text.length) * 3.3);
    }
    expect(layout.spans.map((s) => s.text)).toEqual([
      'before opening: 45 hours',
      'opened to last commit: 13 hours',
      'after the last commit: 4 hours',
    ]);
  });
});

describe('DISCLOSURE_WORDS', () => {
  it('has words for every disclosure class meta lists', () => {
    for (const c of META.disclosure) expect(DISCLOSURE_WORDS[c], c).toBeTypeOf('string');
  });
});
