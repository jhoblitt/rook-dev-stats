// What choosing a bucket or a backlog band in a chart does to the selection.
// Narrowing the PR table to it is the table's own business.

import { AGE_BANDS, dayOf, findChoice } from './filters';
import type { AppState } from './state';

/** Selects the bucket starting at `bucket`, or clears it when it is already selected alone. */
export function chooseBucket(state: AppState, bucket: number): AppState {
  const week = dayOf(bucket);
  if (state.week === week && state.band === null) return { ...state, week: null };
  return { ...state, week, band: null };
}

/** Selects an age band within a bucket, or clears both when that band is already selected. */
export function chooseBand(state: AppState, bucket: number, key: string): AppState {
  const band = findChoice(AGE_BANDS, key);
  if (band === null) return state;
  const week = dayOf(bucket);
  if (state.week === week && state.band === band) return { ...state, week: null, band: null };
  return { ...state, week, band };
}
