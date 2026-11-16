// The page context over the fixture, for the specs that render the whole app.

import { get } from 'svelte/store';
import { DataLoader, type Fetch, parseMeta } from '../data';
import { type Page, createDataStore, createViewStore, firstYears } from '../page';
import { type HashLocation, createStateStore } from '../state';
import { BASE, fixtureFetch } from './fetch';
import rawMeta from './data/meta.json';

export const meta = parseMeta(rawMeta);

/** A hash that lives in memory, so a spec can read what the page wrote. */
export function memoryLocation(initial: string): HashLocation & { hash: () => string } {
  let hash = initial;
  return {
    hash: () => hash,
    read: () => hash,
    push: (h) => (hash = h),
    replace: (h) => (hash = h),
    listen: () => () => {},
  };
}

/**
 * The App's props for the fixture at `hash`, with the hash it writes to and
 * the URLs fetched; `files` replaces fixture files by name, `meta.json`
 * included, and `wrap` stands between the page and the fixture's fetch.
 */
export async function fixturePage(
  hash: string,
  files: Record<string, unknown> = {},
  wrap: (f: Fetch) => Fetch = (f) => f,
): Promise<{ props: { page: Page }; loc: ReturnType<typeof memoryLocation>; requested: string[] }> {
  const m = files['meta.json'] === undefined ? meta : parseMeta(files['meta.json']);
  const loc = memoryLocation(hash);
  const selection = createStateStore(m, loc);
  const fetched = fixtureFetch(files);
  const loader = new DataLoader(m, BASE, wrap(fetched.fetch));
  const years = firstYears(m, get(selection));
  const data = createDataStore(loader, selection, years, await loader.load(years));
  const view = createViewStore(selection, data);
  return { props: { page: { meta: m, selection, data, view, loader } }, loc, requested: fetched.requested };
}
