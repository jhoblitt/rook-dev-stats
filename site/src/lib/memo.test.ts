import { describe, expect, it } from 'vitest';
import { keepEqual, sameFilters } from './memo';
import { defaultFilters } from './state';
import { META } from './stats/testing';

describe('keepEqual', () => {
  it('hands back the last value for an equal one, and the new value otherwise', () => {
    const keep = keepEqual(sameFilters);
    const first = defaultFilters(META);
    expect(keep(first)).toBe(first);
    expect(keep({ ...first })).toBe(first);
    const changed = { ...first, component: 'rgw' };
    expect(keep(changed)).toBe(changed);
    expect(keep({ ...first })).not.toBe(first);
  });
});

describe('sameFilters', () => {
  it('compares every filter', () => {
    const f = defaultFilters(META);
    expect(sameFilters(f, { ...f })).toBe(true);
    expect(sameFilters(f, { ...f, to: '2026-10-01' })).toBe(false);
    expect(sameFilters(f, { ...f, excludeDrafts: true })).toBe(false);
  });
});
