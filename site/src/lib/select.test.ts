import { describe, expect, it } from 'vitest';
import events2026 from './__fixtures__/data/events-2026.json';
import rawMeta from './__fixtures__/data/meta.json';
import prs2026 from './__fixtures__/data/prs-2026.json';
import { NAMED_A, NAMED_B, NAME_A, NAME_B, POOLED, deletedMeta } from './__fixtures__/deleted';
import { combine, parseMeta, parseYear } from './data';
import { type BackportLink, type Filters, type Target, dayOf, dayStart, periodRange } from './filters';
import { branchChoices, openedIn, openedInBucket, select } from './select';
import { defaultFilters } from './state';
import { META, all, at, dataset } from './stats/testing';
import { weekly } from './stats/weekly';

const meta = parseMeta(rawMeta);
const data = combine(meta, [parseYear(2026, prs2026, events2026, meta)]);

// Rows in the fixture: 0 #64010, 1 #65220, 2 #66100, 3 #66500, 4 #66510,
// 5 #66600, 6 #66700, 7 #66800, 8 #66900, 9 #67000, 10 #67100, 11 #67250.
// Their kinds: bugfix 0, 3, 7; feature 6, 8, 10; cleanup 2, 5; docs 4, 11;
// other 9; unknown 1.
const every: Filters = { ...defaultFilters(meta), target: 'all' };
const rows = (patch: Partial<Filters>) => [...select(data, { ...every, ...patch })];

describe('select', () => {
  it('selects every row with every filter at its neutral default, the whole window and all targets', () => {
    expect(rows({})).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('returns row ids in a Uint32Array', () => {
    expect(select(data, every)).toBeInstanceOf(Uint32Array);
  });

  it.each([
    ['target master', { target: 'master' }, [0, 2, 3, 4, 5, 6, 8, 9, 10]],
    ['target backports and other branches', { target: 'backports' }, [1, 7, 11]],
    ['component rgw', { component: 'rgw' }, [0, 3, 7, 9]],
    ['component mgr, one of two on #66900', { component: 'mgr' }, [5, 8, 10]],
    ['size up to 10', { size: 'le10' }, [1, 4]],
    ['size 11–100', { size: '11-100' }, [3, 6, 7, 10, 11]],
    ['size 101–1,000', { size: '101-1000' }, [0, 2, 8]],
    ['size over 1,000', { size: 'gt1000' }, [5, 9]],
    ['standing first PR', { standing: 'first' }, [3]],
    ['standing 1–9', { standing: '1-9' }, [4, 8, 10]],
    ['standing 10–99', { standing: '10-99' }, [5, 6, 11]],
    ['standing 100 or more', { standing: 'ge100' }, [7, 9]],
    ['standing unknown', { standing: 'unknown' }, [0, 1, 2]],
    ['disclosed', { disclosure: 'disclosed' }, [3, 7, 9, 10]],
    ['not disclosed', { disclosure: 'not-disclosed' }, [0, 1, 2, 4, 5, 6, 8, 11]],
    ['drafts excluded', { excludeDrafts: true }, [0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11]],
    ['reopened only', { reopenedOnly: true }, [8]],
    ['kind bug fix', { kind: 'bugfix' }, [0, 3, 7]],
    ['kind feature', { kind: 'feature' }, [6, 8, 10]],
    ['kind cleanup', { kind: 'cleanup' }, [2, 5]],
    ['kind documentation', { kind: 'docs' }, [4, 11]],
    ['kind other', { kind: 'other' }, [9]],
    ['kind unknown', { kind: 'unknown' }, [1]],
    // Opened before August and not finished before July.
    ['period July 2026', { from: '2026-07-01', to: '2026-07-31' }, [1, 2, 5, 6, 7, 8]],
  ] satisfies [string, Partial<Filters>, number[]][])('%s alone', (_name, patch, expected) => {
    expect(rows(patch)).toEqual(expected);
  });

  it('combines filters', () => {
    expect(rows({ target: 'master', disclosure: 'disclosed', size: 'gt1000' })).toEqual([9]);
  });

  it('selects nothing for a component meta does not name', () => {
    expect(rows({ component: 'no-such-component' })).toEqual([]);
  });

  it('selects nothing for a kind meta does not name, not the unknown kinds', () => {
    expect(rows({ kind: 'refactor' })).toEqual([]);
  });

  it('combines the kind with the other filters', () => {
    expect(rows({ target: 'master', kind: 'bugfix' })).toEqual([0, 3]);
  });
});

// The fixture's people: 0 fixture-author-e, 1 fixture-author-f, 2
// fixture-author-a, 3 fixture-author-i, 4 fixture-reviewer-k, 5
// fixture-author-b, 6 fixture-author-c, 7 fixture-author-d, 8
// fixture-author-g, 9 fixture-author-h, 10 fixture-author-j (a bot).
describe('the Author and Reviewer filters', () => {
  it.each([
    ['fixture-author-a', [0, 8]],
    ['fixture-author-d', [3, 10]],
    ['fixture-author-j', [11]],
    ['fixture-reviewer-k', []],
  ])('keep the PRs %s opened', (login, expected) => {
    expect(rows({ author: login })).toEqual(expected);
  });

  // The comments and reviews by people other than the author, by row:
  //   0 #64010  e on 2025-11-10, f on 2025-11-20 and 2026-06-08
  //   2 #66100  a on 2026-05-20, e on 2026-07-03
  //   3 #66500  f twice on 2026-05-19
  //   5 #66600  i on 2026-06-10
  //   6 #66700  a on 2026-06-16
  //   7 #66800  e on 2026-07-03
  //   8 #66900  i on 2026-07-08 and 2026-08-17
  //   9 #67000  k twice in August
  //  10 #67100  e on 2026-09-03, f on 2026-09-21
  it.each([
    // 64010's comment from e came before the period, which starts at the window.
    ['fixture-author-e', [2, 7, 10]],
    ['fixture-author-f', [0, 3, 10]],
    ['fixture-author-a', [2, 6]],
    ['fixture-author-i', [5, 8]],
    ['fixture-reviewer-k', [9]],
    // An author whose own PRs have comments, but who commented on no one else's.
    ['fixture-author-d', []],
  ])('keep the PRs %s reviewed or commented on in the period, not their own', (login, expected) => {
    expect(rows({ reviewer: login })).toEqual(expected);
  });

  it("leave out a review made outside the period on a PR active in it", () => {
    // #66100 is open through September; e reviewed it in July.
    expect(rows({ from: '2026-09-01' })).toContain(2);
    expect(rows({ from: '2026-09-01', reviewer: 'fixture-author-e' })).toEqual([10]);
  });

  it('combine with each other and with the other filters', () => {
    expect(rows({ author: 'fixture-author-d', reviewer: 'fixture-author-f' })).toEqual([3, 10]);
    expect(rows({ author: 'fixture-author-d', reviewer: 'fixture-author-e' })).toEqual([10]);
    expect(rows({ target: 'master', reviewer: 'fixture-author-e' })).toEqual([2, 10]);
  });

  it('keep a PR a deleted account commented on though another deleted account opened it, as the Reviewers table counts it', () => {
    // Every deleted account shares the one `ghost` index; an event that names
    // an actor is never the author's.
    const people = [...META.people, 'ghost'];
    const ghost = people.length - 1;
    const t = at('2026-06-01T00:00:00Z');
    const d = dataset(
      [
        { created: t, author: ghost },
        { created: t, author: 1 },
      ],
      [{ pr: 0, at: t + 3600, kind: 'comment_other', actor: ghost }],
      { people },
    );
    const f = { ...defaultFilters(d.meta), target: 'all' as const };
    expect([...select(d, { ...f, reviewer: 'ghost' })]).toEqual([0]);
    expect([...select(d, { ...f, author: 'ghost' })]).toEqual([0]);
  });

  it('select nothing for a login the data does not name', () => {
    expect(rows({ author: 'someone-else' })).toEqual([]);
    expect(rows({ reviewer: 'someone-else' })).toEqual([]);
  });

  it('keep a named deleted author’s PRs alone as author, and the pooled entry’s alone as `ghost`', () => {
    // Rows 0–1 by Ada, 2 by Åsa, 3 by the pooled entry, which commented on 0
    // and reviewed 2: comments and reviews by deleted accounts are its alone.
    const t = at('2026-06-01T00:00:00Z');
    const d = dataset(
      [
        { created: t, author: NAMED_A },
        { created: t, author: NAMED_A },
        { created: t, author: NAMED_B },
        { created: t, author: POOLED },
      ],
      [
        { pr: 0, at: t + 3600, kind: 'comment_other', actor: POOLED },
        { pr: 2, at: t + 3600, kind: 'review_approved', actor: POOLED },
      ],
      parseMeta(deletedMeta()),
    );
    const f = { ...defaultFilters(d.meta), target: 'all' as const };
    expect([...select(d, { ...f, author: `ghost:${NAME_A}` })]).toEqual([0, 1]);
    expect([...select(d, { ...f, author: `ghost:${NAME_B}` })]).toEqual([2]);
    expect([...select(d, { ...f, author: 'ghost' })]).toEqual([3]);
    // The Reviewer filter is as before: a name never reviews, the pooled entry does.
    expect([...select(d, { ...f, reviewer: `ghost:${NAME_A}` })]).toEqual([]);
    expect([...select(d, { ...f, reviewer: 'ghost' })]).toEqual([0, 2]);
  });
});

describe('the development branch', () => {
  // Bases sorted as the rollup sorts them; release-1.21 is a release branch
  // and wip-feature a feature branch, both "other".
  const meta = { ...META, bases: ['master', 'release-1.21', 'wip-feature'], window_start: at('2019-01-01T00:00:00Z') };
  const MASTER = 0;
  const RELEASE = 1;
  const FEATURE = 2;
  const d = dataset(
    [
      { number: 26000, created: at('2019-03-01T00:00:00Z'), closed: at('2019-03-10T00:00:00Z'), state: 1, base: MASTER },
      { number: 26100, created: at('2019-04-01T00:00:00Z'), closed: at('2019-04-10T00:00:00Z'), state: 1, base: RELEASE },
      { number: 27000, created: at('2019-05-01T00:00:00Z'), closed: at('2023-01-10T00:00:00Z'), state: 1, base: MASTER },
      { number: 50000, created: at('2023-03-01T00:00:00Z'), closed: at('2023-03-05T00:00:00Z'), state: 1, base: MASTER },
      { number: 50100, created: at('2023-04-01T00:00:00Z'), closed: at('2023-04-05T00:00:00Z'), state: 2, base: FEATURE },
    ],
    [],
    meta,
  );
  const of = (patch: Partial<Filters>) => [...select(d, { ...defaultFilters(d.meta), from: '2019-01-01', to: '2023-12-31', ...patch })];

  it('keeps a PR on master under the master target, and not under backports', () => {
    expect(of({ target: 'master' })).toEqual([0, 2, 3]);
    expect(of({ target: 'backports' })).toEqual([1, 4]);
    expect(of({ target: 'all' })).toEqual([0, 1, 2, 3, 4]);
  });

  it('keeps a release branch from the same year under backports, and not under master', () => {
    expect(of({ target: 'master', from: '2019-01-01', to: '2019-12-31' })).toEqual([0, 2]);
    expect(of({ target: 'backports', from: '2019-01-01', to: '2019-12-31' })).toEqual([1]);
    expect(of({ target: 'all', from: '2019-01-01', to: '2019-12-31' })).toEqual([0, 1, 2]);
  });
});

describe('openedInBucket', () => {
  const period = periodRange(every);
  const selected = select(data, every);
  const day = (d: string) => dayStart(d) as number;

  it('gives the selected rows opened in the window during a week', () => {
    // #66500 opened 2026-05-18 10:00 and #66510 2026-05-20 12:00.
    expect([...openedInBucket(data, selected, period, day('2026-05-18'))]).toEqual([3, 4]);
    expect([...openedInBucket(data, select(data, { ...every, size: 'le10' }), period, day('2026-05-18'))]).toEqual([4]);
  });

  it('agrees with the weekly count of PRs opened, bucket by bucket', () => {
    const opened = weekly(data, selected, period, 'opened');
    expect(opened.week.length).toBeGreaterThan(20);
    opened.week.forEach((week, i) => {
      const count = (opened.values['disclosed']?.[i] ?? 0) + (opened.values['not-disclosed']?.[i] ?? 0);
      expect(openedInBucket(data, selected, period, week).length, dayOf(week)).toBe(count);
    });
  });

  it('gives no rows for a day that does not start a bucket of the period', () => {
    expect([...openedInBucket(data, selected, period, day('2026-05-19'))]).toEqual([]);
    expect([...openedInBucket(data, selected, period, day('2027-01-04'))]).toEqual([]);
  });

  it('takes a month over a period beyond 53 weeks', () => {
    const long = dataset(
      [
        { created: at('2025-05-31T23:59:59Z') },
        { created: at('2025-06-01T00:00:00Z') },
        { created: at('2025-06-30T23:59:59Z'), in_window: 0 },
        { created: at('2025-07-01T00:00:00Z') },
      ],
      [],
    );
    const months = { start: at('2025-05-15T00:00:00Z'), end: at('2026-07-01T00:00:00Z') };
    expect([...openedInBucket(long, all(long), months, at('2025-06-01T00:00:00Z'))]).toEqual([1]);
    expect([...openedInBucket(long, all(long), months, at('2025-06-02T00:00:00Z'))]).toEqual([]);
  });
});

describe('openedIn', () => {
  it('keeps the rows opened in the window during the period', () => {
    const july = { start: Date.UTC(2026, 6, 1) / 1000, end: Date.UTC(2026, 7, 1) / 1000 };
    expect([...openedIn(data, select(data, every), july)]).toEqual([7, 8]);
  });

  it('leaves out the rows opened before the window', () => {
    const all = { start: 0, end: meta.fetched_through };
    expect([...openedIn(data, select(data, every), all)]).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });
});

describe('the Branch and Backport link filters', () => {
  // Bases sorted as the rollup sorts them, names with each character a branch
  // name holds beside letters.
  const bases = ['feature/ptl-ci-test', 'master', 'pacific-16.2.7_RC1', 'reef', 'squid'];
  const [FEATURE, MASTER, PACIFIC_RC, REEF, SQUID] = [0, 1, 2, 3, 4];
  const meta = { ...META, bases, window_start: at('2019-01-01T00:00:00Z') };
  const t = (day: string) => at(`${day}T00:00:00Z`);
  const d = dataset(
    [
      { number: 100, created: t('2019-03-01'), closed: t('2019-03-10'), state: 1, base: MASTER },
      { number: 101, created: t('2023-03-01'), closed: t('2023-03-05'), state: 1, base: MASTER, backport_link: 1 },
      { number: 102, created: t('2023-04-01'), closed: t('2023-04-05'), state: 1, base: REEF, backport_link: 1 },
      { number: 103, created: t('2023-05-01'), closed: t('2023-05-05'), state: 1, base: REEF },
      { number: 104, created: t('2024-05-01'), closed: t('2024-05-05'), state: 1, base: REEF, backport_link: 1 },
      { number: 105, created: t('2024-06-01'), closed: t('2024-06-05'), state: 2, base: SQUID, backport_link: 1 },
      { number: 106, created: t('2024-07-01'), closed: t('2024-07-05'), state: 1, base: FEATURE },
      { number: 107, created: t('2021-12-01'), closed: t('2021-12-05'), state: 1, base: PACIFIC_RC, backport_link: 1 },
      { number: 108, created: t('2024-08-01'), closed: t('2024-08-05'), state: 1, base: MASTER },
    ],
    [],
    meta,
  );
  const whole = { ...defaultFilters(d.meta), from: '2019-01-01', to: '2024-12-31' };
  const of = (patch: Partial<Filters>) => [...select(d, { ...whole, ...patch })];

  it.each([
    ['master: master', 'master', 'master', [0, 1, 8]],
    ['backports and other branches: reef', 'backports', 'reef', [2, 3, 4]],
    ['backports and other branches: a name with a slash', 'backports', 'feature/ptl-ci-test', [6]],
    ['backports and other branches: a name with dots and an underscore', 'backports', 'pacific-16.2.7_RC1', [7]],
    ['all: master', 'all', 'master', [0, 1, 8]],
    ['all: squid', 'all', 'squid', [5]],
  ] satisfies [string, Target, string, number[]][])('a branch under the target %s', (_name, target, base, expected) => {
    expect(of({ target, base })).toEqual(expected);
  });

  it('keeps every branch of the target with no branch chosen', () => {
    expect(of({ target: 'backports', base: null })).toEqual([2, 3, 4, 5, 6, 7]);
  });

  it('selects nothing for a branch meta does not name', () => {
    expect(of({ target: 'all', base: 'no-such-branch' })).toEqual([]);
  });

  it.each([
    ['any', null, [0, 1, 2, 3, 4, 5, 6, 7, 8]],
    ['links its original', 'linked', [1, 2, 4, 5, 7]],
    ['no link', 'unlinked', [0, 3, 6, 8]],
  ] satisfies [string, BackportLink | null, number[]][])('the backport link: %s', (_name, backportLink, expected) => {
    expect(of({ target: 'all', backportLink })).toEqual(expected);
  });

  it('combines the branch, the backport link, the target and the period', () => {
    expect(of({ target: 'backports', base: 'reef', backportLink: 'unlinked' })).toEqual([3]);
    expect(of({ target: 'backports', base: 'reef', backportLink: 'linked' })).toEqual([2, 4]);
    expect(of({ target: 'backports', base: 'reef', backportLink: 'linked', from: '2024-01-01' })).toEqual([4]);
    expect(of({ target: 'master', backportLink: 'linked' })).toEqual([1]);
  });

  describe('branchChoices', () => {
    const choices = (patch: Partial<Filters>) => branchChoices(d, { ...whole, ...patch });

    it('lists the branch of the master target with its count', () => {
      expect(choices({ target: 'master' })).toEqual([{ base: 'master', count: 3 }]);
    });

    it('lists every other branch under backports and other branches, ties by name', () => {
      expect(choices({ target: 'backports' })).toEqual([
        { base: 'reef', count: 3 },
        { base: 'feature/ptl-ci-test', count: 1 },
        { base: 'pacific-16.2.7_RC1', count: 1 },
        { base: 'squid', count: 1 },
      ]);
    });

    it('lists every branch under all', () => {
      expect(choices({ target: 'all' }).map((c) => c.base)).toEqual([
        'master',
        'reef',
        'feature/ptl-ci-test',
        'pacific-16.2.7_RC1',
        'squid',
      ]);
    });

    it('counts the PRs active in the period, and keeps a branch with none in it, last', () => {
      expect(choices({ target: 'backports', from: '2024-01-01' })).toEqual([
        { base: 'feature/ptl-ci-test', count: 1 },
        { base: 'reef', count: 1 },
        { base: 'squid', count: 1 },
        { base: 'pacific-16.2.7_RC1', count: 0 },
      ]);
    });

    it('counts as if no other filter were chosen', () => {
      expect(choices({ target: 'backports', base: 'reef', backportLink: 'unlinked', size: 'gt1000' })).toEqual(
        choices({ target: 'backports' }),
      );
    });
  });
});
