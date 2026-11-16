import { describe, expect, it } from 'vitest';
import {
  AUTHOR_COLUMNS,
  DEFAULT_AUTHOR_SORT,
  DEFAULT_REVIEWER_SORT,
  DEFAULT_SORT,
  REVIEWER_COLUMNS,
  SORT_COLUMNS,
  nextSort,
  parseSort,
  parseSortOf,
  sameSort,
  sortParam,
} from './sort';
import { TABLE_COLUMNS } from './table';

describe('the sort in the URL', () => {
  it('reads a column for ascending and -column for descending', () => {
    expect(parseSort('size')).toEqual({ column: 'size', descending: false });
    expect(parseSort('-title')).toEqual({ column: 'title', descending: true });
  });

  it('falls back to newest opened first for no sort or an unknown column', () => {
    expect(DEFAULT_SORT).toEqual({ column: 'opened', descending: true });
    for (const raw of [undefined, '', '-', 'colour', '--size', 'size-']) expect(parseSort(raw)).toEqual(DEFAULT_SORT);
  });

  it('writes a sort back as it reads', () => {
    for (const column of SORT_COLUMNS) {
      for (const descending of [false, true]) {
        const sort = { column, descending };
        expect(parseSort(sortParam(sort))).toEqual(sort);
      }
    }
    expect(sortParam(DEFAULT_SORT)).toBe('-opened');
  });

  it('tells two sorts apart by column and direction', () => {
    expect(sameSort(DEFAULT_SORT, { column: 'opened', descending: true })).toBe(true);
    expect(sameSort(DEFAULT_SORT, { column: 'opened', descending: false })).toBe(false);
    expect(sameSort(DEFAULT_SORT, { column: 'size', descending: true })).toBe(false);
  });

  it('turns a column the other way when chosen again, and starts another ascending', () => {
    expect(nextSort(DEFAULT_SORT, 'opened')).toEqual({ column: 'opened', descending: false });
    expect(nextSort({ column: 'opened', descending: false }, 'opened')).toEqual(DEFAULT_SORT);
    expect(nextSort(DEFAULT_SORT, 'size')).toEqual({ column: 'size', descending: false });
  });

  it('names every column the table shows, and only those', () => {
    expect(TABLE_COLUMNS.map((c) => c.id).sort()).toEqual([...SORT_COLUMNS].sort());
  });
});

describe("the People tables' orders", () => {
  it('default to the most PRs first', () => {
    expect(DEFAULT_AUTHOR_SORT).toEqual({ column: 'opened', descending: true });
    expect(DEFAULT_REVIEWER_SORT).toEqual({ column: 'prs', descending: true });
  });

  it('read a column of their own table either way, and fall back for anything else', () => {
    expect(parseSortOf(AUTHOR_COLUMNS, '-lines', DEFAULT_AUTHOR_SORT)).toEqual({ column: 'lines', descending: true });
    expect(parseSortOf(REVIEWER_COLUMNS, 'reviewer', DEFAULT_REVIEWER_SORT)).toEqual({ column: 'reviewer', descending: false });
    for (const raw of [undefined, '', '-', 'prs', 'title', '--lines']) {
      expect(parseSortOf(AUTHOR_COLUMNS, raw, DEFAULT_AUTHOR_SORT)).toEqual(DEFAULT_AUTHOR_SORT);
    }
  });

  it('sort a newly chosen column descending first when asked, then turn it', () => {
    expect(nextSort(DEFAULT_AUTHOR_SORT, 'lines', true)).toEqual({ column: 'lines', descending: true });
    expect(nextSort({ column: 'lines', descending: true }, 'lines', true)).toEqual({ column: 'lines', descending: false });
  });
});
