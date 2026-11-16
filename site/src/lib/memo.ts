// Keeps a value's identity while it stays equal. The state store hands out
// new filter objects on every change of the URL, choosing a PR included, and
// a Svelte derivation compares by identity, so without this every statistic
// over the full history is computed again for a change that leaves it alone.

import type { Filters } from './filters';

/** A function that returns its argument, or the last value it returned when that is equal to it. */
export function keepEqual<T>(equal: (a: T, b: T) => boolean): (next: T) => T {
  let last: { value: T } | null = null;
  return (next) => {
    if (last !== null && equal(last.value, next)) return last.value;
    last = { value: next };
    return next;
  };
}

export function sameFilters(a: Filters, b: Filters): boolean {
  return (Object.keys(a) as (keyof Filters)[]).every((k) => a[k] === b[k]);
}
