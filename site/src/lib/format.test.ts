import { describe, expect, it } from 'vitest';
import { bucketName, bucketPhrase, bucketTick, formatCount, formatDays, formatMean, formatShare } from './format';

const at = (iso: string) => Date.parse(iso) / 1000;

describe('formatCount', () => {
  it('writes whole numbers with thousands separators', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(7)).toBe('7');
    expect(formatCount(74_012)).toBe('74,012');
  });
});

describe('formatMean', () => {
  it('writes one decimal, dropping a trailing zero', () => {
    expect(formatMean(1 / 3)).toBe('0.3');
    expect(formatMean(2)).toBe('2');
    expect(formatMean(3.45)).toBe('3.5');
  });
});

describe('formatShare', () => {
  it('writes a whole percentage from 10% up', () => {
    expect(formatShare(0.8)).toBe('80%');
    expect(formatShare(1)).toBe('100%');
    expect(formatShare(0.125)).toBe('13%');
  });

  it('keeps one decimal under 10%, dropping a trailing zero', () => {
    expect(formatShare(1 / 9)).toBe('11%');
    expect(formatShare(0.045)).toBe('4.5%');
    expect(formatShare(0.05)).toBe('5%');
    expect(formatShare(0.0996)).toBe('10%');
    expect(formatShare(0)).toBe('0%');
  });
});

describe('formatDays', () => {
  it('writes hours under two days', () => {
    expect(formatDays(0)).toBe('0 hours');
    expect(formatDays(0.01)).toBe('under 1 hour');
    expect(formatDays(1 / 24)).toBe('1 hour');
    expect(formatDays(1.5)).toBe('36 hours');
    expect(formatDays(47.4 / 24)).toBe('47 hours');
  });

  it('writes days from two days up, one decimal under ten', () => {
    expect(formatDays(2)).toBe('2 days');
    expect(formatDays(3.54)).toBe('3.5 days');
    expect(formatDays(9.96)).toBe('10 days');
    expect(formatDays(42.4)).toBe('42 days');
    expect(formatDays(1234)).toBe('1,234 days');
  });
});

describe('bucket labels', () => {
  it('names a week by its Monday and a month by its name', () => {
    expect(bucketTick(at('2026-05-18T00:00:00Z'), 'week')).toBe('18 May');
    expect(bucketTick(at('2026-01-01T00:00:00Z'), 'month')).toBe('Jan 2026');
    expect(bucketName(at('2026-05-18T00:00:00Z'), 'week')).toBe('week of 2026-05-18');
    expect(bucketName(at('2026-06-01T00:00:00Z'), 'month')).toBe('June 2026');
  });

  it('names a bucket after a preposition, a week with "the" and a month without', () => {
    expect(`in ${bucketPhrase(at('2026-05-18T00:00:00Z'), 'week')}`).toBe('in the week of 2026-05-18');
    expect(`in ${bucketPhrase(at('2026-06-01T00:00:00Z'), 'month')}`).toBe('in June 2026');
  });
});
