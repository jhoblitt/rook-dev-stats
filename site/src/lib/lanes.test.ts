import { describe, expect, it } from 'vitest';
import { DAY, periodRange } from './filters';
import {
  LANE_CAP,
  LEAST_SPAN,
  type Lane,
  type LaneMode,
  type LaneView,
  byOpening,
  calendarSpan,
  describeLane,
  describeLanes,
  laneAt,
  laneModel,
  laneScale,
  lanePitch,
  laneView,
  lanesLine,
  spanNote,
  spanText,
} from './lanes';
import { HOUR } from './plot';
import { META, all, at, dataset, fixture } from './stats/testing';

const T0 = at('2026-06-01T00:00:00Z');

describe('byOpening', () => {
  it('puts the newest opened first, ties by the higher number', () => {
    const data = dataset([
      { number: 1, created: T0 },
      { number: 2, created: T0 + DAY },
      { number: 3, created: T0 },
    ]);
    expect(byOpening(data, all(data))).toEqual([1, 2, 0]);
  });
});

describe('laneModel', () => {
  it('draws at most 200 lanes, in the order given, and counts the rest', () => {
    const data = dataset(Array.from({ length: 250 }, (_, i) => ({ number: 1000 + i, created: T0 + i * 3600 })));
    const order = byOpening(data, all(data));
    const { lanes, total } = laneModel(data, order);
    expect(LANE_CAP).toBe(200);
    expect(total).toBe(250);
    expect(lanes).toHaveLength(200);
    expect(lanes[0]?.number).toBe(1249);
    expect(lanes.at(-1)?.number).toBe(1050);
  });

  it('keeps a lane all of a PR the line needs', () => {
    const data = dataset(
      [{ number: 70000, created: T0, first_commit: T0 - 2 * DAY, state: 1, closed: T0 + 9 * DAY, reopened: 1 }],
      [
        { pr: 0, at: T0 + DAY, kind: 'comment_other' },
        { pr: 0, at: T0 + 2 * DAY, kind: 'review_approved' },
        { pr: 0, at: T0 + 3 * DAY, kind: 'closed' },
        { pr: 0, at: T0 + 5 * DAY, kind: 'reopened' },
        { pr: 0, at: T0 + 6 * DAY, kind: 'force_push' },
        { pr: 0, at: T0 + 7 * DAY, kind: 'command_author', sub: 0 },
        { pr: 0, at: T0 + 9 * DAY, kind: 'merged' },
      ],
    );
    expect(laneModel(data, [0]).lanes[0]).toEqual({
      row: 0,
      number: 70000,
      created: T0,
      firstCommit: T0 - 2 * DAY,
      end: T0 + 9 * DAY,
      state: 'merged',
      closed: [{ from: T0 + 3 * DAY, to: T0 + 5 * DAY }],
      activity: [T0 + DAY, T0 + 7 * DAY],
      approvals: [T0 + 2 * DAY],
      reopened: 1,
    });
  });

  it('runs an open PR to the last fetch, and leaves off a first commit after the opening', () => {
    const data = dataset([{ number: 70000, created: T0, first_commit: -1 }]);
    expect(laneModel(data, [0]).lanes[0]).toMatchObject({ state: 'open', end: META.fetched_through, firstCommit: null });
  });
});

describe('laneScale', () => {
  const data = dataset([
    { number: 1, created: T0, state: 1, closed: T0 + 10 * DAY },
    { number: 2, created: T0 + 5 * DAY, state: 2, closed: T0 + 105 * DAY },
  ]);
  const { lanes } = laneModel(data, [0, 1]);
  const [a, b] = lanes as [NonNullable<(typeof lanes)[0]>, NonNullable<(typeof lanes)[1]>];

  // The room left after the lanes' latest end: 4 of 1,000 pixels, the rest the stretch.
  const room = (seconds: number) => (seconds * 4) / 996;

  it('runs the calendar over exactly a one-day period when the lanes span it, in hours', () => {
    // 10 June 2026: #1 and #2 opened before it and ended after it.
    const period = periodRange({ from: '2026-06-10', to: '2026-06-10' });
    const span = calendarSpan(lanes, period, 1000);
    expect(span).toEqual({ ...period, endDrawn: false });
    const scale = laneScale('calendar', lanes, 1000, span);
    expect(scale.x(a, period.start)).toBe(0);
    expect(scale.x(a, period.start + 12 * 3600)).toBeCloseTo(500, 6);
    expect(scale.x(b, period.end)).toBe(1000);
    expect(scale.ticks.map((t) => t.label)).toEqual(['10 Jun 2026', '03:00', '06:00', '09:00', '12:00', '15:00', '18:00', '21:00']);
    expect(scale.ticks[0]).toMatchObject({ at: 0, anchor: 'start' });
  });

  it('runs the calendar over a six-month period from the earliest opening to the period’s end, which the lanes outlast', () => {
    const period = periodRange({ from: '2026-03-01', to: '2026-08-31' });
    const span = calendarSpan(lanes, period, 1000);
    // From #1's opening, 1 June, to the period's end: #2 closed after it.
    expect(span).toEqual({ start: T0, end: period.end, endDrawn: false });
    const scale = laneScale('calendar', lanes, 1000, span);
    expect(scale.x(a, T0)).toBe(0);
    expect(scale.x(b, period.end)).toBeCloseTo(1000, 6);
    expect(scale.ticks.map((t) => t.label)).toEqual([
      // Mondays, a week apart; 8 June is too near the start's label.
      '1 Jun 2026', '15 Jun', '22 Jun', '29 Jun', '6 Jul', '13 Jul', '20 Jul', '27 Jul', '3 Aug', '10 Aug', '17 Aug', '24 Aug', '31 Aug',
    ]);
  });

  it('ends the calendar at the latest end when every lane ended before the period did', () => {
    const period = periodRange({ from: '2026-06-03', to: '2026-12-31' });
    const span = calendarSpan(lanes, period, 1000);
    // From the period's start, after #1 opened, to #2's close, 14 September, with room after it for its mark.
    const stretch = T0 + 105 * DAY - period.start;
    expect(span.start).toBe(period.start);
    expect(span.end).toBeCloseTo(T0 + 105 * DAY + room(stretch), 3);
    expect(span.endDrawn).toBe(true);
    const scale = laneScale('calendar', lanes, 1000, span);
    expect(scale.x(b, T0 + 105 * DAY)).toBeCloseTo(996, 6);
    // #2's close, the latest end, is drawn, and nothing of it goes on later than shown.
    expect(laneView('calendar', b, span)).toMatchObject({ ending: T0 + 105 * DAY, after: false });
  });

  it('runs the calendar over the lanes’ stretch inside the whole window, not the whole window', () => {
    const period = periodRange({ from: '2011-09-01', to: '2026-11-15' });
    const span = calendarSpan(lanes, period, 1000);
    expect(span.start).toBe(T0);
    expect(span.end).toBeCloseTo(T0 + 105 * DAY + room(105 * DAY), 3);
    const scale = laneScale('calendar', lanes, 1000, span);
    expect(scale.x(a, T0)).toBe(0);
    expect(scale.x(b, T0 + 105 * DAY)).toBeCloseTo(996, 6);
    expect(scale.ticks.map((t) => t.label)).toEqual(['1 Jun 2026', '15 Jun', '22 Jun', '29 Jun', '6 Jul', '13 Jul', '20 Jul', '27 Jul', '3 Aug', '10 Aug', '17 Aug', '24 Aug', '31 Aug', '7 Sep']);
    expect(spanText(span)).toBe('1 Jun 2026 to 14 Sep 2026');
    expect(spanNote(span, period)).toBe('The calendar runs over the part of the period these PRs take up, 1 Jun 2026 to 14 Sep 2026.');
  });

  it('shows at least an hour when the lanes take up less, and the period when there are none', () => {
    const period = periodRange({ from: '2026-06-01', to: '2026-06-30' });
    const t = T0 + 10 * DAY;
    const instant = laneModel(dataset([{ number: 1, created: t, state: 2, closed: t }]), [0]).lanes;
    const span = calendarSpan(instant, period, 1000);
    expect(span.start).toBe(t - LEAST_SPAN / 2);
    expect(span.end).toBeCloseTo(t + LEAST_SPAN / 2 + room(LEAST_SPAN), 3);
    expect(laneView('calendar', instant[0] as Lane, span)).toMatchObject({ open: [{ from: t, to: t }], ending: t, before: false, after: false });
    expect(calendarSpan([], period, 1000)).toEqual({ ...period, endDrawn: false });
    expect(spanNote({ ...period, endDrawn: false }, period)).toBeNull();
  });

  it('sets every lane at its opening on the page’s log duration scale, from an hour to the longest', () => {
    const scale = laneScale('sinceOpening', lanes, 1000, { start: T0, end: T0 + 100 * DAY, endDrawn: false });
    expect(scale.x(a, a.created)).toBe(0);
    expect(scale.x(b, b.created + HOUR * DAY)).toBe(0);
    expect(scale.x(b, b.created + 100 * DAY)).toBeCloseTo(1000, 6);
    // Log scale: a day is as far from an hour as 24 days are from a day.
    const day = scale.x(a, a.created + DAY) as number;
    expect(scale.x(a, a.created + 24 * DAY)).toBeCloseTo(2 * day, 6);
    expect(scale.x(a, a.created - DAY)).toBeNull();
    expect(scale.ticks.map((t) => t.label)).toEqual(['1 hour', '1 day', '1 week', '1 month', '3 months']);
  });
});

describe('laneView', () => {
  // A one-day period, 10 June 2026, and the four lanes of its sketch plus
  // one open all day with nothing in it.
  const P = periodRange({ from: '2026-06-10', to: '2026-06-10' });
  const S = P.start;
  const E = P.end;
  const H = 3600;
  const data = dataset(
    [
      // Opened that day, still open at the last fetch, months on.
      { number: 56146, created: S + 3 * H },
      // Open all day, merged days after it.
      { number: 55990, created: S - 10 * DAY, state: 1, closed: E + 5 * DAY },
      // Closed unmerged that day.
      { number: 55871, created: S - 5 * DAY, state: 2, closed: S + 6 * H },
      // Its first commit two days before, opened and merged that day.
      { number: 55800, created: S + H, first_commit: S - 2 * DAY, state: 1, closed: S + 20 * H },
      // Open all day with no event in it.
      { number: 55700, created: S - 30 * DAY, state: 1, closed: E + 30 * DAY, reopened: 1 },
      // Closed across both edges, reopened between them and after.
      { number: 55600, created: S - 10 * DAY, state: 1, closed: E + 2 * DAY, reopened: 2 },
    ],
    [
      { pr: 1, at: S - DAY, kind: 'comment_other' },
      { pr: 1, at: S, kind: 'comment_other' },
      { pr: 1, at: S + 2 * H, kind: 'review_approved' },
      { pr: 1, at: E - 1, kind: 'comment_other' },
      { pr: 1, at: E, kind: 'review_approved' },
      { pr: 1, at: E + DAY, kind: 'comment_other' },
      { pr: 4, at: S - 20 * DAY, kind: 'closed' },
      { pr: 4, at: S - 15 * DAY, kind: 'reopened' },
      { pr: 4, at: S - 5 * DAY, kind: 'comment_other' },
      { pr: 4, at: E + 2 * DAY, kind: 'review_approved' },
      { pr: 5, at: S - DAY, kind: 'closed' },
      { pr: 5, at: S + 2 * H, kind: 'reopened' },
      { pr: 5, at: S + 20 * H, kind: 'closed' },
      { pr: 5, at: E + DAY, kind: 'reopened' },
    ],
  );
  const { lanes } = laneModel(data, [0, 1, 2, 3, 4, 5]);
  const [opened, allDay, closed, committed, quiet, reopened] = lanes as Lane[] as [Lane, Lane, Lane, Lane, Lane, Lane];
  // The lanes span the day, so the calendar shows exactly it.
  const D = calendarSpan(lanes, P, 1000);

  it('shows exactly the day, the lanes spanning it', () => {
    expect(D).toEqual({ ...P, endDrawn: false });
  });

  it('keeps a span opened inside the period from its opening to the right edge, its life going on after it', () => {
    expect(laneView('calendar', opened, D)).toEqual({
      beforeOpening: null,
      open: [{ from: S + 3 * H, to: E }],
      closed: [],
      activity: [],
      approvals: [],
      ending: null,
      before: false,
      after: true,
    });
  });

  it('cuts a span open all day at both edges, and keeps only the marks inside, the start in and the end out', () => {
    expect(laneView('calendar', allDay, D)).toEqual({
      beforeOpening: null,
      open: [{ from: S, to: E }],
      closed: [],
      activity: [S, E - 1],
      approvals: [S + 2 * H],
      ending: null,
      before: true,
      after: true,
    });
  });

  it('cuts a span at the left edge and ends it at a close inside the period', () => {
    expect(laneView('calendar', closed, D)).toMatchObject({
      open: [{ from: S, to: S + 6 * H }],
      ending: S + 6 * H,
      before: true,
      after: false,
    });
  });

  it('cuts the stretch before the opening at the left edge, and counts a first commit before the period as life before it', () => {
    expect(laneView('calendar', committed, D)).toMatchObject({
      beforeOpening: { from: S, to: S + H },
      open: [{ from: S + H, to: S + 20 * H }],
      ending: S + 20 * H,
      before: true,
      after: false,
    });
  });

  it('cuts the stretch before the opening at the right edge', () => {
    const later = laneModel(dataset([{ number: 1, created: E + DAY, first_commit: S + 20 * H }]), [0]).lanes[0] as Lane;
    expect(laneView('calendar', later, D)).toMatchObject({ beforeOpening: { from: S + 20 * H, to: E }, open: [], before: false, after: true });
  });

  it('draws a PR open all period with no event in it as one full-width open line with both edge marks', () => {
    expect(laneView('calendar', quiet, D)).toEqual({
      beforeOpening: null,
      open: [{ from: S, to: E }],
      closed: [],
      activity: [],
      approvals: [],
      ending: null,
      before: true,
      after: true,
    });
  });

  it('cuts a stretch closed before a reopening at either edge', () => {
    expect(laneView('calendar', reopened, D)).toMatchObject({
      open: [{ from: S + 2 * H, to: S + 20 * H }],
      closed: [
        { from: S, to: S + 2 * H },
        { from: S + 20 * H, to: E },
      ],
      before: true,
      after: true,
    });
  });

  it('cuts a lane at a left edge that is the earliest opening, not the period’s start, and says so', () => {
    // The whole window; the calendar starts at #1's opening, 1 June, and its first commit came two days before.
    const whole = periodRange({ from: '2011-09-01', to: '2026-11-15' });
    const T = at('2026-06-01T00:00:00Z');
    const two = laneModel(
      dataset([
        { number: 1, created: T, first_commit: T - 2 * DAY, state: 1, closed: T + DAY },
        { number: 2, created: T + DAY },
      ]),
      [0, 1],
    ).lanes as [Lane, Lane];
    const span = calendarSpan(two, whole, 1000);
    expect(span.start).toBe(T);
    // It ends at #2's last fetch, still open, with room after it, before the period's end.
    expect(span.end).toBeGreaterThan(META.fetched_through);
    expect(span.end).toBeLessThan(whole.end);
    const [first, second] = two.map((l) => laneView('calendar', l, span)) as [LaneView, LaneView];
    // Its first commit is not drawn, and the left edge's mark says its life went on earlier.
    expect(first).toMatchObject({ beforeOpening: null, ending: T + DAY, before: true, after: false });
    // The latest end is the right edge's, so no lane goes on later than shown.
    expect(second).toMatchObject({ ending: META.fetched_through, before: false, after: false });
    expect(describeLane(two[0], first, 'calendar')).toBe(
      'As the calendar shows it: its life goes on earlier than shown; opened 1 Jun 2026 00:00 UTC; 0 comments, reviews or bot commands; 0 approvals; merged 2 Jun 2026 00:00 UTC.',
    );
    expect(describeLanes(two, [first, second], 2, 'newest opened first', 'calendar', span)).toBe(
      'The timelines of 2 PRs, one per row, newest opened first, each drawn only within the calendar shown, 1 Jun 2026 to 15 Nov 2026, inside the period: ' +
        'from #1, opened 1 Jun 2026, to #2, opened 2 Jun 2026. ' +
        '1 goes on earlier than shown and 0 later. ' +
        'What became of them by the last fetch, shown or not: 1 merged, 0 closed unmerged, 1 still open; none was ever closed and reopened.',
    );
  });

  it('takes a merge at the period’s very end as after it', () => {
    const atEnd = laneModel(dataset([{ number: 1, created: S + H, state: 1, closed: E }]), [0]).lanes[0] as Lane;
    expect(laneView('calendar', atEnd, D)).toMatchObject({ open: [{ from: S + H, to: E }], ending: null, after: true });
  });

  it('keeps whole lives since opening, on the same lanes, whatever the period', () => {
    expect(laneView('sinceOpening', allDay, D)).toEqual({
      beforeOpening: null,
      open: [{ from: S - 10 * DAY, to: E + 5 * DAY }],
      closed: [],
      activity: [S - DAY, S, E - 1, E + DAY],
      approvals: [S + 2 * H, E],
      ending: E + 5 * DAY,
      before: false,
      after: false,
    });
    expect(laneView('sinceOpening', reopened, D)).toMatchObject({
      open: [
        { from: S - 10 * DAY, to: S - DAY },
        { from: S + 2 * H, to: S + 20 * H },
        { from: E + DAY, to: E + 2 * DAY },
      ],
      closed: [
        { from: S - DAY, to: S + 2 * H },
        { from: S + 20 * H, to: E + DAY },
      ],
      ending: E + 2 * DAY,
    });
    // What came before the opening is in the view, and the scale does not place it.
    expect(laneView('sinceOpening', committed, D).beforeOpening).toEqual({ from: S - 2 * DAY, to: S + H });
    expect(laneScale('sinceOpening', lanes, 1000, D).x(committed, S - 2 * DAY)).toBeNull();
  });

  it('describes a clipped lane by what is drawn of it, and a whole one by its whole life', () => {
    expect(describeLane(allDay, laneView('calendar', allDay, D), 'calendar')).toBe(
      'As the calendar shows it: its life goes on earlier than shown; 2 comments, reviews or bot commands; 1 approval; its life goes on later than shown.',
    );
    expect(describeLane(committed, laneView('calendar', committed, D), 'calendar')).toBe(
      'As the calendar shows it: its life goes on earlier than shown; opened 10 Jun 2026 01:00 UTC; 0 comments, reviews or bot commands; 0 approvals; merged 10 Jun 2026 20:00 UTC.',
    );
    expect(describeLane(opened, laneView('calendar', opened, D), 'calendar')).toBe(
      'As the calendar shows it: opened 10 Jun 2026 03:00 UTC; 0 comments, reviews or bot commands; 0 approvals; its life goes on later than shown.',
    );
    expect(describeLane(reopened, laneView('calendar', reopened, D), 'calendar')).toBe(
      'As the calendar shows it: its life goes on earlier than shown; closed before a reopening twice; 0 comments, reviews or bot commands; 0 approvals; its life goes on later than shown.',
    );
    expect(describeLane(allDay, laneView('sinceOpening', allDay, D), 'sinceOpening')).toBe(
      'Its whole life, from its opening: opened 31 May 2026 00:00 UTC; 4 comments, reviews or bot commands; 2 approvals; merged 16 Jun 2026 00:00 UTC.',
    );
    expect(describeLane(opened, laneView('sinceOpening', opened, D), 'sinceOpening')).toBe(
      'Its whole life, from its opening: opened 10 Jun 2026 03:00 UTC; 0 comments, reviews or bot commands; 0 approvals; still open at the last fetch, 15 Nov 2026 06:00 UTC.',
    );
  });

  it('says in its summary what is drawn in each mode, and that its outcomes are what became of the PRs by the last fetch', () => {
    const views = (mode: LaneMode) => lanes.map((l) => laneView(mode, l, D));
    expect(describeLanes(lanes, views('calendar'), 6, 'newest opened first', 'calendar', D)).toBe(
      'The timelines of 6 PRs, one per row, newest opened first, each drawn only within the calendar shown, 10 Jun 2026, inside the period: ' +
        'from #56146, opened 10 Jun 2026, to #55600, opened 31 May 2026. ' +
        '5 go on earlier than shown and 4 later. ' +
        'What became of them by the last fetch, shown or not: 4 merged, 1 closed unmerged, 1 still open; 2 were ever closed and reopened.',
    );
    expect(describeLanes([committed], [laneView('calendar', committed, D)], 1, 'newest opened first', 'calendar', D)).toMatch(
      / 1 goes on earlier than shown and 0 later\. .*: 1 merged, 0 closed unmerged, 0 still open; none was ever closed and reopened\.$/,
    );
    expect(describeLanes(lanes, views('sinceOpening'), 6, 'newest opened first', 'sinceOpening', D)).toBe(
      'The whole timelines of 6 PRs, one per row, newest opened first, each from its opening, whatever the period: ' +
        'from #56146, opened 10 Jun 2026, to #55600, opened 31 May 2026. ' +
        'What became of them by the last fetch: 4 merged, 1 closed unmerged, 1 still open; 2 were ever closed and reopened.',
    );
  });
});

describe('lanePitch and laneAt', () => {
  it('draws few lanes taller than many', () => {
    expect(lanePitch(10)).toBeGreaterThan(lanePitch(200));
    expect(lanePitch(200) * 200).toBeLessThanOrEqual(1200);
  });

  it('finds the lane under a point, or none', () => {
    expect(laneAt(0, 6, 3)).toBe(0);
    expect(laneAt(17.9, 6, 3)).toBe(2);
    expect(laneAt(18, 6, 3)).toBeNull();
    expect(laneAt(-1, 6, 3)).toBeNull();
  });
});

describe('describeLanes and lanesLine', () => {
  it('says what the lanes show', () => {
    const data = fixture();
    const order = byOpening(data, all(data));
    const { lanes, total } = laneModel(data, order);
    // The whole window, 15 May to 15 November 2026: #64010 opened before it.
    const period = periodRange({ from: '2026-05-15', to: '2026-11-15' });
    const span = calendarSpan(lanes, period, 1000);
    const views = lanes.map((l) => laneView('calendar', l, span));
    expect(describeLanes(lanes, views, total, 'newest opened first', 'calendar', span)).toBe(
      'The timelines of 12 PRs, one per row, newest opened first, each drawn only within the calendar shown, 15 May 2026 to 15 Nov 2026, inside the period: ' +
        'from #67250, opened 10 Nov 2026, to #64010, opened 3 Nov 2025. ' +
        '4 go on earlier than shown and 0 later. ' +
        'What became of them by the last fetch, shown or not: 6 merged, 1 closed unmerged, 5 still open; 1 was ever closed and reopened.',
    );
  });

  it('says which PRs the lanes show, how many and in what order, whatever their count', () => {
    const order = 'in the PR table’s order, by Opened, descending';
    expect(lanesLine(200, 4279, 'open at some point in the period', order, true)).toBe(
      'The 200 most recently opened of 4,279 PRs open at some point in the period, in the PR table’s order, by Opened, descending.',
    );
    expect(lanesLine(200, 4279, 'open at some point in the period', 'in the PR table’s order, by Size, descending', false)).toBe(
      'The first 200 in the PR table’s order, by Size, descending, of 4,279 PRs open at some point in the period.',
    );
    expect(lanesLine(12, 12, 'open at some point in the period', order, true)).toBe(
      '12 PRs open at some point in the period, in the PR table’s order, by Opened, descending.',
    );
    expect(lanesLine(1, 1, 'opened in the week of 2026-05-18', order, true)).toBe(
      '1 PR opened in the week of 2026-05-18, in the PR table’s order, by Opened, descending.',
    );
  });
});
