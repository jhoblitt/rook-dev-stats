// Lookups for scanning the events of a selection without allocating per event.

import type { Dataset } from '../data';

export const HUMAN_REVIEWS = ['review_approved', 'review_changes', 'review_commented'] as const;

/** Each event kind's index mapped to `value`, every other kind to -1. */
export function kindTable(data: Dataset, kinds: Record<string, number>): Int8Array {
  const table = new Int8Array(256).fill(-1);
  for (const [name, value] of Object.entries(kinds)) {
    const k = data.meta.event_kinds.indexOf(name);
    if (k !== -1) table[k] = value;
  }
  return table;
}

/** A flag per row of the dataset, set for the rows given. */
export function rowMask(data: Dataset, rows: Uint32Array): Uint8Array {
  const mask = new Uint8Array(data.size);
  for (let i = 0; i < rows.length; i++) mask[rows[i] as number] = 1;
  return mask;
}
