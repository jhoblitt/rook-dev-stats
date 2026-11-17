import { describe, expect, it } from 'vitest';
import { type BackportLink, type Target, periodRange } from './filters';
import {
  capacityLegend,
  capacityModel,
  capacityNote,
  capacityNothing,
  capacityPanels,
  describeCapacity,
  formatRatio,
  commandFigures,
  commandSummary,
  commandsModel,
  curveModel,
  curveNothing,
  curveQuantiles,
  reviewerShareText,
  reviewsModel,
  reviewsRecordedNote,
  REVIEWS_RECORDED_FROM,
  BUSIEST_COMMANDS,
  onlyBackports,
  spanNote,
  spanTitle,
  waitingSeries,
  waitsModel,
  waitsNothing,
} from './review';
import { openedIn, select } from './select';
import { defaultFilters } from './state';
import { commandUse } from './stats/commands';
import { outcomeCurve } from './stats/curve';
import { bucketHead, bucketReadout, bucketTable, coverage } from './charts';
import { awaitingResponse } from './stats/backlog';
import { type Capacity, capacity } from './stats/capacity';
import { META, at, fixture } from './stats/testing';
import { COLOURS } from './colours';
import { weekly } from './stats/weekly';

/** What a capacity chart's partial week says beside its coverage. */
const PARTIAL_NOTE =
  "each ratio divides two partial counts; the PRs waiting are counted at the week's end, " +
  "or at the period's end or the data's last fetch if sooner";

// The default view: PRs on master, 2026-05-15 to 2026-11-15, 27 weeks from 2026-05-11.
const data = fixture();
const filters = defaultFilters(META);
const period = periodRange(filters);
const rows = select(data, filters);
// #66500, #66510, #66600, #66700, #66900, #67000, #67100.
const opened = openedIn(data, rows, period);

/** 27 weekly values of `fill`, with the given weeks set. */
function weeks<T>(set: Record<number, T>, fill: T): T[] {
  return Array.from({ length: 27 }, (_, i) => (i in set ? (set[i] as T) : fill));
}

describe('capacity on the fixture', () => {
  const c = capacity(
    weekly(data, rows, period, 'opened'),
    weekly(data, rows, period, 'reviews'),
    weekly(data, rows, period, 'reviewers'),
    awaitingResponse(data, rows, period),
  );
  // The first week holds 3 of its 7 days, the last 6 (fetched Sunday 06:00).
  const partial = coverage(c.week, c.step, period, META.fetched_through);

  it('divides the PRs opened by the people giving reviews, with no value where no one reviewed', () => {
    // Opened: 05-18 two, 06-01, 06-15, 07-06, 08-03, 08-31 one each.
    // Reviewing: 05-18 one, 06-08 two, 06-29, 08-03, 08-10, 08-24, 09-14 one each.
    expect(c.openedPerReviewer).toEqual(weeks({ 1: 2, 4: 0, 7: 0, 12: 1, 13: 0, 15: 0, 18: 0 }, null));
  });

  it('divides the human reviews by the PRs opened, with no value where none was opened', () => {
    expect(c.reviewsPerOpened).toEqual(weeks({ 1: 0.5, 3: 0, 5: 0, 8: 0, 12: 1, 16: 0 }, null));
  });

  it('counts the PRs waiting for a first response at the end of each week', () => {
    // 05-18: #66100, answered 05-20. 05-25 and 06-01: #66510, never answered, closed 06-01 09:00.
    // 06-08: #66600, answered 06-10. Every other PR was answered within its first week end,
    // or (the draft #66700) never ready.
    expect(c.waiting).toEqual(weeks({ 0: 1, 1: 1, 2: 1, 3: 1 }, 0));
  });

  it('draws people giving reviews, the two ratios and the PRs waiting in neutral ink, apart by marker, the counts carried undrawn', () => {
    const model = capacityModel(c);
    expect(model.lines.map((l) => [l.key, l.label, l.color, l.shape, l.undrawn === true])).toEqual([
      ['reviewers', 'people giving reviews', COLOURS.statistic, 'square', false],
      ['opened', 'PRs opened', COLOURS.statistic, 'circle', true],
      ['openedPerReviewer', 'PRs opened per person giving reviews', COLOURS.statistic, 'circle', false],
      ['reviews', 'human reviews', COLOURS.statistic, 'circle', true],
      ['reviewsPerOpened', 'human reviews per PR opened', COLOURS.statistic, 'triangle', false],
      ['waiting', 'PRs waiting for a first response', COLOURS.statistic, 'diamond', false],
    ]);
    expect(model.bars).toEqual([]);
    expect(model.lines[2]?.missing?.[3]).toBe('no one giving reviews');
    expect(model.lines[4]?.missing?.[2]).toBe('no PRs opened');
    expect(model.lines[2]?.missing?.[1]).toBeNull();
    expect(model.lines[5]?.missing).toBeUndefined();
  });

  it('stacks four panels with at least three ticks each, the last a count of PRs waiting', () => {
    expect(capacityPanels('week')).toEqual([
      { keys: ['reviewers'], unit: 'people giving reviews per week', minTicks: 3 },
      { keys: ['openedPerReviewer'], unit: 'PRs opened per person giving reviews', minTicks: 3 },
      { keys: ['reviewsPerOpened'], unit: 'human reviews per PR opened', minTicks: 3 },
      {
        keys: ['waiting'],
        unit: 'PRs waiting for a first response, at the end of each week',
        narrowUnit: "PRs waiting for a first response, at week's end",
        minTicks: 3,
      },
    ]);
    expect(capacityNote('week')).toBe(
      '"Human reviews per PR opened" compares two flows of the same week, not one group of PRs followed over time: ' +
        'the human reviews done that week, on any selected PR, against the PRs opened that week.',
    );
  });

  it('says in a partial week that each ratio divides two partial counts, and when the PRs waiting are counted', () => {
    const model = { ...capacityModel(c), partial };
    expect(bucketHead(model, 0)).toBe(`week of 2026-05-11, partial: 3 of 7 days; ${PARTIAL_NOTE}`);
    expect(bucketTable(model, formatRatio).rows[0]?.head).toBe(
      `week of 2026-05-11, partial: 3 of 7 days; ${PARTIAL_NOTE}`,
    );
  });

  it('tabulates the four values and the counts each ratio came from, one row a week', () => {
    const t = bucketTable({ ...capacityModel(c), partial }, formatRatio);
    expect(t.columns).toEqual([
      'Week',
      'people giving reviews',
      'PRs opened',
      'PRs opened per person giving reviews',
      'human reviews',
      'human reviews per PR opened',
      'PRs waiting for a first response',
    ]);
    expect(t.rows[1]?.cells).toEqual(['1', '2', '2', '1', '0.5', '1']);
    expect(t.rows[3]?.cells).toEqual(['0', '1', 'no one giving reviews', '0', '0', '1']);
    expect(t.rows[4]?.cells).toEqual(['2', '0', '0', '2', 'no PRs opened', '0']);
  });

  it('keys only the partial week, each panel title naming its line, and gives the undrawn counts no key in the readout', () => {
    const model = { ...capacityModel(c), partial };
    expect(capacityLegend(model)).toEqual([
      // Drawn as the lone hollow marker it explains, after the first panel's square.
      { label: 'partial week', mark: 'partial', color: COLOURS.statistic, shape: 'square' },
    ]);
    expect(capacityLegend(capacityModel(c))).toEqual([]);
    const readout = bucketReadout(model, 1, formatRatio);
    expect(readout.filter((r) => r.color === null).map((r) => r.label)).toEqual(['PRs opened', 'human reviews']);
  });

  it('states the people giving reviews, the gaps once each and the partial weeks as its text alternative', () => {
    expect(describeCapacity(c, partial)).toBe(
      'By week, 27 weeks from 2026-05-11 to 2026-11-09. People giving reviews: from 0 to 2 a full week. ' +
        'No one giving reviews in 20 weeks. No PRs opened in 21 weeks. ' +
        "Partial, each ratio dividing two partial counts and the PRs waiting counted at the week's end, " +
        "or at the period's end or the data's last fetch if sooner: " +
        'week of 2026-05-11, partial: 3 of 7 days; week of 2026-11-09, partial: 6 of 7 days.',
    );
  });

  it('draws the chart when some full week has a PR opened', () => {
    expect(capacityNothing(c, partial)).toBeNull();
  });
});

describe('capacityNothing', () => {
  const W = [at('2026-06-01T00:00:00Z'), at('2026-06-08T00:00:00Z'), at('2026-06-15T00:00:00Z')];
  const counts = (opened: number[]): Capacity => ({
    week: W,
    step: 'week',
    opened,
    reviews: [1, 1, 1],
    reviewers: [1, 1, 1],
    waiting: [2, 2, 2],
    openedPerReviewer: opened,
    reviewsPerOpened: opened.map((n) => (n === 0 ? null : 1 / n)),
  });
  const ends = [{ days: 3, of: 7 }, null, { days: 2, of: 7 }];

  it('says no PR was opened in a period with PRs active but none opened', () => {
    expect(capacityNothing(counts([0, 0, 0]), ends)).toBe(
      'no PR was opened in this period, so there are no arrivals to set review against',
    );
  });

  it('says no PR was opened in any full week when only the partial weeks had some', () => {
    expect(capacityNothing(counts([2, 0, 1]), ends)).toBe(
      'no PR was opened in any full week of this period, so there are no arrivals to set review against',
    );
  });

  it('draws a period with no full week at all, from what its partial weeks have', () => {
    const two = { ...counts([2, 1]), week: W.slice(0, 2) };
    expect(capacityNothing(two, [{ days: 3, of: 7 }, { days: 2, of: 7 }])).toBeNull();
  });

  it('leaves an empty selection to "no PRs match"', () => {
    expect(capacityNothing({ ...counts([]), week: [] }, [])).toBeNull();
  });
});

describe('formatRatio', () => {
  it('writes a whole number as a count and anything else to two decimals', () => {
    expect([2, 0, 0.5, 1 / 3, 1.5, 0.25, 1234].map(formatRatio)).toEqual(['2', '0', '0.5', '0.33', '1.5', '0.25', '1,234']);
  });
});

describe('reviewsModel', () => {
  it('stacks human reviews under bot reviews', () => {
    const model = reviewsModel(weekly(data, rows, period, 'reviews'));
    expect(model.bars.map((b) => [b.label, b.color])).toEqual([
      ['human reviews', COLOURS.humanReviews],
      ['bot reviews', COLOURS.botReviews],
    ]);
    expect(model.stackLabel).toBe('reviews');
    // #66500 on 05-18, #67000 on 08-06.
    expect(model.bars[1]?.values).toEqual(weeks({ 1: 1, 12: 1 }, 0));
  });
});

describe('waitsModel', () => {
  const model = waitsModel(
    weekly(data, rows, period, waitingSeries('merge')),
    weekly(data, rows, period, 'opened'),
    'merge',
  );

  it('draws the median solid and the 90th percentile dashed, both in neutral ink', () => {
    expect(model.lines.map((l) => [l.key, l.label, l.color, l.shape, l.dashed === true])).toEqual([
      ['0.5', 'median', COLOURS.statistic, 'circle', false],
      ['0.9', '90th percentile', COLOURS.statistic, 'square', true],
    ]);
  });

  it('reads each week opened off its own curve', () => {
    // 05-18: #66500 merged after 97 hours, #66510 closed unmerged.
    expect(model.lines[0]?.values[1]).toBeCloseTo(97 / 24, 9);
    // #66900 merged after 48 days, #67000 after 13, #67100 after 24.
    expect([8, 12, 16].map((i) => model.lines[0]?.values[i])).toEqual([48, 13, 24]);
    expect([8, 12, 16].map((i) => model.lines[1]?.values[i])).toEqual([48, 13, 24]);
  });

  it('says a quantile is not reached when the week has finished short of it, with the share merged', () => {
    // 05-18: both PRs finished, half merged; nine in ten can never merge.
    expect(model.lines[1]?.values[1]).toBeNull();
    expect(model.lines[1]?.missing?.[1]).toBe('not reached: 50% merged');
    expect(model.lines[1]?.unreached).toEqual(weeks({ 1: true }, false));
    expect(model.shade?.[1]).toBe(false);
  });

  it('says a quantile is not yet known while PRs still wait, and shades only those weeks', () => {
    // 06-01: #66600 still open; 06-15: the draft #66700, still open.
    expect([3, 5].map((i) => model.lines[0]?.missing?.[i])).toEqual(['not yet known', 'not yet known']);
    expect(model.shade).toEqual(weeks({ 3: true, 5: true }, false));
    expect(model.shadeLabel).toBe('not yet known');
  });

  it('tells a week with no PRs opened from either', () => {
    expect(model.notes).toEqual(weeks({ 1: null, 3: null, 5: null, 8: null, 12: null, 16: null }, 'no PRs opened'));
  });

  it('says a week whose PRs cannot be measured has none to measure, not that none were opened', () => {
    // 06-15 opened only the draft #66700, never ready: no response wait to measure.
    const response = waitsModel(
      weekly(data, rows, period, waitingSeries('response')),
      weekly(data, rows, period, 'opened'),
      'response',
    );
    expect(response.notes?.[5]).toBe('no PR to measure');
  });
});

describe('curveModel and curveQuantiles', () => {
  const curve = outcomeCurve(data, opened, 'merge');
  const model = curveModel(curve, 'merge');

  it('names each outcome, and colours it by its role, what remains last', () => {
    expect(model.series.map((s) => [s.key, s.label, s.color, s.shape, s.remains])).toEqual([
      ['merged', 'merged', COLOURS.reached, 'circle', false],
      ['closed', 'closed unmerged', COLOURS.finishedWithout, 'square', false],
      ['open', 'still open', COLOURS.waiting, 'triangle', true],
    ]);
    expect(model.days).toBe(curve.days);
  });

  it('reads the median, and says the 90th percentile is not reached, with the share merged', () => {
    // Of seven, four merged (after 4, 13, 24 and 48 days), one closed and two still open:
    // 4/7 merged plus 2/7 open is 6/7, short of nine in ten.
    expect(curveQuantiles(curve, 'merge')).toEqual({ median: '48 days', p90: 'not reached: 57% merged' });
  });

  it('says a quantile is not yet known while enough PRs still wait', () => {
    // #66500 merged after 4 days; #66600 and the draft #66700 still open: two in three can still merge.
    const three = outcomeCurve(data, Uint32Array.of(3, 5, 6), 'merge');
    expect(curveQuantiles(three, 'merge')).toEqual({ median: 'not yet known', p90: 'not yet known' });
  });

  it('colours a single outcome as reached', () => {
    const first = curveModel(outcomeCurve(data, opened, 'firstCommitToOpened'), 'firstCommitToOpened');
    expect(first.series.map((s) => [s.label, s.color, s.remains])).toEqual([['opened', COLOURS.reached, false]]);
    const last = curveModel(outcomeCurve(data, opened, 'openedToLastCommit'), 'openedToLastCommit');
    expect(last.series.map((s) => s.label)).toEqual(['last commit made']);
  });

  it('labels the outcomes of every span', () => {
    expect(curveModel(outcomeCurve(data, opened, 'response'), 'response').series.map((s) => s.label)).toEqual([
      'responded',
      'finished without a response',
      'still waiting',
    ]);
    expect(curveModel(outcomeCurve(data, opened, 'approval'), 'approval').series.map((s) => s.label)).toEqual([
      'approved',
      'finished without an approval',
      'still waiting',
    ]);
  });
});

describe('curveNothing', () => {
  it('says no PR was opened when none was', () => {
    expect(curveNothing('afterApproval', 0)).toBe('no PR was opened in this period');
  });

  it('says what the span lacks when PRs were opened', () => {
    expect(curveNothing('afterApproval', 3)).toBe('no PR opened in this period has been approved');
    expect(curveNothing('response', 3)).toBe('no PR opened in this period has been ready for review');
    expect(curveNothing('firstCommitToOpened', 3)).toBe(
      'no PR opened in this period has a known first commit before its opening',
    );
  });
});

describe('waitsNothing', () => {
  const opened = weekly(data, rows, period, 'opened');

  it('has nothing to say while some week has a wait to draw', () => {
    expect(waitsNothing(waitsModel(weekly(data, rows, period, waitingSeries('merge')), opened, 'merge'), 'merge', 7)).toBeNull();
  });

  it('says what the waits lack, in the curve\'s words, when no week has anything to measure', () => {
    // Of the default PRs only the draft #66700 (06-15) was never ready: a selection of it
    // alone has PRs opened but no response wait anywhere.
    const draft = Uint32Array.of(6);
    const model = waitsModel(
      weekly(data, draft, period, waitingSeries('response')),
      weekly(data, draft, period, 'opened'),
      'response',
    );
    expect(waitsNothing(model, 'response', 1)).toBe('no PR opened in this period has been ready for review');
  });

  it('says no PR was opened when none was', () => {
    const none = waitsModel(weekly(data, new Uint32Array(0), period, waitingSeries('merge')), opened, 'merge');
    expect(waitsNothing(none, 'merge', 0)).toBe('no PR was opened in this period');
  });
});

describe('reviewsRecordedNote', () => {
  it('says nothing over the default period', () => {
    expect(reviewsRecordedNote(defaultFilters(META))).toBeNull();
  });

  it('says that the figures understate review before reviews were recorded, and what first responses count then, for a period from 2014', () => {
    expect(reviewsRecordedNote({ from: '2014-01-01', to: '2026-11-15' })).toBe(
      'GitHub recorded no reviews of pull requests before 14 Sep 2016, and this period starts earlier. In the Review, AI use and People sections, its figures about reviews, approvals and reviewers understate review before that day, and its first responses count only comments then, not reviews.',
    );
  });

  it('starts saying it on the first day before reviews were recorded', () => {
    expect(at('2016-09-14T00:00:00Z')).toBe(REVIEWS_RECORDED_FROM);
    expect(reviewsRecordedNote({ from: '2016-09-14', to: '2017-12-31' })).toBeNull();
    expect(reviewsRecordedNote({ from: '2016-09-13', to: '2017-12-31' })).not.toBeNull();
  });
});

describe('spanTitle and spanNote', () => {
  const only = (target: Target, backportLink: BackportLink | null) => ({ target, backportLink });

  it('calls the first span the original work to the backport only when every PR selected links the one it backports', () => {
    expect(spanTitle('firstCommitToOpened', true)).toBe('Original work to backport opened');
    expect(spanTitle('firstCommitToOpened', false)).toBe('First commit to opened');
    expect(spanTitle('openedToLastCommit', true)).toBe('Opened to last commit');
    expect(spanTitle('afterLastCommit', true)).toBe('Last commit to final disposition');
  });

  it.each([
    ['master', 'linked', true],
    ['backports', 'linked', true],
    ['all', 'linked', true],
    ['backports', null, false],
    ['backports', 'unlinked', false],
    ['all', null, false],
    ['master', null, false],
  ] satisfies [Target, BackportLink | null, boolean][])(
    'takes the selection under %s with the backport link %s for backports alone: %s',
    (target, link, expected) => {
      expect(onlyBackports(only(target, link))).toBe(expected);
    },
  );

  it('notes what a backport’s first commit is wherever backports may be among others, never under master', () => {
    const note = 'For a backport, the first commit is the original work’s, so this is how long after it the backport was opened.';
    expect(spanNote('firstCommitToOpened', only('all', null))).toBe(note);
    expect(spanNote('firstCommitToOpened', only('backports', null))).toBe(note);
    expect(spanNote('firstCommitToOpened', only('backports', 'unlinked'))).toBe(note);
    expect(spanNote('firstCommitToOpened', only('master', null))).toBeUndefined();
    expect(spanNote('firstCommitToOpened', only('master', 'unlinked'))).toBeUndefined();
    expect(spanNote('firstCommitToOpened', only('backports', 'linked'))).toBeUndefined();
    expect(spanNote('firstCommitToOpened', only('master', 'linked'))).toBeUndefined();
    expect(spanNote('openedToLastCommit', only('all', null))).toBeUndefined();
  });
});

describe('commands', () => {
  it('keeps the commands used, the most used first', () => {
    const w = {
      week: [at('2026-05-11T00:00:00Z'), at('2026-05-18T00:00:00Z')],
      step: 'week' as const,
      values: { 'mergify-backport': [1, 0], 'dependabot-rebase': [2, 1], unused: [0, 0] },
    };
    const names = [...META.commands, { id: 'unused', name: 'unused' }];
    const model = commandsModel(w, names);
    expect(model.bars.map((b) => [b.key, b.label, b.color, b.values])).toEqual([
      ['dependabot-rebase', '@dependabot rebase', COLOURS.command, [2, 1]],
      ['mergify-backport', '@mergifyio backport', COLOURS.command, [1, 0]],
    ]);
  });

  it('orders commands used equally often by name', () => {
    const w = {
      week: [at('2026-05-11T00:00:00Z')],
      step: 'week' as const,
      values: { b: [2], c: [1], a: [1], d: [5] },
    };
    const names = ['b', 'c', 'a', 'd'].map((id) => ({ id, name: `cmd ${id}` }));
    expect(commandsModel(w, names).bars.map((b) => b.key)).toEqual(['d', 'b', 'a', 'c']);
    expect(BUSIEST_COMMANDS).toBe(6);
  });

  it('counts the commands of the fixture by week', () => {
    const model = commandsModel(weekly(data, rows, period, 'commands'), META.commands);
    // One `@mergifyio backport` on #66500, on 05-20.
    expect(model.bars.map((b) => [b.key, b.values])).toEqual([['mergify-backport', weeks({ 1: 1 }, 0)]]);
  });

  it('writes the share of PRs with a command and the commands on merged PRs', () => {
    // Of seven opened, #66500 had one; merged #66500, #66900, #67000 and #67100 took 1, 0, 0, 0.
    const figures = commandFigures(commandUse(data, opened));
    expect(figures).toEqual({ share: '14%', merged: { mean: '0.3', median: '0', p90: '1' } });
    expect(commandFigures({ share: 0.5, merged: null })).toEqual({ share: '50%', merged: null });
    expect(commandFigures({ share: null, merged: null })).toEqual({ share: null, merged: null });
  });

  it('states the counts and the figures', () => {
    const model = commandsModel(weekly(data, rows, period, 'commands'), META.commands);
    const figures = commandFigures(commandUse(data, opened));
    expect(commandSummary(model, figures)).toBe(
      'By week, 27 weeks from 2026-05-11 to 2026-11-09. 1 @mergifyio backport, at most 1 in a week (week of 2026-05-18). ' +
        '14% of the PRs opened in the period had a bot command. ' +
        'Bot commands on merged PRs: mean 0.3, median 0, 90th percentile 1.',
    );
    expect(commandSummary(model, { share: '0%', merged: null })).toMatch(/had a bot command\. No PR opened in the period has merged\.$/);
  });
});

describe('reviewerShareText', () => {
  it('states the share of the ten busiest of more reviewers, with no names', () => {
    expect(reviewerShareText({ reviewers: 25, share: 0.8 })).toBe(
      'The ten busiest of 25 reviewers did 80% of the human reviews in this period.',
    );
  });

  it('says how many people did all of the reviews when there were ten or fewer', () => {
    expect(reviewerShareText({ reviewers: 4, share: 1 })).toBe('4 people did all of the human reviews in this period.');
    expect(reviewerShareText({ reviewers: 10, share: 1 })).toBe('10 people did all of the human reviews in this period.');
    expect(reviewerShareText({ reviewers: 1, share: 1 })).toBe('1 person did all of the human reviews in this period.');
  });

  it('says what share they did when deleted accounts made the rest', () => {
    expect(reviewerShareText({ reviewers: 3, share: 0.9 })).toBe('3 people did 90% of the human reviews in this period.');
  });

  it('states that there were no reviews rather than a share of none', () => {
    expect(reviewerShareText({ reviewers: 0, share: null })).toBe('There were no reviews in this period.');
  });

  it('says the reviews came from deleted accounts rather than that no one made them', () => {
    expect(reviewerShareText({ reviewers: 0, share: 0 })).toBe(
      'The human reviews in this period came from accounts that no longer exist.',
    );
  });
});
