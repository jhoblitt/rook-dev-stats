import { describe, expect, it } from 'vitest';
import { DAY } from '../filters';
import { all, at, dataset } from './testing';
import { weekly } from './weekly';

const MERGED = 1;
const CLOSED = 2;
const W1 = at('2026-06-01T00:00:00Z');
const W2 = at('2026-06-08T00:00:00Z');
const W3 = at('2026-06-15T00:00:00Z');
// Three whole weeks, Monday 2026-06-01 to Sunday 2026-06-21.
const PERIOD = { start: W1, end: W1 + 21 * DAY };
const NOW = at('2026-07-01T00:00:00Z');
const NONE = 0;
const TRAILER = 3;

describe('weekly by week opened', () => {
  it('puts a PR opened Sunday 23:59:59 UTC and one opened Monday 00:00:00 in different weeks', () => {
    const data = dataset([{ created: at('2026-06-07T23:59:59Z') }, { created: at('2026-06-08T00:00:00Z') }]);
    const s = weekly(data, all(data), PERIOD, 'opened');
    expect(s.week).toEqual([W1, W2, W3]);
    expect(s.step).toBe('week');
    expect(s.values).toEqual({ disclosed: [0, 0, 0], 'not-disclosed': [1, 1, 0] });
  });

  it('splits the opened PRs by disclosure, and counts only rows in the window and the period', () => {
    const data = dataset([
      { created: W1, disclosure: TRAILER },
      { created: W1 + DAY, disclosure: NONE },
      { created: W2, disclosure: 1 },
      { created: W2, in_window: 0 },
      { created: W1 - 1 },
      { created: PERIOD.end },
    ]);
    expect(weekly(data, all(data), PERIOD, 'opened').values).toEqual({
      disclosed: [1, 1, 0],
      'not-disclosed': [1, 0, 0],
    });
  });

  it('counts only the rows selected', () => {
    const data = dataset([{ created: W1 }, { created: W1 }]);
    expect(weekly(data, Uint32Array.of(1), PERIOD, 'opened').values['not-disclosed']).toEqual([1, 0, 0]);
  });

  it('gives the share disclosing by week opened, by tool family, and null for a week with no PRs', () => {
    const data = dataset([
      { created: W1, disclosure: TRAILER, families: [0] },
      { created: W1, disclosure: TRAILER, families: [0, 1] },
      { created: W1 },
      { created: W1 },
      { created: W3, disclosure: 2, families: [2] },
    ]);
    const s = weekly(data, all(data), PERIOD, 'disclosureShare');
    expect(s.values).toEqual({
      disclosed: [0.5, null, 1],
      claude: [0.5, null, 0],
      copilot: [0.25, null, 0],
      unspecified: [0, null, 1],
    });
  });

  it('gives the waiting quantiles of each week opened, not yet known while PRs still wait', () => {
    // Week 1: responses after 1, 2, 3 and 4 days. Week 2: one response after
    // 1 day, three PRs still waiting. Week 3: none.
    const week1 = [1, 2, 3, 4].map((d) => ({ created: W1, first_response: W1 + d * DAY }));
    const week2 = [{ created: W2, first_response: W2 + DAY }, { created: W2 }, { created: W2 }, { created: W2 }];
    const data = dataset([...week1, ...week2], [], { fetched_through: NOW });
    const s = weekly(data, all(data), PERIOD, { kind: 'waitingByWeekOpened', span: 'response', quantiles: [0.5, 0.9] });
    expect(s.values).toEqual({
      '0.5': [{ state: 'known', days: 2 }, { state: 'notYetKnown' }, { state: 'none' }],
      '0.9': [{ state: 'known', days: 4 }, { state: 'notYetKnown' }, { state: 'none' }],
    });
  });

  it('says a quantile is not reached when every PR of the week has finished short of it', () => {
    // Week 1: merged after 1 day and closed unmerged after 2; both finished, half merged.
    // Week 3: one PR still open.
    const data = dataset(
      [
        { created: W1, state: MERGED, closed: W1 + DAY },
        { created: W1, state: CLOSED, closed: W1 + 2 * DAY },
        { created: W3 },
      ],
      [],
      { fetched_through: NOW },
    );
    const s = weekly(data, all(data), PERIOD, { kind: 'waitingByWeekOpened', span: 'merge', quantiles: [0.5, 0.9] });
    expect(s.values).toEqual({
      '0.5': [{ state: 'known', days: 1 }, { state: 'none' }, { state: 'notYetKnown' }],
      '0.9': [{ state: 'notReached', share: 0.5 }, { state: 'none' }, { state: 'notYetKnown' }],
    });
  });

  it('keeps a week not yet known while one of its PRs is younger than its slowest finished one and still open', () => {
    // Week 3: one PR open since 06-15, at age 16 days at the fetch, beside three opened the
    // same day and finished after 17, 18 and 19 days (closed, closed, merged).
    const data = dataset(
      [
        { created: W3 },
        { created: W3, state: CLOSED, closed: W3 + 17 * DAY },
        { created: W3, state: CLOSED, closed: W3 + 18 * DAY },
        { created: W3, state: MERGED, closed: W3 + 19 * DAY },
      ],
      [],
      { fetched_through: W3 + 16 * DAY },
    );
    const s = weekly(data, all(data), PERIOD, { kind: 'waitingByWeekOpened', span: 'merge', quantiles: [0.5, 0.9] });
    expect(s.values['0.5']?.[2]).toEqual({ state: 'notYetKnown' });
    expect(s.values['0.9']?.[2]?.state).toBe('notReached');
  });

  it('gives the waiting quantiles of a span without censoring', () => {
    const data = dataset([
      { created: W2, first_commit: W2 - 3 * DAY },
      { created: W2, first_commit: W2 - DAY },
    ]);
    const series = { kind: 'waitingByWeekOpened', span: 'firstCommitToOpened', quantiles: [0.5] } as const;
    const s = weekly(data, all(data), PERIOD, series);
    expect(s.values).toEqual({ '0.5': [{ state: 'none' }, { state: 'known', days: 1 }, { state: 'none' }] });
  });
});

describe('weekly by calendar week', () => {
  it('counts merges and unmerged closes from the PR columns, by the week of the final disposition', () => {
    const data = dataset([
      { created: W1 - 30 * DAY, in_window: 0, state: MERGED, closed: W1 + DAY },
      { created: W1, state: MERGED, closed: W3 },
      { created: W1, state: CLOSED, closed: W2 + DAY },
      { created: W1, state: CLOSED, closed: PERIOD.end },
      { created: W1 },
    ]);
    expect(weekly(data, all(data), PERIOD, 'merged').values).toEqual({ merged: [1, 0, 1] });
    expect(weekly(data, all(data), PERIOD, 'closed').values).toEqual({ closed: [0, 1, 0] });
  });

  const reviews = dataset(
    [{ created: W1 - 60 * DAY, in_window: 0 }, { created: W1 }, { created: W1 }],
    [
      { pr: 0, at: W1 + 1, kind: 'review_approved', actor: 1 },
      { pr: 0, at: W1 + 2, kind: 'review_commented', actor: 1 },
      { pr: 1, at: W1 + 3, kind: 'review_changes', actor: 2 },
      { pr: 1, at: W1 + 4, kind: 'bot_review' },
      { pr: 1, at: W2 + 4, kind: 'review_commented', actor: 2 },
      { pr: 1, at: W2 + 5, kind: 'comment_other', actor: 3 },
      { pr: 2, at: W3 + 5, kind: 'bot_review' },
      { pr: 2, at: W1 - 1, kind: 'review_approved', actor: 4 },
      { pr: 2, at: PERIOD.end, kind: 'review_approved', actor: 4 },
    ],
  );

  it('counts human and bot reviews by the week they were made, PRs opened before the window included', () => {
    expect(weekly(reviews, all(reviews), PERIOD, 'reviews').values).toEqual({ human: [3, 1, 0], bot: [1, 0, 1] });
  });

  it('counts the distinct people reviewing each week', () => {
    expect(weekly(reviews, all(reviews), PERIOD, 'reviewers').values).toEqual({ reviewers: [2, 1, 0] });
  });

  it('counts only the events of the rows selected', () => {
    expect(weekly(reviews, Uint32Array.of(0), PERIOD, 'reviews').values).toEqual({ human: [2, 0, 0], bot: [0, 0, 0] });
  });

  it('counts bot commands by command, from the author or anyone else', () => {
    const data = dataset(
      [{ created: W1 }],
      [
        { pr: 0, at: W1 + 1, kind: 'command_author', sub: 0 },
        { pr: 0, at: W1 + 2, kind: 'command_other', sub: 0 },
        { pr: 0, at: W2 + 1, kind: 'command_other', sub: 1 },
        { pr: 0, at: W3 + 1, kind: 'comment_author' },
      ],
    );
    expect(weekly(data, all(data), PERIOD, 'commands').values).toEqual({
      'jenkins-test': [2, 0, 0],
      'config-check': [0, 1, 0],
    });
  });
});

describe('weekly over a period beyond 53 weeks', () => {
  it('steps by calendar month', () => {
    const period = { start: at('2025-05-15T00:00:00Z'), end: at('2026-07-01T00:00:00Z') };
    const data = dataset([
      { created: at('2025-05-31T23:59:59Z') },
      { created: at('2025-06-01T00:00:00Z') },
      { created: at('2026-06-30T12:00:00Z') },
    ]);
    const s = weekly(data, all(data), period, 'opened');
    expect(s.step).toBe('month');
    expect(s.week).toHaveLength(14);
    expect(s.week[1]).toBe(at('2025-06-01T00:00:00Z'));
    expect(s.values['not-disclosed']?.slice(0, 2)).toEqual([1, 1]);
    expect(s.values['not-disclosed']?.[13]).toBe(1);
  });
});

describe('an empty selection', () => {
  const data = dataset([{ created: W1 }], [{ pr: 0, at: W1 + 1, kind: 'review_approved', actor: 0 }]);
  const none = new Uint32Array(0);

  it.each(['opened', 'merged', 'closed', 'reviews', 'reviewers', 'commands', 'disclosureShare'] as const)(
    'gives an empty %s series',
    (series) => {
      const s = weekly(data, none, PERIOD, series);
      expect(s.week).toEqual([]);
      expect(Object.keys(s.values).length).toBeGreaterThan(0);
      for (const v of Object.values(s.values)) expect(v).toEqual([]);
    },
  );

  it('gives an empty waiting series', () => {
    const s = weekly(data, none, PERIOD, { kind: 'waitingByWeekOpened', span: 'merge', quantiles: [0.5] });
    expect(s).toEqual({ week: [], step: 'week', values: { '0.5': [] } });
  });
});
