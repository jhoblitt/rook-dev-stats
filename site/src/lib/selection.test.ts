import { describe, expect, it } from 'vitest';
import { chooseBand, chooseBucket } from './selection';
import { defaultState } from './state';
import { META, at } from './stats/testing';

const state = defaultState(META);
const MAY_18 = at('2026-05-18T00:00:00Z');
const MAY_25 = at('2026-05-25T00:00:00Z');

describe('chooseBucket', () => {
  it('selects the bucket by its first day, and no band', () => {
    expect(chooseBucket({ ...state, band: 'lt7' }, MAY_18)).toEqual({ ...state, week: '2026-05-18', band: null });
  });

  it('clears the bucket when it is chosen again', () => {
    expect(chooseBucket({ ...state, week: '2026-05-18' }, MAY_18)).toEqual({ ...state, week: null });
  });

  it('keeps the bucket and clears its band when a band of it was selected', () => {
    expect(chooseBucket({ ...state, week: '2026-05-18', band: 'gt90' }, MAY_18)).toEqual({
      ...state,
      week: '2026-05-18',
      band: null,
    });
  });

  it('keeps the rest of the state', () => {
    const s = { ...state, pr: 66500 };
    expect(chooseBucket(s, MAY_25).pr).toBe(66500);
  });
});

describe('chooseBand', () => {
  it('selects the band within the bucket', () => {
    expect(chooseBand(state, MAY_18, '30-90')).toEqual({ ...state, week: '2026-05-18', band: '30-90' });
  });

  it('clears both when the same band of the same bucket is chosen again', () => {
    expect(chooseBand({ ...state, week: '2026-05-18', band: '30-90' }, MAY_18, '30-90')).toEqual(state);
  });

  it('ignores a key that is not an age band', () => {
    expect(chooseBand(state, MAY_18, 'opened')).toEqual(state);
  });
});
