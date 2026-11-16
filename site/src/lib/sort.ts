// The tables' orders as the URL keeps them, `<column>` ascending or
// `-<column>` descending: the PR table's under `sort`, the People tables'
// under their own keys. Apart from the tables so the URL state can read them
// without the tables' row and cell code.

/** The columns a PR list can be ordered by. */
export const SORT_COLUMNS = [
  'number',
  'title',
  'author',
  'opened',
  'state',
  'kind',
  'response',
  'open',
  'size',
  'disclosure',
  'reopened',
] as const;

export type SortColumn = (typeof SORT_COLUMNS)[number];

/** The Authors table's columns, in the order shown. */
export const AUTHOR_COLUMNS = [
  'author',
  'opened',
  'merged',
  'closed',
  'open',
  'commits',
  'added',
  'deleted',
  'lines',
  'response',
  'merge',
  'disclosed',
] as const;

export type AuthorColumn = (typeof AUTHOR_COLUMNS)[number];

/** The Reviewers table's columns, in the order shown. */
export const REVIEWER_COLUMNS = [
  'reviewer',
  'prs',
  'approved',
  'changes',
  'commented',
  'comments',
  'first',
  'response',
] as const;

export type ReviewerColumn = (typeof REVIEWER_COLUMNS)[number];

export interface Sort<C extends string = SortColumn> {
  column: C;
  descending: boolean;
}

/** Newest opened first. */
export const DEFAULT_SORT: Sort = { column: 'opened', descending: true };
/** Most PRs opened first. */
export const DEFAULT_AUTHOR_SORT: Sort<AuthorColumn> = { column: 'opened', descending: true };
/** Most PRs reviewed first. */
export const DEFAULT_REVIEWER_SORT: Sort<ReviewerColumn> = { column: 'prs', descending: true };

/** A URL's order over `columns`: `<column>` ascending, `-<column>` descending; anything else is `fallback`. */
export function parseSortOf<C extends string>(columns: readonly C[], raw: string | undefined, fallback: Sort<C>): Sort<C> {
  if (raw === undefined) return fallback;
  const descending = raw.startsWith('-');
  const column = descending ? raw.slice(1) : raw;
  return (columns as readonly string[]).includes(column) ? { column: column as C, descending } : fallback;
}

/** The PR table's order from the URL's `sort`. */
export function parseSort(raw: string | undefined): Sort {
  return parseSortOf(SORT_COLUMNS, raw, DEFAULT_SORT);
}

export function sortParam(sort: Sort<string>): string {
  return `${sort.descending ? '-' : ''}${sort.column}`;
}

export function sameSort(a: Sort<string>, b: Sort<string>): boolean {
  return a.column === b.column && a.descending === b.descending;
}

/**
 * Choosing the sorted column turns it the other way; choosing another sorts
 * by it ascending, or descending when `descendingFirst` says so, as for a
 * count where the most comes first.
 */
export function nextSort<C extends string>(current: Sort<C>, column: C, descendingFirst = false): Sort<C> {
  return current.column === column ? { column, descending: !current.descending } : { column, descending: descendingFirst };
}
