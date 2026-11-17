import { describe, expect, it } from 'vitest';
import { NAMED_A, NAMED_B, NAME_A, NAME_B, POOLED, deletedMeta } from './__fixtures__/deleted';
import { parseMeta } from './data';
import { POOLED_NOTE } from './handles';
import { DAY } from './filters';
import {
  AUTHOR_TABLE,
  REVIEWER_TABLE,
  type PeopleColumn,
  medianCell,
  pooledAuthorLine,
  pooledReviewerLine,
  pooledRow,
  shownPeople,
  sortPeople,
} from './people';
import { openedIn } from './select';
import { AUTHOR_COLUMNS, REVIEWER_COLUMNS } from './sort';
import { type AuthorRow, type ReviewerRow, authorRows, reviewerRows } from './stats/people';
import { META, all, at, dataset } from './stats/testing';

// People 0 fixture-author-e, 1 fixture-author-f, 2 fixture-author-a, 10 mergify (a bot).
const authors: AuthorRow[] = [
  {
    person: 0,
    opened: 3,
    merged: 1,
    closed: 1,
    open: 1,
    commits: 9,
    additions: 100,
    deletions: 10,
    lines: 110,
    response: { state: 'known', days: 2, prs: 5 },
    merge: { state: 'tooFew', prs: 3 },
    disclosed: 0,
  },
  {
    person: 1,
    opened: 7,
    merged: 5,
    closed: 0,
    open: 2,
    commits: 7,
    additions: 5,
    deletions: 500,
    lines: 505,
    response: { state: 'notYetKnown', prs: 6 },
    merge: { state: 'known', days: 4, prs: 7 },
    disclosed: 7,
  },
  {
    person: 2,
    opened: 5,
    merged: 2,
    closed: 2,
    open: 1,
    commits: 20,
    additions: 50,
    deletions: 50,
    lines: 100,
    response: { state: 'known', days: 1, prs: 5 },
    merge: { state: 'notReached', share: 0.4, prs: 5 },
    disclosed: 1,
  },
  {
    person: 10,
    opened: 1,
    merged: 1,
    closed: 0,
    open: 0,
    commits: 1,
    additions: 1,
    deletions: 1,
    lines: 2,
    response: { state: 'tooFew', prs: 1 },
    merge: { state: 'tooFew', prs: 1 },
    disclosed: 0,
  },
];

const reviewers: ReviewerRow[] = [
  { person: 0, prs: 2, approved: 0, changes: 1, commented: 3, comments: 4, firstResponses: 1, response: { state: 'tooFew', prs: 2 } },
  { person: 1, prs: 9, approved: 6, changes: 0, commented: 1, comments: 2, firstResponses: 5, response: { state: 'known', days: 3, prs: 9 } },
  { person: 2, prs: 5, approved: 2, changes: 2, commented: 0, comments: 9, firstResponses: 0, response: { state: 'known', days: 0.5, prs: 5 } },
];

const login = (r: { person: number }) => META.people[r.person];

/** Every value before the first null is in order, and every value from it on is null. */
function inOrder<R>(sorted: R[], column: PeopleColumn<string, R>, descending: boolean): void {
  const keys = sorted.map((r) => column.key(r, META));
  const firstNull = keys.indexOf(null);
  const known = firstNull === -1 ? keys : keys.slice(0, firstNull);
  if (firstNull !== -1) expect(keys.slice(firstNull).every((k) => k === null), column.id).toBe(true);
  const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
  for (let i = 1; i < known.length; i++) {
    const a = known[i - 1] as number | string;
    const b = known[i] as number | string;
    const c = typeof a === 'string' ? collator.compare(a, String(b)) : a - (b as number);
    expect(descending ? c >= 0 : c <= 0, `${column.id} ${descending ? 'descending' : 'ascending'} at ${i}`).toBe(true);
  }
}

describe('the Authors table', () => {
  it('has a column for each of its sorts, in order', () => {
    expect(AUTHOR_TABLE.map((c) => c.id)).toEqual([...AUTHOR_COLUMNS]);
  });

  it.each(AUTHOR_COLUMNS.flatMap((c) => [[c, false] as const, [c, true] as const]))(
    'sorts by %s (descending: %s), a missing value last',
    (id, descending) => {
      const column = AUTHOR_TABLE.find((c) => c.id === id) as PeopleColumn<string, AuthorRow>;
      const sorted = sortPeople(authors, AUTHOR_TABLE, { column: id, descending }, META);
      expect(sorted).toHaveLength(authors.length);
      inOrder(sorted, column, descending);
    },
  );

  it('orders by lines changed, by the handle, and puts a median without a number last both ways', () => {
    const by = (column: (typeof AUTHOR_COLUMNS)[number], descending: boolean) =>
      sortPeople(authors, AUTHOR_TABLE, { column, descending }, META).map(login);
    expect(by('lines', true)).toEqual(['fixture-author-f', 'fixture-author-e', 'fixture-author-a', 'mergify']);
    expect(by('author', false)).toEqual(['fixture-author-a', 'fixture-author-e', 'fixture-author-f', 'mergify']);
    expect(by('response', false)).toEqual(['fixture-author-a', 'fixture-author-e', 'fixture-author-f', 'mergify']);
    expect(by('response', true)).toEqual(['fixture-author-e', 'fixture-author-a', 'fixture-author-f', 'mergify']);
    expect(by('merge', true)).toEqual(['fixture-author-f', 'fixture-author-a', 'fixture-author-e', 'mergify']);
  });

  it('breaks a tie by the handle', () => {
    // e and a both have one PR still open.
    expect(sortPeople(authors, AUTHOR_TABLE, { column: 'open', descending: true }, META).map(login)).toEqual([
      'fixture-author-f',
      'fixture-author-a',
      'fixture-author-e',
      'mergify',
    ]);
  });

  it('writes the share disclosing with its count', () => {
    const disclosed = AUTHOR_TABLE.find((c) => c.id === 'disclosed') as PeopleColumn<string, AuthorRow>;
    expect(disclosed.cell(authors[2] as AuthorRow, META)).toEqual({ text: '20%', detail: '1 of 5 PRs' });
  });
});

describe('the Reviewers table', () => {
  it('has a column for each of its sorts, in order', () => {
    expect(REVIEWER_TABLE.map((c) => c.id)).toEqual([...REVIEWER_COLUMNS]);
  });

  it.each(REVIEWER_COLUMNS.flatMap((c) => [[c, false] as const, [c, true] as const]))(
    'sorts by %s (descending: %s), a missing value last',
    (id, descending) => {
      const column = REVIEWER_TABLE.find((c) => c.id === id) as PeopleColumn<string, ReviewerRow>;
      inOrder(sortPeople(reviewers, REVIEWER_TABLE, { column: id, descending }, META), column, descending);
    },
  );

  it('orders by first responses and by the median', () => {
    const by = (column: (typeof REVIEWER_COLUMNS)[number], descending: boolean) =>
      sortPeople(reviewers, REVIEWER_TABLE, { column, descending }, META).map(login);
    expect(by('first', true)).toEqual(['fixture-author-f', 'fixture-author-e', 'fixture-author-a']);
    expect(by('response', false)).toEqual(['fixture-author-a', 'fixture-author-f', 'fixture-author-e']);
    expect(by('response', true)).toEqual(['fixture-author-f', 'fixture-author-a', 'fixture-author-e']);
  });
});

describe('medianCell', () => {
  it('writes a known median as a duration, with its count', () => {
    expect(medianCell({ state: 'known', days: 3, prs: 12 }, 'merged')).toEqual({ text: '3 days', detail: 'median over 12 PRs' });
  });

  it('says "too few" below five PRs, never a number', () => {
    expect(medianCell({ state: 'tooFew', prs: 4 }, 'merged')).toEqual({ text: 'too few', detail: '4 PRs, fewer than 5' });
    expect(medianCell({ state: 'tooFew', prs: 1 }, 'merged').detail).toBe('1 PR, fewer than 5');
  });

  it('says in words a median not yet known and one not reached', () => {
    expect(medianCell({ state: 'notYetKnown', prs: 6 }, 'merged')).toEqual({
      text: 'not yet known',
      detail: 'median over 6 PRs, too many still waiting',
    });
    expect(medianCell({ state: 'notReached', share: 0.4, prs: 5 }, 'merged')).toEqual({
      text: 'not reached',
      detail: 'median over 5 PRs, 40% merged',
    });
  });
});

describe('shownPeople', () => {
  it('leaves out the bot accounts unless asked for them', () => {
    expect(shownPeople(authors, META, false).map(login)).not.toContain('mergify');
    expect(shownPeople(authors, META, true).map(login)).toContain('mergify');
  });
});

describe('the People tables with deleted accounts', () => {
  // Ada opened two PRs and Åsa one, each a deleted account known by the name
  // on its commits; the pooled entry opened one, whose commits gave no name,
  // and made every comment and review by a deleted account; person 0 opened
  // one more. Comments and reviews by deleted accounts are the pooled entry's
  // whoever made them, as the rollup writes them.
  const meta = parseMeta(deletedMeta());
  const t = at('2026-06-01T00:00:00Z');
  const period = { start: at('2026-05-15T00:00:00Z'), end: at('2026-11-16T00:00:00Z') };
  const d = dataset(
    [
      { created: t, author: NAMED_A, commits: 2, additions: 10, state: 1, closed: t + DAY },
      { created: t + 1, author: NAMED_A, commits: 1, additions: 5 },
      { created: t + 2, author: NAMED_B, commits: 4, additions: 40 },
      { created: t + 3, author: POOLED, commits: 1, additions: 7 },
      { created: t + 4, author: 0, commits: 1, additions: 1 },
    ],
    [
      { pr: 0, at: t + DAY / 2, kind: 'comment_other', actor: POOLED },
      { pr: 2, at: t + DAY, kind: 'review_approved', actor: POOLED },
      { pr: 3, at: t + DAY, kind: 'comment_other', actor: 1 },
      { pr: 4, at: t + DAY, kind: 'review_changes', actor: POOLED },
    ],
    meta,
  );
  const authorTable = authorRows(d, openedIn(d, all(d), period));
  const reviewerTable = reviewerRows(d, all(d), period);
  const names = (rows: readonly AuthorRow[]) => rows.map((r) => (AUTHOR_TABLE[0] as PeopleColumn<string, AuthorRow>).cell(r, meta).text);

  it('gives each named deleted author a row of their own, written "(deleted)" and the name, and the pooled entry one', () => {
    expect(authorTable.map((r) => [r.person, r.opened, r.commits, r.additions])).toEqual([
      [NAMED_A, 2, 3, 15],
      [NAMED_B, 1, 4, 40],
      [POOLED, 1, 1, 7],
      [0, 1, 1, 1],
    ]);
    expect(names(authorTable)).toEqual([`(deleted) ${NAME_A}`, `(deleted) ${NAME_B}`, '(deleted, unknown)', 'fixture-author-e']);
  });

  it('ranks a named deleted author by the same measures as anyone, and orders ties by what the page writes', () => {
    const byOpened = sortPeople(authorTable, AUTHOR_TABLE, { column: 'opened', descending: true }, meta);
    // "(deleted," sorts before "(deleted)", and Å with A, as a reader would.
    expect(names(byOpened)).toEqual([`(deleted) ${NAME_A}`, '(deleted, unknown)', `(deleted) ${NAME_B}`, 'fixture-author-e']);
    const byAuthor = sortPeople(authorTable, AUTHOR_TABLE, { column: 'author', descending: true }, meta);
    expect(names(byAuthor)).toEqual(['fixture-author-e', `(deleted) ${NAME_B}`, `(deleted) ${NAME_A}`, '(deleted, unknown)']);
  });

  it('ranks the named deleted authors whether or not bot accounts are shown, and never the pooled entry', () => {
    for (const bots of [false, true]) {
      expect(shownPeople(authorTable, meta, bots).map((r) => r.person)).toEqual([NAMED_A, NAMED_B, 0]);
      expect(shownPeople(reviewerTable, meta, bots).map((r) => r.person)).toEqual([1]);
    }
  });

  it('gives the pooled entry’s figures for the Authors table in one line, saying it is not ranked or counted and what it pools', () => {
    const row = pooledRow(authorTable, meta);
    expect(row?.person).toBe(POOLED);
    expect(pooledAuthorLine(row as AuthorRow, meta)).toBe(
      '(deleted, unknown), not ranked or counted among the authors above, opened 1 PR: 0 merged, 0 closed unmerged, ' +
        '1 still open; 1 commit; 7 lines changed, 7 added and 0 deleted; median to first response too few (1 PR, fewer than 5), ' +
        'to merge too few (1 PR, fewer than 5); 0% disclosing AI use (0 of 1 PR). ' +
        `It pools ${POOLED_NOTE}.`,
    );
  });

  it('gives the pooled entry’s figures for the Reviewers table in one line, saying it is not ranked or counted and what it pools', () => {
    const row = pooledRow(reviewerTable, meta);
    expect(row?.person).toBe(POOLED);
    expect(pooledReviewerLine(row as ReviewerRow, meta)).toBe(
      '(deleted, unknown), not ranked or counted among the reviewers above, reviewed or commented on 3 PRs: ' +
        '1 review approving, 1 requesting changes, 0 commenting; 1 comment; 0 first responses; ' +
        'median to its first response too few (3 PRs, fewer than 5). ' +
        `It pools ${POOLED_NOTE}.`,
    );
  });

  it('has no pooled line where the pooled entry did nothing in the selection', () => {
    // Every PR but the pooled entry's own; on that one only person 1 commented.
    expect(pooledRow(authorRows(d, openedIn(d, Uint32Array.from([0, 1, 2, 4]), period)), meta)).toBeNull();
    expect(pooledRow(reviewerRows(d, Uint32Array.from([3]), period), meta)).toBeNull();
  });

  it('gives a named deleted author no row among the reviewers: their comments and reviews are the pooled entry’s', () => {
    expect(reviewerTable.map((r) => r.person).sort((a, b) => a - b)).toEqual([1, POOLED]);
    expect(reviewerTable.find((r) => r.person === POOLED)).toMatchObject({ prs: 3, comments: 1, approved: 1, changes: 1 });
    const cells = reviewerTable.map((r) => (REVIEWER_TABLE[0] as PeopleColumn<string, ReviewerRow>).cell(r, meta).text);
    expect(cells).toContain('(deleted, unknown)');
    expect(cells.some((c) => c.includes(NAME_A) || c.includes(NAME_B))).toBe(false);
  });
});
