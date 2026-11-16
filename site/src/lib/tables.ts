// The year table files the page has asked for, and where each stands, shared
// by every view that shows titles or a PR's details: one map per loader, so
// a file one view loads is there for the others.

import { SvelteMap } from 'svelte/reactivity';
import { DataError, type DataLoader } from './data';
import type { TableLoad } from './table';

export interface TableLoads {
  /** Each year asked for, by year; reading it in a derivation follows its changes. */
  readonly map: ReadonlyMap<number, TableLoad>;
  /** Starts loading a year's table file, once. */
  request(year: number): void;
}

const byLoader = new WeakMap<DataLoader, TableLoads>();

export function tableLoads(loader: DataLoader): TableLoads {
  const known = byLoader.get(loader);
  if (known) return known;
  const map = new SvelteMap<number, TableLoad>();
  const loads: TableLoads = {
    map,
    request(year) {
      if (map.has(year)) return;
      map.set(year, { status: 'loading' });
      loader.table(year).then(
        (table) => map.set(year, { status: 'loaded', table }),
        (err: unknown) =>
          map.set(year, { status: 'error', message: err instanceof DataError ? `${err.file}: ${err.detail}` : String(err) }),
      );
    },
  };
  byLoader.set(loader, loads);
  return loads;
}
