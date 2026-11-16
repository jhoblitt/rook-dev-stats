import { describe, expect, it } from 'vitest';
import { select } from '../select';
import { defaultFilters } from '../state';
import { commandUse } from './commands';
import { META, all, dataset, fixture } from './testing';

const MERGED = 1;
const data = fixture();

// Fixture rows with a bot command: 1 #65220, 3 #66500, 7 #66800, one each.
// Merged rows: 0, 3, 7, 8, 9, 10.
describe('commandUse', () => {
  it('gives the share of PRs with a command and the commands a merged PR took', () => {
    const use = commandUse(data, all(data));
    expect(use.share).toBeCloseTo(3 / 12, 12);
    // Merged rows took 0, 1, 1, 0, 0, 0 commands.
    expect(use.merged?.mean).toBeCloseTo(2 / 6, 12);
    expect(use.merged?.median).toBe(0);
    expect(use.merged?.p90).toBe(1);
  });

  it('computes over the selection only', () => {
    const rows = select(data, defaultFilters(META));
    expect([...rows]).toEqual([0, 2, 3, 4, 5, 6, 8, 9, 10]);
    const use = commandUse(data, rows);
    expect(use.share).toBeCloseTo(1 / 9, 12);
    // Merged rows 0, 3, 8, 9, 10 took 0, 1, 0, 0, 0: four of five at 0 is
    // short of 0.9, so the 90th percentile is 1.
    expect(use.merged?.mean).toBeCloseTo(1 / 5, 12);
    expect(use.merged?.median).toBe(0);
    expect(use.merged?.p90).toBe(1);
  });

  it('takes each quantile as the least count that share of merged PRs is at or under', () => {
    const counts = [5, 0, 2, 9, 1, 3, 3, 0, 4, 7];
    const d = dataset(counts.map((c) => ({ created: 0, state: MERGED, closed: 1, bot_commands: c })));
    // Sorted: 0 0 1 2 3 3 4 5 7 9.
    expect(commandUse(d, all(d))).toEqual({ share: 0.8, merged: { mean: 3.4, median: 3, p90: 7 } });
  });

  it('is null for the merged part when no selected PR merged', () => {
    expect(commandUse(data, Uint32Array.of(1, 2))).toEqual({ share: 0.5, merged: null });
  });

  it('is null throughout for an empty selection', () => {
    expect(commandUse(data, new Uint32Array(0))).toEqual({ share: null, merged: null });
  });
});
