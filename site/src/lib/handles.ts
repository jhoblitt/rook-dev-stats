// People as the page shows them: by GitHub login, each linked to its page on
// GitHub. The logins come from the data, so one is linked only when it has
// the form of a login and cannot carry a path, a query or another host.
//
// A deleted account has no login of its own: GitHub shows every one as
// `ghost`. The data credits a pull request opened by one to the name on its
// commits where there is one, as an entry `ghost:` and the name that
// meta's `people_deleted` lists; everything else a deleted account did is
// the one pooled `ghost` entry's. This is the one place that reads either
// form: the rest of the page asks for a handle.

import type { Meta } from './data';

/** The login GitHub gives a deleted account: the data's entry for every deleted account not known by name. */
export const GHOST = 'ghost';

/** What starts an entry of `people` that names a deleted account by the name on its commits. */
const NAMED_PREFIX = `${GHOST}:`;

/** What the page writes before a deleted account's name. */
const DELETED = '(deleted)';

/**
 * What the page writes for the pooled entry. Its comma stands where a
 * named entry has the space after "(deleted)", so no name, whatever it
 * reads, is written the same.
 */
const POOLED = '(deleted, unknown)';

/** What the pooled entry stands for, said wherever it is a row or a choice. */
export const POOLED_NOTE =
  'every deleted account whose activity cannot be told apart: all their comments and reviews, and the pull requests not credited to a name from their commits';

/** Letters, digits and hyphens, not starting with a hyphen, at most 39; an app account adds `[bot]`. */
const LOGIN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}(\[bot\])?$/;

export interface Handle {
  /** The entry of meta's `people`, which the filters and the address carry. */
  login: string;
  /** What the page writes: the login, or "(deleted)" and a name, or "(deleted, unknown)". */
  text: string;
  /** The person's page on GitHub; null for a deleted account or a login that does not have the form of one. */
  url: string | null;
  /** What the pooled entry stands for; no one else has a note. */
  note?: string;
}

/**
 * The handle of a `people` entry. `named` says that meta's `people_deleted`
 * lists it, so that it is `ghost:` and the name on a deleted account's commits.
 */
export function handle(login: string, named = false): Handle {
  if (named) return { login, text: `${DELETED} ${login.slice(NAMED_PREFIX.length)}`, url: null };
  if (login === GHOST) return { login, text: POOLED, url: null, note: POOLED_NOTE };
  return { login, text: login, url: LOGIN.test(login) ? `https://github.com/${encodeURIComponent(login)}` : null };
}

/** The handle of `person`, an index into meta's `people`. */
export function personHandle(meta: Meta, person: number): Handle {
  return handle(meta.people[person] ?? '', isNamedDeleted(meta, person));
}

export function isBot(meta: Meta, person: number): boolean {
  return meta.people_bots.includes(person);
}

/** Whether `person` is a deleted account known by the name on its commits. */
export function isNamedDeleted(meta: Meta, person: number): boolean {
  return meta.people_deleted.includes(person);
}

/** Whether `person` is the pooled entry of every deleted account not known by name. */
export function isPooledDeleted(meta: Meta, person: number): boolean {
  return meta.people[person] === GHOST;
}

/** Whether an entry of `people` has the form meta's `people_deleted` requires: `ghost:` and a name. */
export function isNamedForm(login: string): boolean {
  return login.startsWith(NAMED_PREFIX) && login.length > NAMED_PREFIX.length;
}

interface Lookup {
  /** A named deleted account's entry and what the page writes for it, exactly: a name is not a login, and case can tell two apart. */
  exact: Map<string, number>;
  /** Every entry and what the page writes for it, lower-cased; GitHub does not tell logins apart by case. */
  folded: Map<string, number>;
}

const lookups = new WeakMap<Meta, Lookup>();

function lookup(meta: Meta): Lookup {
  const known = lookups.get(meta);
  if (known) return known;
  const exact = new Map<string, number>();
  const folded = new Map<string, number>();
  meta.people.forEach((login, i) => {
    const text = personHandle(meta, i).text;
    if (isNamedDeleted(meta, i)) {
      for (const key of [login, text]) if (!exact.has(key)) exact.set(key, i);
    }
    for (const key of [login.toLowerCase(), text.toLowerCase()]) if (!folded.has(key)) folded.set(key, i);
  });
  const made = { exact, folded };
  lookups.set(meta, made);
  return made;
}

/**
 * The index into meta's `people` of a login in any case, of a deleted
 * account's entry or of what the page writes for one, or -1 when the data
 * does not name it.
 */
export function personIndex(meta: Meta, login: string): number {
  const { exact, folded } = lookup(meta);
  return exact.get(login) ?? folded.get(login.toLowerCase()) ?? -1;
}

/** The `people` entry a login in any case, or what the page writes for a person, names; null when the data does not name it. */
export function findLogin(meta: Meta, login: string): string | null {
  const i = personIndex(meta, login);
  return i === -1 ? null : (meta.people[i] as string);
}

/** The handle of a `people` entry, as `findLogin` gives one. */
export function loginHandle(meta: Meta, login: string): Handle {
  const i = personIndex(meta, login);
  return i === -1 ? handle(login) : personHandle(meta, i);
}
