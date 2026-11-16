import { describe, expect, it } from 'vitest';
import { DAY } from '../filters';
import { type Curve, SPAN_OUTCOMES, type Span, outcomeCurve, quantileDays, spanQuantile } from './curve';
import { type Row, all, at, dataset, random } from './testing';

const T0 = at('2026-06-01T00:00:00Z');
const NOW = T0 + 10 * DAY;
const SPANS = Object.keys(SPAN_OUTCOMES) as Span[];
const MERGED = 1;
const CLOSED = 2;

function expectClose(actual: readonly number[] | undefined, expected: readonly number[]) {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((v, i) => expect(actual?.[i]).toBeCloseTo(v, 12));
}

describe('outcomeCurve for merge', () => {
  // Durations from the opening: merged at 1 day, closed at 2, open at age 3, merged at 5.
  const four: Row[] = [
    { created: T0, state: MERGED, closed: T0 + 1 * DAY },
    { created: T0, state: CLOSED, closed: T0 + 2 * DAY },
    { created: T0 + 7 * DAY },
    { created: T0, state: MERGED, closed: T0 + 5 * DAY },
  ];

  it('competes merging against closing, and an open PR counts up to its age', () => {
    const data = dataset(four, [], { fetched_through: NOW });
    const c = outcomeCurve(data, all(data), 'merge');
    expect(c.days).toEqual([1, 2, 3, 5]);
    expectClose(c.shares.merged, [0.25, 0.25, 0.25, 0.75]);
    expectClose(c.shares.closed, [0, 0.25, 0.25, 0.25]);
    expectClose(c.shares.open, [0.75, 0.5, 0.5, 0]);
    expect(quantileDays(c, 'merged', 0.5)).toBe(5);
    expect(quantileDays(c, 'merged', 0.25)).toBe(1);
  });

  it('leaves the median not yet known when the curve has not reached it', () => {
    const data = dataset(four.slice(0, 3), [], { fetched_through: NOW });
    const c = outcomeCurve(data, all(data), 'merge');
    expect(c.days).toEqual([1, 2, 3]);
    expectClose(c.shares.merged, [1 / 3, 1 / 3, 1 / 3]);
    expectClose(c.shares.open, [2 / 3, 1 / 3, 1 / 3]);
    expect(quantileDays(c, 'merged', 0.5)).toBeNull();
  });

  it('counts the PRs at each outcome, the open ones under what remains', () => {
    const data = dataset(four, [], { fetched_through: NOW });
    expect(outcomeCurve(data, all(data), 'merge').counts).toEqual({ merged: 2, closed: 1, open: 1 });
    expect(outcomeCurve(data, new Uint32Array(0), 'merge').counts).toEqual({ merged: 0, closed: 0, open: 0 });
  });

  it('tells a quantile known, not yet known, and not reached apart', () => {
    // Merged 1/4 from day 1 and 3/4 from day 5, closed 1/4 from day 2. The third PR is
    // still open, at age 3, but the curve's open share falls to 0 once the merge at day 5
    // outlasts it.
    const data = dataset(four, [], { fetched_through: NOW });
    const c = outcomeCurve(data, all(data), 'merge');
    expect(spanQuantile(c, 'merge', 0.5)).toEqual({ state: 'known', days: 5 });
    // Two merged and one open of four: at most 3/4 can merge, short of 9 in 10.
    expect(spanQuantile(c, 'merge', 0.9)).toEqual({ state: 'notReached', share: 0.75 });
    // Of three, 1/3 merged and 1/3 still open: 1/2 can still be reached, 9 in 10 cannot.
    const three = dataset(four.slice(0, 3), [], { fetched_through: NOW });
    const d = outcomeCurve(three, all(three), 'merge');
    expect(spanQuantile(d, 'merge', 0.5)).toEqual({ state: 'notYetKnown' });
    const notReached = spanQuantile(d, 'merge', 0.9);
    expect(notReached.state).toBe('notReached');
    expect(notReached.state === 'notReached' && notReached.share).toBeCloseTo(1 / 3, 12);
    // Exactly reachable: 1/3 merged plus 1/3 open is 2/3.
    expect(spanQuantile(d, 'merge', 2 / 3)).toEqual({ state: 'notYetKnown' });
  });

  it('keeps a quantile not yet known while a PR younger than the slowest finished one is still open', () => {
    // A open at age 1 day, B closed after 2, C closed after 3, D merged after 4. The curve
    // ends at merged 1/3 and open 0, but A may still merge: one merged and one open of four
    // can still make a half.
    const rows: Row[] = [
      { created: NOW - DAY },
      { created: T0, state: CLOSED, closed: T0 + 2 * DAY },
      { created: T0, state: CLOSED, closed: T0 + 3 * DAY },
      { created: T0, state: MERGED, closed: T0 + 4 * DAY },
    ];
    const open = dataset(rows, [], { fetched_through: NOW });
    const c = outcomeCurve(open, all(open), 'merge');
    expectClose(c.shares.merged, [0, 0, 0, 1 / 3]);
    expectClose(c.shares.open, [1, 2 / 3, 1 / 3, 0]);
    expect(spanQuantile(c, 'merge', 0.5)).toEqual({ state: 'notYetKnown' });
    // Two of four cannot make nine in ten, whatever A does.
    const p90 = spanQuantile(c, 'merge', 0.9);
    expect(p90.state).toBe('notReached');
    expect(p90.state === 'notReached' && p90.share).toBeCloseTo(1 / 3, 12);
    // A merges at day 5: half merged by day 5.
    const merged = dataset([{ created: T0, state: MERGED, closed: T0 + 5 * DAY }, ...rows.slice(1)], [], {
      fetched_through: NOW,
    });
    expect(spanQuantile(outcomeCurve(merged, all(merged), 'merge'), 'merge', 0.5)).toEqual({ state: 'known', days: 5 });
  });

  it('has nothing to say about a quantile of no PRs', () => {
    const none = dataset(four, [], { fetched_through: NOW });
    expect(spanQuantile(outcomeCurve(none, new Uint32Array(0), 'merge'), 'merge', 0.5)).toEqual({ state: 'none' });
  });

  it('removes a PR open at an age after the outcomes at that same age', () => {
    // Merged at 2 days and open at age 2: the open PR is still at risk at day 2.
    const data = dataset(
      [
        { created: T0, state: MERGED, closed: T0 + 2 * DAY },
        { created: NOW - 2 * DAY },
      ],
      [],
      { fetched_through: NOW },
    );
    const c = outcomeCurve(data, all(data), 'merge');
    expect(c.days).toEqual([2]);
    expectClose(c.shares.merged, [0.5]);
    expectClose(c.shares.open, [0.5]);
  });

  it('runs from the opening, a draft never marked ready included', () => {
    // Merged 4 days after opening though ready after 1; a draft closed after 1.
    const data = dataset(
      [
        { created: T0, ready: T0 + 1 * DAY, state: MERGED, closed: T0 + 4 * DAY },
        { created: T0, ready: -1, state: CLOSED, closed: T0 + 1 * DAY },
      ],
      [],
      { fetched_through: NOW },
    );
    const c = outcomeCurve(data, all(data), 'merge');
    expect(c.days).toEqual([1, 4]);
    expectClose(c.shares.closed, [0.5, 0.5]);
    expectClose(c.shares.merged, [0, 0.5]);
    expectClose(c.shares.open, [0.5, 0]);
  });

  it('counts only the rows asked for', () => {
    const data = dataset(four, [], { fetched_through: NOW });
    const c = outcomeCurve(data, Uint32Array.of(1, 3), 'merge');
    expect(c.days).toEqual([2, 5]);
    expectClose(c.shares.closed, [0.5, 0.5]);
    expectClose(c.shares.merged, [0, 0.5]);
  });
});

describe('outcomeCurve for response and approval', () => {
  const rows: Row[] = [
    // Responded after 1 day, then merged.
    { created: T0, first_response: T0 + 1 * DAY, first_approval: T0 + 3 * DAY, state: MERGED, closed: T0 + 4 * DAY },
    // Merged after 2 days with no response.
    { created: T0, state: MERGED, closed: T0 + 2 * DAY },
    // Closed after 2 days; the response came after the close, too late to count.
    { created: T0, first_response: T0 + 5 * DAY, state: CLOSED, closed: T0 + 2 * DAY },
    // Open and waiting at age 4.
    { created: NOW - 4 * DAY },
  ];
  const data = dataset(rows, [], { fetched_through: NOW });

  it('competes a response against finishing without one', () => {
    const c = outcomeCurve(data, all(data), 'response');
    expect(c.days).toEqual([1, 2, 4]);
    expectClose(c.shares.responded, [0.25, 0.25, 0.25]);
    expectClose(c.shares.finished, [0, 0.5, 0.5]);
    expectClose(c.shares.waiting, [0.75, 0.25, 0.25]);
  });

  it('competes an approval against finishing without one', () => {
    const c = outcomeCurve(data, all(data), 'approval');
    expect(c.days).toEqual([2, 3, 4]);
    expectClose(c.shares.approved, [0, 0.25, 0.25]);
    expectClose(c.shares.finished, [0.5, 0.5, 0.5]);
    expectClose(c.shares.waiting, [0.5, 0.25, 0.25]);
  });
});

describe('outcomeCurve for the spans after approval and after the last commit', () => {
  it('runs from the first approval to the final disposition, leaving out unapproved PRs', () => {
    const data = dataset(
      [
        { created: T0, first_approval: T0 + 1 * DAY, state: MERGED, closed: T0 + 3 * DAY },
        { created: T0, first_approval: NOW - 1 * DAY },
        { created: T0, state: MERGED, closed: T0 + 3 * DAY },
      ],
      [],
      { fetched_through: NOW },
    );
    const c = outcomeCurve(data, all(data), 'afterApproval');
    // The PR open at age 1 leaves the risk set; the one left merges at day 2.
    expect(c.days).toEqual([1, 2]);
    expectClose(c.shares.merged, [0, 1]);
    expectClose(c.shares.open, [1, 0]);
  });

  describe('an approval after the final disposition', () => {
    const data = dataset(
      [
        { created: T0, first_approval: T0 + 1 * DAY, state: MERGED, closed: T0 + 3 * DAY },
        // Merged after 2 days, approved after 5: never approved while open.
        { created: T0, first_approval: T0 + 5 * DAY, state: MERGED, closed: T0 + 2 * DAY },
        // Approved at the moment it was closed.
        { created: T0, first_approval: T0 + 4 * DAY, state: CLOSED, closed: T0 + 4 * DAY },
      ],
      [],
      { fetched_through: NOW },
    );

    it('leaves the PR out of the span after approval', () => {
      const c = outcomeCurve(data, all(data), 'afterApproval');
      expect(c.days).toEqual([0, 2]);
      expectClose(c.shares.closed, [0.5, 0.5]);
      expectClose(c.shares.merged, [0, 0.5]);
      expectClose(c.shares.open, [0.5, 0]);
    });

    it('counts the same PR as finished without an approval on the approval span', () => {
      const c = outcomeCurve(data, all(data), 'approval');
      expect(c.days).toEqual([1, 2, 4]);
      expectClose(c.shares.approved, [1 / 3, 1 / 3, 2 / 3]);
      expectClose(c.shares.finished, [0, 1 / 3, 1 / 3]);
      expectClose(c.shares.waiting, [2 / 3, 1 / 3, 0]);
    });
  });

  it('runs from the last commit to the final disposition', () => {
    const data = dataset(
      [
        { created: T0, last_commit: T0 + 1 * DAY, state: CLOSED, closed: T0 + 2 * DAY },
        { created: T0, state: MERGED, closed: T0 + 2 * DAY },
      ],
      [],
      { fetched_through: NOW },
    );
    const c = outcomeCurve(data, all(data), 'afterLastCommit');
    expect(c.days).toEqual([1]);
    expectClose(c.shares.closed, [1]);
  });
});

describe('outcomeCurve for the spans around opening', () => {
  it('measures first commit to opened, leaving out an unknown first commit', () => {
    const data = dataset([
      { created: T0, first_commit: T0 - 2 * DAY },
      { created: T0, first_commit: T0 - DAY / 2 },
      { created: T0, first_commit: -1 },
    ]);
    const c = outcomeCurve(data, all(data), 'firstCommitToOpened');
    expect(c.days).toEqual([0.5, 2]);
    expectClose(c.shares.done, [0.5, 1]);
    expect(quantileDays(c, 'done', 0.5)).toBe(0.5);
  });

  it('leaves out a first commit dated after the opening, as unknown', () => {
    const data = dataset([{ created: T0, first_commit: T0 + DAY }]);
    expect(outcomeCurve(data, all(data), 'firstCommitToOpened').days).toEqual([]);
  });

  it('measures opened to last commit on finished PRs only', () => {
    const data = dataset(
      [
        { created: T0, last_commit: T0 + 3 * DAY, state: MERGED, closed: T0 + 4 * DAY },
        { created: T0, last_commit: T0 + 1 * DAY, state: CLOSED, closed: T0 + 4 * DAY },
        { created: T0, last_commit: T0 + 2 * DAY },
      ],
      [],
      { fetched_through: NOW },
    );
    const c = outcomeCurve(data, all(data), 'openedToLastCommit');
    expect(c.days).toEqual([1, 3]);
    expectClose(c.shares.done, [0.5, 1]);
  });
});

describe('timestamps out of order', () => {
  it('gives zero days to the last commit when it predates the opening', () => {
    const data = dataset([{ created: T0, last_commit: T0 - DAY, state: MERGED, closed: T0 + DAY }], [], {
      fetched_through: NOW,
    });
    const c = outcomeCurve(data, all(data), 'openedToLastCommit');
    expect(c.days).toEqual([0]);
    expectClose(c.shares.done, [1]);
  });

  it('gives zero days to merge when the merge predates the opening', () => {
    const data = dataset([{ created: T0, state: MERGED, closed: T0 - DAY / 2 }], [], {
      fetched_through: NOW,
    });
    const c = outcomeCurve(data, all(data), 'merge');
    expect(c.days).toEqual([0]);
    expectClose(c.shares.merged, [1]);
  });

  it('gives zero days after the last commit when it is after fetched_through', () => {
    const data = dataset(
      [
        { created: T0, last_commit: NOW + DAY },
        { created: T0, last_commit: NOW + DAY, state: MERGED, closed: NOW - DAY },
      ],
      [],
      { fetched_through: NOW },
    );
    const c = outcomeCurve(data, all(data), 'afterLastCommit');
    expect(c.days).toEqual([0]);
    expectClose(c.shares.merged, [0.5]);
    expectClose(c.shares.open, [0.5]);
  });

  it('gives no negative or NaN value on any span', () => {
    const data = dataset(
      [
        { created: T0, ready: T0 + DAY, first_response: T0, first_approval: T0, state: MERGED, closed: T0 - DAY },
        { created: T0, first_commit: T0 + DAY, last_commit: T0 - 2 * DAY, state: CLOSED, closed: T0 - DAY },
        { created: NOW + DAY, ready: NOW + DAY, first_approval: NOW + 2 * DAY, last_commit: NOW + 3 * DAY },
      ],
      [],
      { fetched_through: NOW },
    );
    for (const span of SPANS) {
      const c: Curve = outcomeCurve(data, all(data), span);
      for (const d of c.days) expect(d >= 0 && Number.isFinite(d), `${span}: ${d}`).toBe(true);
      for (const series of Object.values(c.shares)) {
        for (const s of series) expect(s >= 0 && s <= 1, `${span}: ${s}`).toBe(true);
      }
    }
  });
});

describe('an empty selection', () => {
  const data = dataset([{ created: T0, state: MERGED, closed: T0 + DAY }]);

  it.each(SPANS)('gives an empty %s curve and null quantiles', (span) => {
    const c: Curve = outcomeCurve(data, new Uint32Array(0), span);
    expect(c.days).toEqual([]);
    expect(Object.keys(c.shares)).toEqual([...SPAN_OUTCOMES[span]]);
    for (const series of Object.values(c.shares)) expect(series).toEqual([]);
    for (const outcome of SPAN_OUTCOMES[span]) expect(quantileDays(c, outcome, 0.5)).toBeNull();
  });
});

describe('property: random rows', () => {
  function randomRows(seed: number): Row[] {
    const rnd = random(seed);
    const time = () => T0 + Math.floor(rnd() * 40) * (DAY / 4);
    const maybe = (p: number, t: number) => (rnd() < p ? t : -1);
    return Array.from({ length: 1 + Math.floor(rnd() * 60) }, () => {
      const created = time();
      const state = Math.floor(rnd() * 3);
      return {
        created,
        ready: maybe(0.9, created + Math.floor(rnd() * 3) * DAY),
        state,
        closed: state === 0 ? -1 : time(),
        first_response: maybe(0.6, time()),
        first_approval: maybe(0.4, time()),
        first_commit: maybe(0.8, created - Math.floor(rnd() * 5) * DAY),
        last_commit: maybe(0.8, time()),
      };
    });
  }

  const seeds = Array.from({ length: 50 }, (_, i) => i + 1);

  it.each(seeds)('seed %i: shares are monotone, in [0, 1], and sum to one', (seed) => {
    const data = dataset(randomRows(seed), [], { fetched_through: T0 + 12 * DAY });
    for (const span of SPANS) {
      const names: readonly string[] = SPAN_OUTCOMES[span];
      const c: Curve = outcomeCurve(data, all(data), span);
      for (let i = 1; i < c.days.length; i++) expect(c.days[i]).toBeGreaterThan(c.days[i - 1] as number);
      // With three outcomes the last is what remains, S; a lone outcome is complete.
      const outcomes = names.length === 1 ? names : names.slice(0, -1);
      const remaining = names.length === 1 ? null : (c.shares[names[2] as string] as number[]);
      for (let i = 0; i < c.days.length; i++) {
        let sum = remaining?.[i] ?? 0;
        for (const o of outcomes) {
          const s = c.shares[o] as number[];
          expect(s[i]).toBeGreaterThanOrEqual(i === 0 ? 0 : (s[i - 1] as number));
          expect(s[i]).toBeLessThanOrEqual(1);
          sum += s[i] as number;
        }
        if (remaining) {
          expect(remaining[i]).toBeGreaterThanOrEqual(0);
          expect(remaining[i]).toBeLessThanOrEqual(i === 0 ? 1 : (remaining[i - 1] as number));
          expect(sum).toBeCloseTo(1, 9);
        }
      }
      if (!remaining && c.days.length > 0) expect(c.shares['done']?.at(-1)).toBeCloseTo(1, 9);
    }
  });
});
