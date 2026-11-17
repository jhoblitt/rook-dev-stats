import { describe, expect, it } from 'vitest';
import table2026 from '../__fixtures__/data/table-2026.json';
import { NAMED_A, NAMED_B, POOLED, deletedMeta } from '../__fixtures__/deleted';
import { type TableYear, parseMeta, parseTable, parseYear } from '../data';
import prs2026 from '../__fixtures__/data/prs-2026.json';
import events2026 from '../__fixtures__/data/events-2026.json';
import { META, type Row, at, dataset, fixture } from '../stats/testing';
import {
  TOP_AUTHORS,
  baseRows,
  commentCounts,
  defaultRows,
  disclosureGroups,
  coverage,
  disclosureForms,
  eventRefs,
  familyCounts,
  firstCommitUnknown,
  kindSources,
  kindUnknown,
  neverReady,
  noCommits,
  peopleFigures,
  standingUnknown,
} from './figures';

// The fixture's rows: 0 #64010 and 1 #65220 opened in 2025, before the
// window; 2 #66100 opened in 2026 before the window; 3–11 opened in it.
// Rows 1 (release-1.17), 7 (release-1.18) and 11 (release-1.19) are not on master. Its window
// is 2026-05-15 to 2026-11-15, the day fetched_through falls on, and
// the specs take that as the period too, unless they say otherwise.
const data = fixture();
const DAYS = { from: '2026-05-15', to: '2026-11-15' };
const rows = baseRows(data, DAYS);

function fixtureTables(): Map<number, TableYear> {
  const y2026 = parseYear(2026, prs2026, events2026, META);
  return new Map([[2026, parseTable(table2026, 'table-2026.json', y2026, META)]]);
}

const START = at('2026-05-15T00:00:00Z');
const END = at('2026-11-16T00:00:00Z');
const PERIOD = { start: START, end: END };
/** A window two years longer than the period, as the full history's is longer than the last six months. */
const EARLY = { window_start: at('2024-05-15T00:00:00Z') };

describe('baseRows', () => {
  it('keeps every PR open at some point in the period, on every branch', () => {
    expect([...rows]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('leaves out a PR finished before the period and one opened after it ends', () => {
    const d = dataset([
      { created: at('2026-01-01T00:00:00Z'), closed: at('2026-05-14T23:59:59Z'), state: 1 },
      { created: at('2026-01-01T00:00:00Z'), closed: START, state: 2 },
      { created: at('2026-11-16T00:00:00Z') },
    ]);
    expect([...baseRows(d, DAYS)]).toEqual([1]);
  });

  it('selects over the period it is given, not the window', () => {
    const d = dataset(
      [
        { created: at('2025-01-01T00:00:00Z'), closed: at('2025-03-01T00:00:00Z'), state: 1 },
        { created: at('2025-01-01T00:00:00Z') },
        { created: at('2026-06-01T00:00:00Z') },
      ],
      [],
      EARLY,
    );
    expect([...baseRows(d, DAYS)]).toEqual([1, 2]);
    expect([...baseRows(d, { from: '2024-05-15', to: '2026-11-15' })]).toEqual([0, 1, 2]);
  });
});

describe('coverage', () => {
  it('counts those open in the period and those opened in it', () => {
    expect(coverage(data, rows, PERIOD)).toEqual({ active: 12, openedInPeriod: 9 });
  });

  it('counts a PR opened in the window before the period, still open, as opened before the period, not in it', () => {
    const d = dataset(
      [
        { created: at('2025-01-01T00:00:00Z'), in_window: 1 },
        { created: at('2026-05-14T23:59:59Z'), in_window: 1 },
        { created: START },
        { created: at('2026-11-15T23:59:59Z') },
      ],
      [],
      EARLY,
    );
    expect(coverage(d, baseRows(d, DAYS), PERIOD)).toEqual({ active: 4, openedInPeriod: 2 });
  });
});

describe('neverReady', () => {
  it('counts the drafts never made ready, by target', () => {
    expect(neverReady(data, rows)).toEqual({ main: 1, other: 0 });
  });
});

describe('the split by target', () => {
  const OLD = { bases: ['master', 'release-1.21'], window_start: at('2019-01-01T00:00:00Z') };
  const OLD_DAYS = { from: '2019-01-01', to: '2026-11-15' };
  const d = dataset(
    [
      { created: at('2019-03-01T00:00:00Z'), commits: 0, base: 0, state: 1, closed: at('2019-03-02T00:00:00Z') },
      { created: at('2019-03-01T00:00:00Z'), commits: 0, base: 1, state: 1, closed: at('2019-03-02T00:00:00Z') },
      { created: at('2023-03-01T00:00:00Z'), commits: 0, base: 0 },
    ],
    [],
    OLD,
  );

  it('counts a PR on master with the development branch, and a release branch with the other branches', () => {
    expect(noCommits(d, baseRows(d, OLD_DAYS))).toEqual({ main: 2, other: 1 });
  });

  it("keeps a PR on master under the report's default filters over a period that reaches it", () => {
    expect([...defaultRows(d, OLD_DAYS)]).toEqual([0, 2]);
  });
});

describe('firstCommitUnknown', () => {
  it('counts the PRs with commits whose first commit is unknown', () => {
    expect(firstCommitUnknown(data, rows)).toEqual({ main: 1, other: 0 });
  });

  it('does not count a PR with no commits', () => {
    const d = dataset([{ created: START, commits: 0 }, { created: START, commits: 2 }]);
    expect(firstCommitUnknown(d, baseRows(d, DAYS))).toEqual({ main: 1, other: 0 });
  });
});

describe('noCommits', () => {
  it('counts the PRs with no commits, by target', () => {
    expect(noCommits(data, rows)).toEqual({ main: 0, other: 0 });
    const d = dataset([{ created: START, commits: 0 }, { created: START, commits: 0, base: 1 }, { created: START }]);
    expect(noCommits(d, baseRows(d, DAYS))).toEqual({ main: 1, other: 1 });
  });
});

describe('standingUnknown', () => {
  it('counts the PRs of unknown standing', () => {
    expect(standingUnknown(data, rows)).toBe(3);
  });

  it('leaves out a PR whose standing is known', () => {
    const d = dataset([
      { created: START, standing: -1 },
      { created: START, standing: 4 },
      { created: at('2026-01-01T00:00:00Z'), in_window: 0, standing: -1 },
    ]);
    expect(standingUnknown(d, baseRows(d, DAYS))).toBe(2);
  });
});

describe('kindUnknown', () => {
  it('counts the PRs of unknown kind, by target', () => {
    expect(kindUnknown(data, rows)).toEqual({ main: 0, other: 1 });
  });
});

describe('disclosureForms', () => {
  it('counts each form of disclosure, and none, by target', () => {
    expect(disclosureForms(data, rows)).toEqual({
      none: { main: 6, other: 2 },
      checklist: { main: 0, other: 1 },
      description: { main: 0, other: 0 },
      coauthor: { main: 1, other: 0 },
      trailer: { main: 2, other: 0 },
    });
  });
});

describe('familyCounts', () => {
  it('counts the PRs naming each tool family, in meta order', () => {
    expect(familyCounts(data, rows)).toEqual([
      { id: 'claude', name: 'Claude', count: { main: 2, other: 0 } },
      { id: 'copilot', name: 'GitHub Copilot', count: { main: 1, other: 0 } },
      { id: 'unspecified', name: 'unspecified', count: { main: 0, other: 1 } },
    ]);
  });
});

describe('commentCounts', () => {
  it('counts the comments made in the period and the bot commands among them', () => {
    // Two of 2025's comments are from before the period: a comment by
    // another person on #64010 and a bot account's on #65220.
    expect(commentCounts(data, rows, PERIOD)).toEqual({ comments: 11, commands: 3, commandsByAuthor: 2, botAccount: 1 });
  });

  it('counts no comment for a selection without events', () => {
    const d = dataset([{ created: START }]);
    expect(commentCounts(d, baseRows(d, DAYS), PERIOD)).toEqual({ comments: 0, commands: 0, commandsByAuthor: 0, botAccount: 0 });
  });
});

describe('kindSources', () => {
  it('counts the PRs each source of kind decided, and the unknown, by target', () => {
    expect(kindSources(data, fixtureTables(), rows)).toEqual({
      labels: { main: 7, other: 1 },
      issues: { main: 2, other: 0 },
      original: { main: 0, other: 1 },
      unknown: { main: 0, other: 1 },
    });
  });

  it('throws when a year it needs has no table', () => {
    const tables = fixtureTables();
    tables.delete(2026);
    expect(() => kindSources(data, tables, rows)).toThrow(/2026/);
  });
});

describe('eventRefs', () => {
  it('counts each kind of event in the period, and those with nothing to link to', () => {
    const byKind = Object.fromEntries(eventRefs(data, fixtureTables(), rows, PERIOD).map((r) => [r.kind, r]));
    expect(byKind['force_push']).toEqual({ kind: 'force_push', events: 7, missing: 0 });
    expect(byKind['reopened']).toEqual({ kind: 'reopened', events: 1, missing: 1 });
    expect(byKind['bot_account']).toEqual({ kind: 'bot_account', events: 1, missing: 1 });
    expect(byKind['merged']).toEqual({ kind: 'merged', events: 6, missing: 0 });
    expect(byKind['comment_other']).toEqual({ kind: 'comment_other', events: 5, missing: 0 });
  });

  it('lists the kinds in meta order and leaves out a kind with no event', () => {
    const kinds = eventRefs(data, fixtureTables(), rows, PERIOD).map((r) => r.kind);
    expect(kinds).toEqual([
      'comment_other',
      'comment_author',
      'command_author',
      'command_other',
      'bot_account',
      'review_approved',
      'review_changes',
      'review_commented',
      'bot_review',
      'ready',
      'force_push',
      'closed',
      'reopened',
      'merged',
    ]);
  });

  it('counts a force-push without a commit as missing', () => {
    const d = dataset(
      [{ created: START }],
      [
        { pr: 0, at: START + 10, kind: 'force_push' },
        { pr: 0, at: START + 20, kind: 'force_push' },
        { pr: 0, at: START - 10, kind: 'force_push' },
      ],
    );
    const table: TableYear = {
      titles: ['t'],
      authors: ['a'],
      commits: [[]],
      refs: ['', '', '0123456789012345678901234567890123456789'],
      issues: [[]],
      backport_of: [0],
      kind_source: [''],
    };
    // The events sort by time: the one before the period holds the empty
    // first ref and is not counted.
    expect(eventRefs(d, new Map([[2026, table]]), baseRows(d, DAYS), PERIOD)).toEqual([
      { kind: 'force_push', events: 2, missing: 1 },
    ]);
  });
});

describe('defaultRows', () => {
  it("keeps what the report's default filters select: PRs on master open at some point in the period", () => {
    expect([...defaultRows(data, DAYS)]).toEqual([0, 2, 3, 4, 5, 6, 8, 9, 10]);
  });
});

describe('peopleFigures', () => {
  // Under the default filters the People tables count the PRs opened in the period
  // on master (rows 3, 4, 5, 6, 8, 9, 10) for the Authors table, and every
  // event in the period on rows 0, 2–6 and 8–10 for the Reviewers table.
  it('counts the authors, the bot accounts hidden among them and the reviewers, as the People tables do', () => {
    const f = peopleFigures(data, defaultRows(data, DAYS), PERIOD);
    // Authors d (rows 3 and 10), e, g, a and i; the bot dependabot (row 5) apart.
    expect(f.authors).toBe(5);
    expect(f.botAuthors).toBe(1);
    // f (rows 0, 3, 10), a (2, 6), e (2, 10), i (5, 8) and the reviewer k (9).
    expect(f.reviewers).toBe(5);
    // Every author has fewer than five PRs behind a median to merge.
    expect(f.authorsTooFew).toBe(5);
  });

  it('finds the largest pull request and its share of all lines changed', () => {
    const f = peopleFigures(data, defaultRows(data, DAYS), PERIOD);
    // #67000 is 1,500 + 700 lines of the 30 + 4 + 70 + 250 + 2,200 + 90 = 2,644, the
    // bot dependabot's #66600 left out.
    expect(f.largestLines).toBe(2200);
    expect(f.largestShare).toBeCloseTo(2200 / 2644, 10);
  });

  it("leaves bot accounts' pull requests out of the largest pull request and its share, as the Authors table does by default", () => {
    const d = dataset(
      [
        { created: at('2026-06-01T00:00:00Z'), author: 0, additions: 60, deletions: 40 },
        { created: at('2026-06-01T00:00:00Z'), author: 1, additions: 1000 },
        { created: at('2026-06-01T00:00:00Z'), author: 2, additions: 300 },
      ],
      [],
      { people_bots: [1] },
    );
    const f = peopleFigures(d, defaultRows(d, DAYS), PERIOD);
    expect(f.largestLines).toBe(300);
    expect(f.largestShare).toBe(300 / 400);
  });

  it('hides a bot account among the authors and counts it apart', () => {
    const f = peopleFigures(data, baseRows(data, DAYS), PERIOD);
    // On every branch h (row 7) joins the authors, and mergify (row 11) the bots.
    expect(f.authors).toBe(6);
    expect(f.botAuthors).toBe(2);
  });

  it('gives no largest pull request when no PR was opened in the period', () => {
    const d = dataset([{ created: at('2026-01-01T00:00:00Z'), in_window: 0, author: 0 }]);
    const f = peopleFigures(d, defaultRows(d, DAYS), PERIOD);
    expect(f.authors).toBe(0);
    expect(f.largestLines).toBe(0);
    expect(f.largestShare).toBeNull();
  });

  describe('with deleted accounts', () => {
    // On master in the period: Ada opened two, Åsa one, the pooled entry two
    // and person 0 one; Ada's third is on a release branch, and the pooled
    // entry's third was opened before the period. The pooled entry commented
    // on Ada's first.
    const t = at('2026-06-01T00:00:00Z');
    const rowsWith = (author: number, n: number, extra: Partial<Row> = {}) =>
      Array.from({ length: n }, (): Row => ({ created: t, author, ...extra }));
    const prs = [
      ...rowsWith(NAMED_A, 2),
      ...rowsWith(NAMED_B, 1),
      ...rowsWith(POOLED, 2),
      ...rowsWith(0, 1),
      ...rowsWith(NAMED_A, 1, { base: 1 }),
      ...rowsWith(POOLED, 1, { created: at('2026-05-01T00:00:00Z') }),
    ];
    const events = [{ pr: 0, at: t + 3600, kind: 'comment_other', actor: POOLED }];

    it('counts a named deleted author as one author, the pooled entry as no author or reviewer, and the PRs credited to each', () => {
      const d = dataset(prs, events, parseMeta(deletedMeta()));
      const f = peopleFigures(d, defaultRows(d, DAYS), PERIOD);
      // Ada, Åsa and person 0; only the pooled entry reviewed, and the tables rank it in no row.
      expect(f.authors).toBe(3);
      expect(f.reviewers).toBe(0);
      expect(f.authorsTooFew).toBe(3);
      expect(f.deleted).toEqual({ namedPrs: 3, names: 2, pooledPrs: 2 });
    });

    it('counts every deleted account’s PRs as the pooled entry’s, and no name, without people_deleted', () => {
      const pooledOnly = prs.map((r) => (r.author === NAMED_A || r.author === NAMED_B ? { ...r, author: POOLED } : r));
      const d = dataset(pooledOnly, events, parseMeta(deletedMeta(false)));
      const f = peopleFigures(d, defaultRows(d, DAYS), PERIOD);
      // Person 0 alone: the pooled entry is not counted.
      expect(f.authors).toBe(1);
      expect(f.deleted).toEqual({ namedPrs: 0, names: 0, pooledPrs: 5 });
    });

    it('counts none on data with no deleted account', () => {
      expect(peopleFigures(data, defaultRows(data, DAYS), PERIOD).deleted).toEqual({ namedPrs: 0, names: 0, pooledPrs: 0 });
    });
  });
});

describe('disclosureGroups', () => {
  const g = disclosureGroups(data, defaultRows(data, DAYS), PERIOD);

  it('splits what the default filters select into the PRs that do not disclose and those that do', () => {
    expect(g.notDisclosed.prs).toBe(6);
    expect(g.disclosed.prs).toBe(3);
  });

  it('gives the share of each group opened in the period', () => {
    // Rows 0 and 2 were opened before it.
    expect(g.notDisclosed.openedInPeriod).toBeCloseTo(4 / 6, 10);
    expect(g.disclosed.openedInPeriod).toBe(1);
  });

  it('counts a PR opened in the window before the period as opened before the period', () => {
    const d = dataset(
      [{ created: at('2025-01-01T00:00:00Z'), in_window: 1 }, { created: at('2026-06-01T00:00:00Z') }],
      [],
      EARLY,
    );
    expect(disclosureGroups(d, defaultRows(d, DAYS), PERIOD).notDisclosed.openedInPeriod).toBe(1 / 2);
  });

  it('gives the median lines changed, a nearest-rank median', () => {
    // 4, 70, 150, 250, 600, 1,050 and 30, 90, 2,200.
    expect(g.notDisclosed.medianLines).toBe(150);
    expect(g.disclosed.medianLines).toBe(90);
  });

  it('gives the median days since opening at the last fetch', () => {
    // #66600, opened 2026-06-02T07:00Z, and #67000, opened 2026-08-06T12:00Z.
    expect(g.notDisclosed.medianAgeDays).toBeCloseTo((1794722400 - 1780383600) / 86400, 10);
    expect(g.disclosed.medianAgeDays).toBeCloseTo((1794722400 - 1785931200) / 86400, 10);
  });

  it(`gives the share of each group opened by its ${TOP_AUTHORS} most active authors`, () => {
    // Not disclosed: a opened two, c, e, dependabot and g one each; disclosed: d two, i one.
    expect(g.notDisclosed.topAuthors).toBeCloseTo(4 / 6, 10);
    expect(g.disclosed.topAuthors).toBe(1);
  });

  it('gives the mix of kinds in each group', () => {
    expect(g.notDisclosed.kinds).toEqual({ bugfix: 1 / 6, feature: 2 / 6, cleanup: 1 / 6, docs: 1 / 6, other: 1 / 6, unknown: 0 });
    expect(g.disclosed.kinds).toEqual({ bugfix: 1 / 3, feature: 1 / 3, cleanup: 0, docs: 0, other: 1 / 3, unknown: 0 });
  });

  it('gives an empty group nothing to divide', () => {
    const d = dataset([{ created: at('2026-06-01T00:00:00Z'), author: 0 }]);
    const e = disclosureGroups(d, defaultRows(d, DAYS), PERIOD);
    expect(e.disclosed).toEqual({ prs: 0, openedInPeriod: null, medianLines: null, medianAgeDays: null, topAuthors: null, kinds: null });
    expect(e.notDisclosed.prs).toBe(1);
  });
});
