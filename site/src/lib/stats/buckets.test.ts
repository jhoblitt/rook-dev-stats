import { describe, expect, it } from 'vitest';
import { DAY } from '../filters';
import { bucketEnd, bucketOf, bucketStart, buckets, stepFor } from './buckets';
import { at } from './testing';

describe('stepFor', () => {
  const start = at('2026-01-05T00:00:00Z');

  it('is a week for a period of up to 53 weeks', () => {
    expect(stepFor({ start, end: start + DAY })).toBe('week');
    expect(stepFor({ start, end: start + 53 * 7 * DAY })).toBe('week');
  });

  it('is a month beyond 53 weeks', () => {
    expect(stepFor({ start, end: start + 53 * 7 * DAY + DAY })).toBe('month');
  });
});

describe('bucketStart', () => {
  it('puts Sunday 23:59:59 and the Monday after in different weeks', () => {
    expect(bucketStart(at('2026-06-07T23:59:59Z'), 'week')).toBe(at('2026-06-01T00:00:00Z'));
    expect(bucketStart(at('2026-06-08T00:00:00Z'), 'week')).toBe(at('2026-06-08T00:00:00Z'));
  });

  it('finds the Monday before the epoch, a Thursday', () => {
    expect(bucketStart(0, 'week')).toBe(at('1969-12-29T00:00:00Z'));
  });

  it('is the first of the month for a month', () => {
    expect(bucketStart(at('2026-02-28T12:00:00Z'), 'month')).toBe(at('2026-02-01T00:00:00Z'));
  });
});

describe('bucketEnd', () => {
  it('is a week or a calendar month later', () => {
    expect(bucketEnd(at('2026-06-01T00:00:00Z'), 'week')).toBe(at('2026-06-08T00:00:00Z'));
    expect(bucketEnd(at('2026-02-01T00:00:00Z'), 'month')).toBe(at('2026-03-01T00:00:00Z'));
    expect(bucketEnd(at('2026-12-01T00:00:00Z'), 'month')).toBe(at('2027-01-01T00:00:00Z'));
  });
});

describe('buckets', () => {
  it('lists the weeks that overlap the period', () => {
    const b = buckets({ start: at('2026-05-15T00:00:00Z'), end: at('2026-06-02T00:00:00Z') });
    expect(b.step).toBe('week');
    expect(b.starts).toEqual(['2026-05-11', '2026-05-18', '2026-05-25', '2026-06-01'].map((d) => at(`${d}T00:00:00Z`)));
  });

  it('lists the months that overlap a period over 53 weeks', () => {
    const b = buckets({ start: at('2025-05-15T00:00:00Z'), end: at('2026-07-01T00:00:00Z') });
    expect(b.step).toBe('month');
    expect(b.starts).toHaveLength(14);
    expect(b.starts[0]).toBe(at('2025-05-01T00:00:00Z'));
    expect(b.starts[13]).toBe(at('2026-06-01T00:00:00Z'));
  });
});

describe('bucketOf', () => {
  const weeks = buckets({ start: at('2026-06-03T00:00:00Z'), end: at('2026-06-17T00:00:00Z') });
  const months = buckets({ start: at('2025-01-01T00:00:00Z'), end: at('2026-03-01T00:00:00Z') });

  it('finds the bucket of a time inside the period', () => {
    expect(bucketOf(weeks, at('2026-06-03T00:00:00Z'))).toBe(0);
    expect(bucketOf(weeks, at('2026-06-08T00:00:00Z'))).toBe(1);
    expect(bucketOf(weeks, at('2026-06-16T23:59:59Z'))).toBe(2);
    expect(bucketOf(months, at('2025-12-31T23:59:59Z'))).toBe(11);
    expect(bucketOf(months, at('2026-02-01T00:00:00Z'))).toBe(13);
  });

  it('is -1 outside the period, even inside a bucket that overlaps it', () => {
    expect(bucketOf(weeks, at('2026-06-02T23:59:59Z'))).toBe(-1);
    expect(bucketOf(weeks, at('2026-06-17T00:00:00Z'))).toBe(-1);
    expect(bucketOf(months, at('2026-03-01T00:00:00Z'))).toBe(-1);
  });
});
