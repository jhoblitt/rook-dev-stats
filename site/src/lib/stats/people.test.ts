import { describe, expect, it } from 'vitest';
import { DAY, periodRange } from '../filters';
import { openedIn, select } from '../select';
import { defaultFilters } from '../state';
import { MIN_PRS, authorRows, reviewerRows } from './people';
import { META, all, at, dataset, fixture } from './testing';

const data = fixture();
const filters = defaultFilters(META);
const period = periodRange(filters);
const rows = select(data, filters);
const opened = openedIn(data, rows, period);
const person = (login: string) => META.people.indexOf(login);

// The default selection: master, the whole window. Of its rows, those opened in
// the period are 3 #66500, 4 #66510, 5 #66600, 6 #66700, 8 #66900, 9 #67000
// and 10 #67100.
describe('authorRows over the fixture', () => {
  const authors = authorRows(data, opened);

  it('has one row per author of the PRs opened in the period', () => {
    expect(authors.map((a) => META.people[a.person])).toEqual([
      'fixture-author-d',
      'fixture-author-e',
      'fixture-author-f',
      'fixture-author-g',
      'fixture-author-a',
      'fixture-author-i',
    ]);
    expect(authors.reduce((n, a) => n + a.opened, 0)).toBe(opened.length);
  });

  it("adds up an author's PRs: fixture-author-d opened #66500 and #67100", () => {
    // Both merged; 1 and 3 commits; 25+5 and 70+20 lines; both disclose by a trailer.
    expect(authors.find((a) => a.person === person('fixture-author-d'))).toEqual({
      person: person('fixture-author-d'),
      opened: 2,
      merged: 2,
      closed: 0,
      open: 0,
      commits: 4,
      additions: 95,
      deletions: 25,
      lines: 120,
      response: { state: 'tooFew', prs: 2 },
      merge: { state: 'tooFew', prs: 2 },
      disclosed: 2,
    });
  });

  it('counts a draft never ready out of the response median but into the merge median', () => {
    // fixture-author-g opened #66700, a draft never made ready, still open.
    expect(authors.find((a) => a.person === person('fixture-author-g'))).toMatchObject({
      opened: 1,
      open: 1,
      commits: 2,
      lines: 70,
      response: { state: 'tooFew', prs: 0 },
      merge: { state: 'tooFew', prs: 1 },
      disclosed: 0,
    });
  });
});

describe('authorRows medians', () => {
  const t = at('2026-06-01T00:00:00Z');
  const merged = (k: number) => ({
    created: t,
    state: 1,
    closed: t + k * DAY,
    first_response: t + k * 3600,
  });

  it('reads the medians from the outcome curves over five PRs or more', () => {
    const d = dataset([1, 2, 3, 4, 5].map(merged));
    const [a] = authorRows(d, all(d));
    expect(a?.merge).toEqual({ state: 'known', days: 3, prs: 5 });
    expect(a?.response).toEqual({ state: 'known', days: 3 / 24, prs: 5 });
  });

  it(`says "too few" below ${MIN_PRS} PRs`, () => {
    const d = dataset([1, 2, 3, 4].map(merged));
    const [a] = authorRows(d, all(d));
    expect(a?.merge).toEqual({ state: 'tooFew', prs: 4 });
    expect(a?.response).toEqual({ state: 'tooFew', prs: 4 });
  });

  it('says a median is not yet known while enough PRs are still open', () => {
    const now = META.fetched_through;
    const d = dataset([1, 2, 3, 4, 5].map((k) => ({ created: now - k * DAY })));
    const [a] = authorRows(d, all(d));
    expect(a?.merge).toEqual({ state: 'notYetKnown', prs: 5 });
  });

  it('says a median is not reached when too few PRs merged and none is open', () => {
    const d = dataset([1, 2, 3, 4, 5].map((k) => ({ created: t, state: k === 1 ? 1 : 2, closed: t + k * DAY })));
    const [a] = authorRows(d, all(d));
    expect(a?.merge).toEqual({ state: 'notReached', share: 0.2, prs: 5 });
  });

  it('gives each author their own PRs', () => {
    const d = dataset([
      { created: t, author: 1, additions: 3 },
      { created: t, author: 2, additions: 5 },
      { created: t, author: 1, additions: 7 },
    ]);
    expect(authorRows(d, all(d)).map((a) => [a.person, a.opened, a.additions])).toEqual([
      [1, 2, 10],
      [2, 1, 5],
    ]);
  });
});

// The default selection's rows active in the period: 0 #64010, 2 #66100,
// 3 #66500, 4 #66510, 5 #66600, 6 #66700, 8 #66900, 9 #67000, 10 #67100.
describe('reviewerRows over the fixture', () => {
  const reviewers = reviewerRows(data, rows, period);
  const of = (login: string) => reviewers.find((r) => r.person === person(login));

  it('has one row per person who reviewed or commented on a selected PR in the period', () => {
    expect(reviewers.map((r) => META.people[r.person]).sort()).toEqual([
      'fixture-author-a',
      'fixture-author-e',
      'fixture-author-f',
      'fixture-author-i',
      'fixture-reviewer-k',
    ]);
  });

  it("adds up a reviewer's work: fixture-author-f", () => {
    // On #64010 f requested changes in 2025, before the period, and approved
    // on 2026-06-08; on #66500 f commented 23 hours after it was ready, the
    // first response, and approved; on #67100 f approved 8 days after ready,
    // after another person's comment.
    expect(of('fixture-author-f')).toEqual({
      person: person('fixture-author-f'),
      prs: 3,
      approved: 3,
      changes: 0,
      commented: 0,
      comments: 1,
      firstResponses: 1,
      // #64010's first comment by f came before the period, so only two count.
      response: { state: 'tooFew', prs: 2 },
    });
  });

  it("credits the first response to the person who made it, before the PR was ready too: fixture-author-e", () => {
    // e commented on #67100 before it was ready, the first response there;
    // e's review on #66100 came after another person's comment. e's
    // comment on #64010 was in 2025, before the period.
    expect(of('fixture-author-e')).toEqual({
      person: person('fixture-author-e'),
      prs: 2,
      approved: 0,
      changes: 0,
      commented: 1,
      comments: 1,
      firstResponses: 1,
      response: { state: 'tooFew', prs: 2 },
    });
  });

  it('counts a comment on a draft never ready, but not as a response', () => {
    // a commented on #66100, its first response, and on #66700, never ready.
    expect(of('fixture-author-a')).toMatchObject({ prs: 2, comments: 2, firstResponses: 1, response: { prs: 1 } });
  });

  it("agrees with the Reviewer filter: a reviewer's PRs are the PRs it selects", () => {
    for (const r of reviewers) {
      const login = META.people[r.person] as string;
      expect(r.prs, login).toBe(select(data, { ...filters, reviewer: login }).length);
    }
  });
});

describe('reviewerRows medians and edges', () => {
  const t = at('2026-06-01T00:00:00Z');
  const whole = periodRange(defaultFilters(META));

  it('takes the plain median of the days from ready to their first response, over five PRs or more', () => {
    const d = dataset(
      [1, 2, 3, 4, 5].map((k) => ({ created: t, author: 0, first_response: t + k * DAY })),
      [1, 2, 3, 4, 5].flatMap((k, pr) => [
        { pr, at: t + k * DAY, kind: 'comment_other', actor: 1 },
        // A later review on the same PR is not their first response.
        { pr, at: t + 30 * DAY, kind: 'review_approved', actor: 1 },
      ]),
    );
    const [r] = reviewerRows(d, all(d), whole);
    expect(r).toMatchObject({ prs: 5, comments: 5, approved: 5, firstResponses: 5 });
    expect(r?.response).toEqual({ state: 'known', days: 3, prs: 5 });
  });

  it('credits a first response only when it came while the PR was open, though the data records one after', () => {
    // The data's first response does not check the close; the page does.
    const late = dataset(
      [{ created: t, author: 0, state: 2, closed: t + DAY, first_response: t + 2 * DAY }],
      [{ pr: 0, at: t + 2 * DAY, kind: 'review_commented', actor: 1 }],
    );
    expect(reviewerRows(late, all(late), whole)).toMatchObject([{ person: 1, commented: 1, firstResponses: 0 }]);
    const inTime = dataset(
      [{ created: t, author: 0, state: 2, closed: t + 3 * DAY, first_response: t + 2 * DAY }],
      [{ pr: 0, at: t + 2 * DAY, kind: 'review_commented', actor: 1 }],
    );
    expect(reviewerRows(inTime, all(inTime), whole)).toMatchObject([{ person: 1, commented: 1, firstResponses: 1 }]);
  });

  it('credits a first response made while the PR was closed before a reopening: only the final close counts', () => {
    const d = dataset(
      [{ created: t, author: 0, state: 1, closed: t + 5 * DAY, reopened: 1, first_response: t + 2 * DAY }],
      [
        { pr: 0, at: t + DAY, kind: 'closed' },
        { pr: 0, at: t + 2 * DAY, kind: 'comment_other', actor: 1 },
        { pr: 0, at: t + 3 * DAY, kind: 'reopened' },
      ],
    );
    expect(reviewerRows(d, all(d), whole)).toMatchObject([{ person: 1, comments: 1, firstResponses: 1, response: { prs: 1 } }]);
  });

  it('counts a comment after the PR finished, but not as a response', () => {
    const d = dataset(
      [{ created: t, author: 0, state: 1, closed: t + DAY }],
      [{ pr: 0, at: t + 2 * DAY, kind: 'comment_other', actor: 1 }],
    );
    expect(reviewerRows(d, all(d), whole)).toEqual([
      {
        person: 1,
        prs: 1,
        approved: 0,
        changes: 0,
        commented: 0,
        comments: 1,
        firstResponses: 0,
        response: { state: 'tooFew', prs: 0 },
      },
    ]);
  });

  it('names no one for an event without an actor: a bot command, an author comment, a bot review', () => {
    const d = dataset(
      [{ created: t, author: 0 }],
      [
        { pr: 0, at: t + 1, kind: 'command_other', sub: 0 },
        { pr: 0, at: t + 2, kind: 'comment_author' },
        { pr: 0, at: t + 3, kind: 'bot_review' },
        { pr: 0, at: t + 4, kind: 'bot_account' },
      ],
    );
    expect(reviewerRows(d, all(d), whole)).toEqual([]);
  });

  it('leaves out the PRs not selected', () => {
    const d = dataset(
      [
        { created: t, author: 0 },
        { created: t, author: 0 },
      ],
      [
        { pr: 0, at: t + 1, kind: 'review_changes', actor: 1 },
        { pr: 1, at: t + 1, kind: 'review_commented', actor: 1 },
      ],
    );
    expect(reviewerRows(d, Uint32Array.of(1), whole)).toMatchObject([{ person: 1, prs: 1, changes: 0, commented: 1 }]);
  });

  it('counts no event of the author’s own, which the data gives no actor', () => {
    const d = dataset(
      [{ created: t, author: 1, first_response: -1 }],
      [
        { pr: 0, at: t + 1, kind: 'comment_author' },
        { pr: 0, at: t + 2, kind: 'review_author' },
        { pr: 0, at: t + 3, kind: 'command_author', sub: 0 },
      ],
      { event_kinds: [...META.event_kinds, 'review_author'] },
    );
    expect(reviewerRows(d, all(d), whole)).toEqual([]);
  });

  it('counts a deleted account’s comment on a PR another deleted account opened, and credits its first response', () => {
    // Every deleted account shares the one `ghost` index. An event that names
    // an actor is by the data's rule never the author's, so the shared index
    // must not make it look like one.
    const people = [...META.people, 'ghost'];
    const ghost = people.length - 1;
    const d = dataset(
      [{ created: t, author: ghost, first_response: t + DAY }],
      [
        { pr: 0, at: t + DAY, kind: 'comment_other', actor: ghost },
        { pr: 0, at: t + 2 * DAY, kind: 'review_approved', actor: 1 },
      ],
      { people },
    );
    const rows = reviewerRows(d, all(d), whole);
    expect(rows.find((r) => r.person === ghost)).toMatchObject({ prs: 1, comments: 1, firstResponses: 1 });
    expect(rows.find((r) => r.person === 1)).toMatchObject({ prs: 1, approved: 1, firstResponses: 0 });
  });

  it('gives no one a first response on a PR never made ready', () => {
    const d = dataset(
      [{ created: t, author: 0, ready: -1, draft: 1, opened_draft: 1 }],
      [{ pr: 0, at: t + DAY, kind: 'comment_other', actor: 1 }],
    );
    expect(reviewerRows(d, all(d), whole)).toMatchObject([
      { person: 1, prs: 1, comments: 1, firstResponses: 0, response: { state: 'tooFew', prs: 0 } },
    ]);
  });
});
