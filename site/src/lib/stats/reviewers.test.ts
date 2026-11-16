import { describe, expect, it } from 'vitest';
import { DAY } from '../filters';
import { reviewLoad, reviewerShare } from './reviewers';
import { type Event, all, at, dataset } from './testing';

const W1 = at('2026-06-01T00:00:00Z');
const PERIOD = { start: W1, end: W1 + 14 * DAY };

// Person 0 made 5 reviews, person 1 made 3, person 2 made 2.
const human: Event[] = [0, 0, 0, 0, 0, 1, 1, 1, 2, 2].map((actor, i) => ({
  pr: i % 2,
  at: W1 + i * 3600,
  kind: ['review_approved', 'review_changes', 'review_commented'][i % 3] as string,
  actor,
}));
const other: Event[] = [
  { pr: 0, at: W1 + DAY, kind: 'bot_review' },
  { pr: 0, at: W1 + DAY, kind: 'comment_other', actor: 3 },
  { pr: 0, at: W1 + DAY, kind: 'comment_other', actor: 3 },
  { pr: 1, at: W1 - 1, kind: 'review_approved', actor: 4 },
  { pr: 1, at: PERIOD.end, kind: 'review_approved', actor: 4 },
];
const data = dataset([{ created: W1 }, { created: W1 }], [...human, ...other]);

describe('reviewerShare', () => {
  it('is the share of human reviews in the period made by the busiest people', () => {
    expect(reviewerShare(data, all(data), PERIOD, 1)).toBeCloseTo(0.5, 12);
    expect(reviewerShare(data, all(data), PERIOD, 2)).toBeCloseTo(0.8, 12);
    expect(reviewerShare(data, all(data), PERIOD, 10)).toBe(1);
  });

  it('counts only the reviews on the rows selected', () => {
    // Row 1 holds the odd-numbered reviews: persons 0, 0, 1, 1, 2.
    expect(reviewerShare(data, Uint32Array.of(1), PERIOD, 1)).toBeCloseTo(0.4, 12);
  });

  it('is null when there is no review to share', () => {
    expect(reviewerShare(data, new Uint32Array(0), PERIOD, 10)).toBeNull();
    expect(reviewerShare(data, all(data), { start: PERIOD.end + DAY, end: PERIOD.end + 2 * DAY }, 10)).toBeNull();
  });
});

describe('reviewLoad', () => {
  it('counts the people who made the period\'s human reviews, beside the share of the busiest', () => {
    // Persons 0, 1 and 2 reviewed in the period; person 3 only commented, person 4 reviewed outside it.
    expect(reviewLoad(data, all(data), PERIOD, 2)).toEqual({ reviewers: 3, share: reviewerShare(data, all(data), PERIOD, 2) });
    expect(reviewLoad(data, all(data), PERIOD, 10)).toEqual({ reviewers: 3, share: 1 });
  });

  it('counts only the reviews on the rows selected', () => {
    // Row 1 holds the odd-numbered reviews: persons 0, 0, 1, 1, 2.
    expect(reviewLoad(data, Uint32Array.of(1), PERIOD, 1)).toEqual({ reviewers: 3, share: 0.4 });
  });

  it('has no reviewers and no share without a review', () => {
    expect(reviewLoad(data, new Uint32Array(0), PERIOD, 10)).toEqual({ reviewers: 0, share: null });
  });
});
