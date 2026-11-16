import { describe, expect, it } from 'vitest';
import { DAY } from '../filters';
import { awaitingResponse } from './backlog';
import { capacity, ratio } from './capacity';
import { all, at, dataset } from './testing';
import { weekly } from './weekly';

const WEEKS = [at('2026-06-01T00:00:00Z'), at('2026-06-08T00:00:00Z'), at('2026-06-15T00:00:00Z')];

describe('ratio', () => {
  it('divides week by week, with no value where the divisor is zero', () => {
    expect(ratio([6, 0, 4, 0], [3, 0, 0, 5])).toEqual([2, null, null, 0]);
  });
});

describe('capacity', () => {
  it('sets the PRs opened against the people reviewing, and the reviews against the PRs opened', () => {
    const c = capacity(
      { week: WEEKS, step: 'week', values: { disclosed: [1, 0, 2], 'not-disclosed': [5, 0, 2] } },
      { week: WEEKS, step: 'week', values: { human: [9, 2, 0], bot: [4, 4, 4] } },
      { week: WEEKS, step: 'week', values: { reviewers: [3, 0, 2] } },
      { week: WEEKS, step: 'week', values: { waiting: [3, 1, 4] } },
    );
    expect(c).toEqual({
      week: WEEKS,
      step: 'week',
      opened: [6, 0, 4],
      reviews: [9, 2, 0],
      reviewers: [3, 0, 2],
      waiting: [3, 1, 4],
      // Week 2: no one giving reviews, so no PRs per person.
      openedPerReviewer: [2, null, 2],
      // Week 2: no PRs opened, so no reviews per PR; week 3: none of four reviewed.
      reviewsPerOpened: [1.5, null, 0],
    });
  });

  it('is empty for an empty selection', () => {
    const none = { week: [], step: 'week' as const, values: {} };
    expect(capacity(none, none, none, none)).toEqual({
      week: [],
      step: 'week',
      opened: [],
      reviews: [],
      reviewers: [],
      waiting: [],
      openedPerReviewer: [],
      reviewsPerOpened: [],
    });
  });

  it('keeps the pile waiting for a first response in weeks with no PR opened', () => {
    const [W1, W2, W3] = WEEKS as [number, number, number];
    const period = { start: W1, end: W3 + 7 * DAY };
    // Both opened in week 1; one answered in week 2, the other never.
    const data = dataset([{ created: W1, first_response: W2 + DAY }, { created: W1 }]);
    const rows = all(data);
    const c = capacity(
      weekly(data, rows, period, 'opened'),
      weekly(data, rows, period, 'reviews'),
      weekly(data, rows, period, 'reviewers'),
      awaitingResponse(data, rows, period),
    );
    expect(c.opened).toEqual([2, 0, 0]);
    expect(c.waiting).toEqual([2, 1, 1]);
    expect(c.reviewsPerOpened).toEqual([0, null, null]);
  });
});
