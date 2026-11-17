import { describe, expect, it } from 'vitest';
import events2026 from './__fixtures__/data/events-2026.json';
import rawMeta from './__fixtures__/data/meta.json';
import prs2026 from './__fixtures__/data/prs-2026.json';
import table2026 from './__fixtures__/data/table-2026.json';
import { NAMED_A, NAMED_B, POOLED, deletedMeta } from './__fixtures__/deleted';
import { BASE, fixtureFetch, withEarlierYear } from './__fixtures__/fetch';
import {
  DataError,
  DataLoader,
  type Fetch,
  combine,
  loadMeta,
  locateEvent,
  locateRow,
  parseEvents,
  parseIndex,
  parseMeta,
  parsePrs,
  parseTable,
  parseYear,
  yearHolds,
  yearOfPr,
  yearsFor,
} from './data';

const meta = parseMeta(rawMeta);
const SHA = /^[0-9a-f]{40}$/;

// The fixture with 2025 before it, holding #60010 alone.
const earlier = withEarlierYear();
const twoYears = parseMeta(earlier['meta.json']);
const prs2025 = earlier['prs-2025.json'];
const events2025 = earlier['events-2025.json'] as typeof events2026;

describe('parseMeta', () => {
  it('reads the fixture', () => {
    expect(meta.repo).toBe('rook/rook');
    expect(meta.window_start).toBe(Date.UTC(2026, 4, 15) / 1000);
    expect(meta.years).toEqual([2026]);
    expect(meta.components.map((c) => c.id)).toEqual(['filesystem', 'mgr', 'block', 'object']);
    expect(meta.disclosure).toEqual(['none', 'checklist', 'description', 'coauthor', 'trailer']);
    expect(meta.kinds).toEqual([
      { id: 'bugfix', name: 'Bug fix' },
      { id: 'feature', name: 'Feature' },
      { id: 'cleanup', name: 'Cleanup' },
      { id: 'docs', name: 'Documentation' },
      { id: 'other', name: 'Other' },
    ]);
  });

  it('rejects a meta without a dictionary, naming the file and the field', () => {
    const { bases: _, ...withoutBases } = rawMeta;
    expect(() => parseMeta(withoutBases)).toThrow(DataError);
    expect(() => parseMeta(withoutBases)).toThrow(/meta\.json.*bases/);
  });

  it('rejects a meta without kinds, or with kinds that are not {id, name}', () => {
    const { kinds: _, ...withoutKinds } = rawMeta;
    expect(() => parseMeta(withoutKinds)).toThrow(/meta\.json.*kinds/);
    expect(() => parseMeta({ ...rawMeta, kinds: ['bugfix'] })).toThrow(/meta\.json.*kinds/);
  });

  it.each(['unknown', 'all'])('rejects a kind whose id is %s, a choice of the Kind filter itself', (id) => {
    const kinds = [...rawMeta.kinds, { id, name: 'Something' }];
    expect(() => parseMeta({ ...rawMeta, kinds })).toThrow(DataError);
    expect(() => parseMeta({ ...rawMeta, kinds })).toThrow(new RegExp(`meta\\.json.*kinds.*"${id}"`));
  });

  it('rejects a time that is not a number', () => {
    expect(() => parseMeta({ ...rawMeta, fetched_through: '2026-11-15T06:00:00Z' })).toThrow(/fetched_through/);
  });

  it('reads the people the data names, and which of them are bots', () => {
    expect(meta.people).toHaveLength(12);
    expect(meta.people[4]).toBe('fixture-reviewer-k');
    expect(meta.people_bots).toEqual([10, 11]);
  });

  it.each([
    ['without people', { people: undefined }, /meta\.json.*"people"/],
    ['with people that are not logins', { people: ['a', 3] }, /meta\.json.*"people"/],
    ['with a login named twice', { people: ['a', 'b', 'a'], people_bots: [] }, /meta\.json.*"people".*"a" twice/],
    ['without people_bots', { people_bots: undefined }, /meta\.json.*"people_bots"/],
    ['with a bot index past the last person', { people_bots: [10, 12] }, /meta\.json.*"people_bots" has 12 at 1, outside "people" of 12/],
    ['with a negative bot index', { people_bots: [-1] }, /meta\.json.*"people_bots"/],
  ])('rejects a meta %s, naming the file and the field', (_name, patch, message) => {
    expect(() => parseMeta({ ...rawMeta, ...patch })).toThrow(DataError);
    expect(() => parseMeta({ ...rawMeta, ...patch })).toThrow(message);
  });

  it('reads no deleted account by name from data without people_deleted, as the data before names had', () => {
    expect('people_deleted' in rawMeta).toBe(false);
    expect(meta.people_deleted).toEqual([]);
    expect(parseMeta(deletedMeta(false)).people_deleted).toEqual([]);
  });

  it('reads the deleted accounts known by name, ascending, and an empty list as none', () => {
    expect(parseMeta(deletedMeta()).people_deleted).toEqual([NAMED_A, NAMED_B]);
    expect(parseMeta({ ...deletedMeta(), people_deleted: [] }).people_deleted).toEqual([]);
  });

  it.each([
    ['that is not a list of indexes', { people_deleted: 'ghost' }, /meta\.json.*"people_deleted"/],
    ['with an index past the last person', { people_deleted: [NAMED_B + 1] }, /meta\.json.*"people_deleted" has 15 at 0, outside "people" of 15/],
    ['naming a login', { people_deleted: [2] }, /meta\.json.*"people_deleted" names "fixture-author-a", which is not "ghost:" and a name/],
    ['naming the pooled entry', { people_deleted: [POOLED] }, /meta\.json.*"people_deleted" names "ghost", which is not "ghost:" and a name/],
    ['naming a bot', { people_deleted: [NAMED_A], people_bots: [10, 11, NAMED_A] }, /meta\.json.*"people_deleted" names "ghost:Ada Example", which "people_bots" lists too/],
  ])('rejects a people_deleted %s', (_name, patch, message) => {
    expect(() => parseMeta({ ...deletedMeta(), ...patch })).toThrow(DataError);
    expect(() => parseMeta({ ...deletedMeta(), ...patch })).toThrow(message);
  });

  it('rejects an entry that is "ghost:" with no name', () => {
    const people = [...rawMeta.people, 'ghost:'];
    expect(() => parseMeta({ ...rawMeta, people, people_deleted: [people.length - 1] })).toThrow(
      /meta\.json.*"people_deleted" names "ghost:", which is not "ghost:" and a name/,
    );
  });
});

describe('parsePrs', () => {
  it('reads the columns into typed arrays', () => {
    const prs = parsePrs(prs2026, 'prs-2026.json', meta);
    expect(prs.number).toBeInstanceOf(Int32Array);
    expect(prs.created).toBeInstanceOf(Float64Array);
    expect([...prs.number]).toEqual(prs2026.number);
    expect([...prs.first_commit]).toEqual(prs2026.first_commit);
    expect(prs.components).toEqual(prs2026.components);
  });

  it('reads the kind column, -1 for unknown', () => {
    const prs = parsePrs(prs2026, 'prs-2026.json', meta);
    expect(prs.kind).toBeInstanceOf(Int32Array);
    expect([...prs.kind]).toEqual([0, -1, 2, 0, 3, 4, 1, 0, 1, 4, 1, 3]);
  });

  it('rejects a year file whose columns differ in length, naming the file and the column', () => {
    const short = { ...prs2026, deletions: prs2026.deletions.slice(1) };
    expect(() => parsePrs(short, 'prs-2026.json', meta)).toThrow(DataError);
    expect(() => parsePrs(short, 'prs-2026.json', meta)).toThrow(/prs-2026\.json.*deletions/);
  });

  it('rejects a ragged column of a different length too', () => {
    const short = { ...prs2026, families: prs2026.families.slice(1) };
    expect(() => parsePrs(short, 'prs-2026.json', meta)).toThrow(/families/);
  });

  it('rejects a missing column', () => {
    const { standing: _, ...withoutStanding } = prs2026;
    expect(() => parsePrs(withoutStanding, 'prs-2026.json', meta)).toThrow(/standing/);
  });

  it("reads backport_link, set for the PRs whose table names the PR they backport", () => {
    const prs = parsePrs(prs2026, 'prs-2026.json', meta);
    expect(prs.backport_link).toBeInstanceOf(Uint8Array);
    expect([...prs.backport_link]).toEqual([0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect([...prs.backport_link]).toEqual(table2026.backport_of.map((n) => (n > 0 ? 1 : 0)));
  });

  it('reads a year file written before backport_link as no link on every row, and says the year lacks it', () => {
    const { backport_link: _, ...before } = prs2026;
    const prs = parsePrs(before, 'prs-2026.json', meta);
    expect([...prs.backport_link]).toEqual(Array.from({ length: 12 }, () => 0));
    expect(parseYear(2026, before, events2026, meta).linksRecorded).toBe(false);
    expect(parseYear(2026, prs2026, events2026, meta).linksRecorded).toBe(true);
  });

  it('rejects a backport_link of a different length, as any other column', () => {
    const short = { ...prs2026, backport_link: prs2026.backport_link.slice(1) };
    expect(() => parsePrs(short, 'prs-2026.json', meta)).toThrow(/prs-2026\.json.*backport_link/);
  });

  it('rejects a value that is not an integer, which would become NaN', () => {
    const bad = { ...prs2026, ready: prs2026.ready.map((v, i) => (i === 3 ? null : v)) };
    expect(() => parsePrs(bad, 'prs-2026.json', meta)).toThrow(/ready/);
  });

  it('rejects a file that is not an object of columns', () => {
    expect(() => parsePrs([1, 2, 3], 'prs-2026.json', meta)).toThrow(/prs-2026\.json/);
  });

  // Each index column against its dictionary in the fixture's meta: 4 bases,
  // 5 disclosures, 3 families, 4 components and 5 kinds.
  const at3 = <T>(column: readonly T[], value: T) => column.map((v, i) => (i === 3 ? value : v));
  it.each([
    ['kind past the last kind', 'kind', { kind: at3(prs2026.kind, 5) }],
    ['kind below -1', 'kind', { kind: at3(prs2026.kind, -2) }],
    ['base past the last base', 'base', { base: at3(prs2026.base, 4) }],
    ['base of -1', 'base', { base: at3(prs2026.base, -1) }],
    ['disclosure past the last form', 'disclosure', { disclosure: at3(prs2026.disclosure, 5) }],
    ['family past the last family', 'families', { families: at3(prs2026.families, [0, 3]) }],
    ['component past the last component', 'components', { components: at3(prs2026.components, [4]) }],
  ])('rejects a %s, naming the file and the column', (_name, column, patch) => {
    const bad = { ...prs2026, ...patch };
    expect(() => parsePrs(bad, 'prs-2026.json', meta)).toThrow(DataError);
    expect(() => parsePrs(bad, 'prs-2026.json', meta)).toThrow(new RegExp(`prs-2026\\.json.*"${column}".*row 3`));
  });

  it("reads each PR's author, an index into people", () => {
    const prs = parsePrs(prs2026, 'prs-2026.json', meta);
    expect(prs.author).toBeInstanceOf(Int32Array);
    expect([...prs.author]).toEqual(prs2026.author);
    expect(meta.people[prs.author[0] as number]).toBe(table2026.authors[0]);
  });

  it.each([
    ['past the last person', 12],
    ['of -1, since every PR has an author', -1],
  ])('rejects a year file whose author is %s, naming the file, the column and the row', (_name, value) => {
    const bad = { ...prs2026, author: at3(prs2026.author, value) };
    expect(() => parsePrs(bad, 'prs-2026.json', meta)).toThrow(DataError);
    expect(() => parsePrs(bad, 'prs-2026.json', meta)).toThrow(/prs-2026\.json.*"author" has .* at row 3, outside "people" of 12/);
  });

  it('accepts every kind in the dictionary and -1', () => {
    const kinds = [-1, 0, 1, 2, 3, 4, 4, 4, 4, 4, 4, 4];
    expect([...parsePrs({ ...prs2026, kind: kinds }, 'prs-2026.json', meta).kind]).toEqual(kinds);
  });
});

describe('parseEvents', () => {
  it('rejects columns of different lengths', () => {
    const short = { ...events2026, actor: events2026.actor.slice(1) };
    expect(() => parseEvents(short, 'events-2026.json', 12, meta)).toThrow(/events-2026\.json.*actor/);
  });

  it('rejects an event on a row the year does not have', () => {
    expect(() => parseEvents(events2026, 'events-2026.json', 3, meta)).toThrow(/events-2026\.json.*pr/);
  });

  it('reads an actor of -1 for an event nobody is named for', () => {
    expect([...parseEvents(events2026, 'events-2026.json', 12, meta).actor]).toEqual(events2026.actor);
  });

  it.each([12, -2])('rejects an actor of %i, outside people, naming the file and the event', (value) => {
    const bad = { ...events2026, actor: events2026.actor.map((v, i) => (i === 4 ? value : v)) };
    expect(() => parseEvents(bad, 'events-2026.json', 12, meta)).toThrow(DataError);
    expect(() => parseEvents(bad, 'events-2026.json', 12, meta)).toThrow(
      new RegExp(`events-2026\\.json.*"actor" has ${value} at event 4, outside "people" of 12`),
    );
  });

  // Event 23 is a command_author with sub 0; meta has 15 event kinds and 2 commands.
  const at23 = (column: readonly number[], value: number) => column.map((v, i) => (i === 23 ? value : v));
  it.each([
    ['kind past the last event kind', 'kind', { kind: at23(events2026.kind, 15) }],
    ['command past the last command', 'sub', { sub: at23(events2026.sub, 2) }],
    ['command without a command', 'sub', { sub: at23(events2026.sub, -1) }],
  ])('rejects a %s, naming the file and the column', (_name, column, patch) => {
    const bad = { ...events2026, ...patch };
    expect(() => parseEvents(bad, 'events-2026.json', 12, meta)).toThrow(DataError);
    expect(() => parseEvents(bad, 'events-2026.json', 12, meta)).toThrow(
      new RegExp(`events-2026\\.json.*"${column}".*23`),
    );
  });
});

describe('parseTable', () => {
  const y2026 = parseYear(2026, prs2026, events2026, meta);
  const parse = (raw: unknown) => parseTable(raw, 'table-2026.json', y2026, meta);
  const table = parse(table2026);

  it('reads the titles and authors, one per row', () => {
    expect(table.titles).toEqual(table2026.titles);
    expect(table.authors).toEqual(table2026.authors);
  });

  it('reads each row its commits as [sha, authored, committed]', () => {
    expect(table.commits).toHaveLength(12);
    // #66500, one commit authored and committed at 2026-05-18 09:30.
    expect(table.commits[3]).toEqual([[expect.stringMatching(SHA), 1779096600, 1779096600]]);
    table.commits.forEach((list, r) => {
      expect(list, `row ${r}`).toHaveLength(prs2026.commits[r] as number);
      expect(list.at(-1)?.[2], `row ${r}`).toBe(prs2026.last_commit[r]);
    });
  });

  it('reads one ref per event, in the events file order', () => {
    expect(table.refs).toHaveLength(events2026.pr.length);
    expect(table.refs[7]).toMatch(/^[1-9]\d*$/); // comment_other: a comment id
    expect(table.refs[14]).toMatch(SHA); // merged: the merge commit
    expect(table.refs[28]).toBe(''); // reopened
    expect(table.refs[37]).toMatch(/^[1-9]\d*$/); // ready: an event id
    expect(table.refs[41]).toBe(''); // bot_account without an id
  });

  it('reads the closing issues, the PR a backport is of, and where each kind came from', () => {
    expect(table.issues).toEqual([
      [[71234, 'rook/rook']],
      [],
      [],
      [[72001, 'rook/rook']],
      [],
      [],
      [[72510, 'rook/rook']],
      [[72140, 'rook/rook']],
      [
        [72377, 'rook/rook'],
        [4001, 'ceph/ceph-csi'],
      ],
      [],
      [],
      [],
    ]);
    expect(table.backport_of).toEqual([0, 63980, 0, 0, 0, 0, 0, 66500, 0, 0, 0, 67010]);
    expect(table.kind_source).toEqual([
      'issues',
      '',
      'labels',
      'labels',
      'labels',
      'labels',
      'labels',
      'original',
      'issues',
      'labels',
      'labels',
      'labels',
    ]);
  });

  it('reads a kind source of "" for an unknown kind', () => {
    expect(y2026.prs.kind[1]).toBe(-1);
    expect(table.kind_source[1]).toBe('');
  });

  const sha = 'a'.repeat(40);
  const at = <T>(column: readonly T[], i: number, value: T) => column.map((v, j) => (j === i ? value : v));
  it.each([
    ['titles one short', 'titles', { titles: table2026.titles.slice(1) }],
    ['commits one short', 'commits', { commits: table2026.commits.slice(1) }],
    ['a commit without its committed time', 'commits', { commits: at(table2026.commits, 2, [[sha, 1]]) }],
    ['a commit whose sha is not 40 hex digits', 'commits', { commits: at(table2026.commits, 2, [['abc', 1, 2]]) }],
    ['a commit whose time is not a number', 'commits', { commits: at(table2026.commits, 2, [[sha, '1', 2]]) }],
    ['refs one short of the events', 'refs', { refs: table2026.refs.slice(1) }],
    ['a merge ref that is not a sha', 'refs', { refs: at(table2026.refs, 14, '3412345678') }],
    ['a comment ref that is a sha', 'refs', { refs: at(table2026.refs, 0, sha) }],
    ['a ref that is not an id', 'refs', { refs: at(table2026.refs, 0, 'issuecomment-1') }],
    ['issues one short', 'issues', { issues: table2026.issues.slice(1) }],
    ['an issue that is not a positive number', 'issues', { issues: at(table2026.issues, 1, [[0, 'rook/rook']]) }],
    ['an issue without its repository', 'issues', { issues: at(table2026.issues, 1, [[72001]]) }],
    ['an issue whose repository is not owner/name', 'issues', { issues: at(table2026.issues, 1, [[72001, 'rook']]) }],
    ['an issue as a bare number', 'issues', { issues: at(table2026.issues, 1, [72001] as unknown as (string | number)[][]) }],
    ['the tracker as a kind source', 'kind_source', { kind_source: at(table2026.kind_source, 0, 'tracker') }],
    ['the checklist as a kind source', 'kind_source', { kind_source: at(table2026.kind_source, 0, 'checklist') }],
    ['backport_of one short', 'backport_of', { backport_of: table2026.backport_of.slice(1) }],
    ['a negative backport_of', 'backport_of', { backport_of: at(table2026.backport_of, 5, -1) }],
    ['kind_source one short', 'kind_source', { kind_source: table2026.kind_source.slice(1) }],
    ['an unheard-of kind source', 'kind_source', { kind_source: at(table2026.kind_source, 0, 'guess') }],
    ['no kind source for a known kind', 'kind_source', { kind_source: at(table2026.kind_source, 0, '') }],
  ])('rejects %s, naming the file and the column', (_name, column, patch) => {
    const bad = { ...table2026, ...patch };
    expect(() => parse(bad)).toThrow(DataError);
    expect(() => parse(bad)).toThrow(new RegExp(`table-2026\\.json.*"${column}"`));
  });

  it('rejects a kind source for an unknown kind', () => {
    const bad = { ...table2026, kind_source: table2026.kind_source.map((s, r) => (r === 1 ? 'labels' : s)) };
    expect(() => parse(bad)).toThrow(/table-2026\.json.*"kind_source".*row 1/);
  });

  it('rejects a missing column', () => {
    const { refs: _, ...withoutRefs } = table2026;
    expect(() => parse(withoutRefs)).toThrow(/table-2026\.json.*"refs"/);
  });
});

describe('combine', () => {
  const y2025 = parseYear(2025, prs2025, events2025, twoYears);
  const y2026 = parseYear(2026, prs2026, events2026, twoYears);
  const data = combine(twoYears, [y2025, y2026]);

  it('appends the years in order, so a row id is global', () => {
    expect(data.size).toBe(13);
    expect([...data.prs.number]).toEqual([60010, ...prs2026.number]);
    expect(data.years).toEqual([
      { year: 2025, first: 0, count: 1, firstEvent: 0, eventCount: 5 },
      { year: 2026, first: 1, count: 12, firstEvent: 5, eventCount: 42 },
    ]);
  });

  it('moves each event onto its global row', () => {
    expect(data.events.pr.length).toBe(events2025.pr.length + events2026.pr.length);
    expect([...data.events.pr]).toEqual([...events2025.pr, ...events2026.pr.map((p) => p + 1)]);
    expect([...data.events.at]).toEqual([...events2025.at, ...events2026.at]);
  });

  it('names no year without the backport link when every year has it', () => {
    expect(data.linksUnrecorded).toEqual([]);
  });

  it('names the years whose files predate the backport link, which read as no link', () => {
    const { backport_link: _, ...before } = prs2025 as typeof prs2026;
    const mixed = combine(twoYears, [parseYear(2025, before, events2025, twoYears), y2026]);
    expect(mixed.linksUnrecorded).toEqual([2025]);
    expect([...mixed.prs.backport_link]).toEqual([0, ...prs2026.backport_link]);
  });

  it('gives an empty dataset for no years', () => {
    const empty = combine(meta, []);
    expect(empty.size).toBe(0);
    expect(empty.prs.number.length).toBe(0);
    expect(empty.events.pr.length).toBe(0);
    expect(empty.prs.families).toEqual([]);
  });
});

describe('locateRow and locateEvent', () => {
  // 2025 holds row 0 and events 0–4; 2026 rows 1–12 and events 5–46.
  const y2025 = parseYear(2025, prs2025, events2025, twoYears);
  const y2026 = parseYear(2026, prs2026, events2026, twoYears);
  const data = combine(twoYears, [y2025, y2026]);

  it.each([
    [0, { year: 2025, index: 0 }],
    [1, { year: 2026, index: 0 }],
    [2, { year: 2026, index: 1 }],
    [12, { year: 2026, index: 11 }],
  ])('puts row %i in its year table', (row, expected) => {
    expect(locateRow(data, row)).toEqual(expected);
  });

  it.each([
    [0, { year: 2025, index: 0 }],
    [4, { year: 2025, index: 4 }],
    [5, { year: 2026, index: 0 }],
    [46, { year: 2026, index: 41 }],
  ])('puts event %i in its year refs', (event, expected) => {
    expect(locateEvent(data, event)).toEqual(expected);
  });

  it('finds the table entries of a row and of an event', () => {
    const table = parseTable(table2026, 'table-2026.json', y2026, twoYears);
    // Row 4 is #66500; event 19 is its merge, the fifteenth event of 2026.
    expect(data.prs.number[4]).toBe(66500);
    expect(table.titles[locateRow(data, 4).index]).toBe('object: check the bucket owner before a copy');
    expect(data.events.pr[19]).toBe(4);
    expect(meta.event_kinds[data.events.kind[19] as number]).toBe('merged');
    expect(table.refs[locateEvent(data, 19).index]).toMatch(SHA);
  });

  it('counts from the first loaded year when an earlier one is not loaded', () => {
    const only2026 = combine(twoYears, [y2026]);
    expect(locateRow(only2026, 0)).toEqual({ year: 2026, index: 0 });
    expect(locateEvent(only2026, 41)).toEqual({ year: 2026, index: 41 });
  });

  it.each([-1, 13, 1.5, Number.NaN])('throws for row %d, outside the loaded data, naming it', (row) => {
    expect(() => locateRow(data, row)).toThrow(RangeError);
    expect(() => locateRow(data, row)).toThrow(`row ${row} `);
  });

  it.each([-1, 47, 2.5])('throws for event %d, outside the loaded data, naming it', (event) => {
    expect(() => locateEvent(data, event)).toThrow(RangeError);
    expect(() => locateEvent(data, event)).toThrow(`event ${event} `);
  });

  it('throws for any row of an empty dataset', () => {
    expect(() => locateRow(combine(meta, []), 0)).toThrow(/row 0 /);
  });
});

describe('yearsFor', () => {
  const at = (iso: string) => Date.parse(iso) / 1000;
  const history = { ...meta, years: [2011, 2012, 2013, 2016, 2021, 2025, 2026] };

  it('loads the years from the start of the period on, since a PR finished before it cannot be active in it', () => {
    expect(yearsFor(history, at('2026-05-15T00:00:00Z'))).toEqual([2026]);
    expect(yearsFor(history, at('2026-01-01T00:00:00Z'))).toEqual([2026]);
    expect(yearsFor(history, at('2025-12-31T23:59:59Z'))).toEqual([2025, 2026]);
  });

  it('skips the years the data has no file for', () => {
    expect(yearsFor(history, at('2014-06-01T00:00:00Z'))).toEqual([2016, 2021, 2025, 2026]);
  });

  it('loads every year from a start at or before the first', () => {
    expect(yearsFor(history, at('2011-03-04T00:00:00Z'))).toEqual(history.years);
    expect(yearsFor(history, at('2009-01-01T00:00:00Z'))).toEqual(history.years);
    // A start late in the first year still needs that year's file.
    expect(yearsFor(history, at('2011-09-01T00:00:00Z'))).toEqual(history.years);
  });

  it("loads the fixture's one year for its default period", () => {
    expect(yearsFor(meta, at('2026-05-15T00:00:00Z'))).toEqual([2026]);
  });

  it('keeps a year after the last fetch, where a PR closed during the fetch is filed', () => {
    expect(yearsFor({ ...meta, years: [2025, 2026, 2027] }, at('2026-05-15T00:00:00Z'))).toEqual([2026, 2027]);
  });
});

describe('yearHolds', () => {
  it('names the PRs a year holds: those finished in it, and the open ones in the year of the last fetch', () => {
    expect(yearHolds(meta, 2025)).toBe('PRs finished in 2025');
    expect(yearHolds(meta, 2026)).toBe('PRs finished in 2026 or still open');
    expect(yearHolds(meta, 2027)).toBe('PRs finished in 2027');
  });
});

describe('loadMeta', () => {
  it('loads and parses meta.json', async () => {
    const { fetch } = fixtureFetch();
    expect(await loadMeta(BASE, fetch)).toEqual(meta);
  });

  it('names meta.json when it cannot be loaded', async () => {
    const { fetch } = fixtureFetch({ 'meta.json': undefined });
    await expect(loadMeta(BASE, fetch)).rejects.toThrow(/meta\.json.*404/);
  });

  it('names meta.json when it is not JSON', async () => {
    const { fetch } = fixtureFetch({ 'meta.json': '{"repo": ' });
    await expect(loadMeta(BASE, fetch)).rejects.toThrow(/meta\.json/);
  });
});

describe('DataLoader', () => {
  const twoYearFetch = (overrides: Record<string, unknown> = {}) => fixtureFetch({ ...earlier, ...overrides });

  it('loads the years asked for into one dataset', async () => {
    const { fetch } = twoYearFetch();
    const { dataset, errors } = await new DataLoader(twoYears, BASE, fetch).load([2025, 2026]);
    expect(errors).toEqual([]);
    expect(dataset.size).toBe(13);
  });

  it('says which years have arrived, each as it does, a year that failed never', async () => {
    const { fetch } = twoYearFetch();
    const loader = new DataLoader(twoYears, BASE, (url) =>
      url.endsWith('events-2025.json') ? Promise.resolve(new Response('', { status: 503 })) : fetch(url),
    );
    const arrived: number[] = [];
    await loader.load([2026, 2025], (y) => arrived.push(y));
    expect(arrived).toEqual([2026]);
    expect([loader.has(2025), loader.has(2026)]).toEqual([false, true]);
    arrived.length = 0;
    await loader.load([2026], (y) => arrived.push(y));
    expect(arrived).toEqual([2026]);
  });

  it("fetches only the years asked for: the fixture's last six months need 2026 alone", async () => {
    const { fetch, requested } = twoYearFetch();
    await new DataLoader(twoYears, BASE, fetch).load([2026]);
    expect(requested).toEqual([`${BASE}prs-2026.json`, `${BASE}events-2026.json`]);
  });

  it('does not fetch the tables until asked, then fetches the one year', async () => {
    const { fetch, requested } = fixtureFetch();
    const loader = new DataLoader(meta, BASE, fetch);
    await loader.load([2026]);
    expect(requested.some((u) => u.includes('table-'))).toBe(false);
    const table = await loader.table(2026);
    expect(table.titles).toEqual(table2026.titles);
    expect(table.authors).toEqual(table2026.authors);
    expect(table.refs).toEqual(table2026.refs);
    expect(table.kind_source).toEqual(table2026.kind_source);
    expect(requested.filter((u) => u.includes('table-'))).toEqual([`${BASE}table-2026.json`]);
  });

  it('fetches each file once across loads', async () => {
    const { fetch, requested } = twoYearFetch();
    const loader = new DataLoader(twoYears, BASE, fetch);
    await loader.load([2026]);
    await loader.load([2025, 2026]);
    await loader.load([2026]);
    expect(requested.filter((u) => u.endsWith('prs-2026.json'))).toHaveLength(1);
    expect(requested.filter((u) => u.endsWith('prs-2025.json'))).toHaveLength(1);
  });

  it('gives a dataset of the years asked for alone, though more were loaded before', async () => {
    const { fetch } = twoYearFetch();
    const loader = new DataLoader(twoYears, BASE, fetch);
    await loader.load([2025, 2026]);
    const { dataset } = await loader.load([2026]);
    expect(dataset.years.map((y) => y.year)).toEqual([2026]);
    expect(dataset.size).toBe(12);
  });

  it('reports a year file that fails to load by name, and loads the rest', async () => {
    const { fetch } = twoYearFetch({ 'prs-2025.json': undefined });
    const { dataset, errors } = await new DataLoader(twoYears, BASE, fetch).load([2025, 2026]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ file: 'prs-2025.json', year: 2025 });
    expect(errors[0]?.message).toMatch(/404/);
    expect(dataset.size).toBe(12);
    expect(dataset.years.map((y) => y.year)).toEqual([2026]);
  });

  it('reports a year whose columns differ in length by name, and loads the rest', async () => {
    const { fetch } = twoYearFetch({ 'events-2026.json': { ...events2026, kind: events2026.kind.slice(2) } });
    const { dataset, errors } = await new DataLoader(twoYears, BASE, fetch).load([2025, 2026]);
    expect(errors.map((e) => e.file)).toEqual(['events-2026.json']);
    expect(dataset.years.map((y) => y.year)).toEqual([2025]);
  });

  it('reports a year file whose author is outside people by name, and loads the rest', async () => {
    const author = prs2026.author.map((v, i) => (i === 1 ? 99 : v));
    const { fetch } = twoYearFetch({ 'prs-2026.json': { ...prs2026, author } });
    const { dataset, errors } = await new DataLoader(twoYears, BASE, fetch).load([2025, 2026]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ year: 2026, file: 'prs-2026.json' });
    expect(errors[0]?.message).toMatch(/"author" has 99 at row 1, outside "people"/);
    expect(dataset.years.map((y) => y.year)).toEqual([2025]);
  });

  it('rejects a table whose length differs from its year', async () => {
    const { fetch } = fixtureFetch({ 'table-2026.json': { ...table2026, titles: table2026.titles.slice(1) } });
    const loader = new DataLoader(meta, BASE, fetch);
    await expect(loader.table(2026)).rejects.toThrow(/table-2026\.json.*titles/);
  });

  it('rejects a table whose refs do not match its year events', async () => {
    const { fetch } = fixtureFetch({ 'table-2026.json': { ...table2026, refs: table2026.refs.slice(1) } });
    const loader = new DataLoader(meta, BASE, fetch);
    await expect(loader.table(2026)).rejects.toThrow(/table-2026\.json.*"refs".*events-2026\.json has 42 events/);
  });

  /** The fixture with 2025 before it, serving `events-2025.json` only once `reachable` says so. */
  function flaky() {
    const { fetch, requested } = twoYearFetch();
    let reachable = false;
    const flakyFetch: Fetch = (url) =>
      url.endsWith('events-2025.json') && !reachable
        ? (requested.push(url), Promise.resolve(new Response('', { status: 503 })))
        : fetch(url);
    return { fetch: flakyFetch, requested, reach: () => (reachable = true) };
  }

  it('tries a failed year again when it is next asked for', async () => {
    const f = flaky();
    const loader = new DataLoader(twoYears, BASE, f.fetch);
    expect((await loader.load([2025, 2026])).errors.map((e) => e.file)).toEqual(['events-2025.json']);
    f.reach();
    const again = await loader.load([2025, 2026]);
    expect(again.errors).toEqual([]);
    expect(again.dataset.size).toBe(13);
    expect(f.requested.filter((u) => u.endsWith('events-2025.json'))).toHaveLength(2);
    // 2026 loaded the first time and is never fetched again.
    expect(f.requested.filter((u) => u.endsWith('-2026.json'))).toHaveLength(2);
  });

  it('shares one fetch between asks for a year made while it is under way, failed or not', async () => {
    const f = flaky();
    const loader = new DataLoader(twoYears, BASE, f.fetch);
    const [a, b] = await Promise.all([loader.load([2025]), loader.load([2025])]);
    expect(a.errors).toHaveLength(1);
    expect(b.errors).toHaveLength(1);
    expect(f.requested.filter((u) => u.endsWith('events-2025.json'))).toHaveLength(1);
    f.reach();
    await Promise.all([loader.load([2025]), loader.load([2025, 2026])]);
    expect(f.requested.filter((u) => u.endsWith('events-2025.json'))).toHaveLength(2);
  });

  it('says a year that could not be fetched is worth trying again, and fetches it again', async () => {
    const f = flaky();
    const loader = new DataLoader(twoYears, BASE, f.fetch);
    expect((await loader.load([2025])).errors).toEqual([
      { year: 2025, file: 'events-2025.json', message: 'HTTP 503', retry: true },
    ]);
  });

  it('says a year whose file arrived but could not be read is not, and does not fetch it again', async () => {
    const { fetch, requested } = twoYearFetch({ 'events-2025.json': { ...events2025, kind: [99] } });
    const loader = new DataLoader(twoYears, BASE, fetch);
    const first = await loader.load([2025]);
    expect(first.errors).toHaveLength(1);
    expect(first.errors[0]).toMatchObject({ year: 2025, file: 'events-2025.json', retry: false });
    await loader.load([2025]);
    expect(requested.filter((u) => u.endsWith('events-2025.json'))).toHaveLength(1);
  });

  it("reads the earlier year's table", async () => {
    const { fetch } = twoYearFetch();
    const table = await new DataLoader(twoYears, BASE, fetch).table(2025);
    expect(table.titles).toEqual([table2026.titles[0]]);
    expect(table.refs).toHaveLength(5);
  });
});

describe('parseIndex', () => {
  it('reads every PR number and the year whose files hold it', () => {
    const index = parseIndex(earlier['index.json'], twoYears);
    expect(yearOfPr(index, 60010)).toBe(2025);
    expect(yearOfPr(index, 64010)).toBe(2026);
    expect(yearOfPr(index, 67250)).toBe(2026);
    expect(yearOfPr(index, 64011)).toBeNull();
    expect(yearOfPr(index, 1)).toBeNull();
    expect(yearOfPr(index, 99999)).toBeNull();
  });

  it('reads an empty index', () => {
    expect(yearOfPr(parseIndex({ numbers: [], years: [] }, meta), 1)).toBeNull();
  });

  it.each([
    ['not an object', [1, 2], /index\.json/],
    ['without years', { numbers: [1] }, /index\.json.*"years"/],
    ['with columns of different lengths', { numbers: [1, 2], years: [2026] }, /index\.json.*"years" has 1 values where "numbers" has 2/],
    ['with numbers out of order', { numbers: [2, 1], years: [2026, 2026] }, /index\.json.*"numbers".*ascending.*1/],
    ['with a number twice', { numbers: [1, 1], years: [2026, 2026] }, /index\.json.*"numbers".*ascending/],
    ['with a number that is not a PR number', { numbers: [0], years: [2026] }, /index\.json.*"numbers"/],
    ['with a year meta does not list', { numbers: [1], years: [2024] }, /index\.json.*"years" has 2024 at 0, which meta's "years" does not list/],
  ])('rejects an index %s, naming the file', (_name, raw, message) => {
    expect(() => parseIndex(raw, meta)).toThrow(DataError);
    expect(() => parseIndex(raw, meta)).toThrow(message);
  });
});

describe('DataLoader.find', () => {
  it('finds a PR of a year not loaded through the index, loading that year alone', async () => {
    const { fetch, requested } = fixtureFetch(earlier);
    const loader = new DataLoader(twoYears, BASE, fetch);
    await loader.load([2026]);
    expect(requested.some((u) => u.endsWith('index.json'))).toBe(false);
    const found = await loader.find(60010);
    expect(found?.dataset.years.map((y) => y.year)).toEqual([2025]);
    expect(found?.dataset.prs.number[found.row]).toBe(60010);
    expect(requested.slice(2)).toEqual([`${BASE}index.json`, `${BASE}prs-2025.json`, `${BASE}events-2025.json`]);
  });

  it('gives null for a number in no year, fetching the index once across lookups', async () => {
    const { fetch, requested } = fixtureFetch(earlier);
    const loader = new DataLoader(twoYears, BASE, fetch);
    expect(await loader.find(12345)).toBeNull();
    expect(await loader.find(54321)).toBeNull();
    expect(await loader.yearOf(66500)).toBe(2026);
    expect(requested).toEqual([`${BASE}index.json`]);
  });

  it('rejects, naming the file, when the index or the year cannot be loaded', async () => {
    const noIndex = new DataLoader(twoYears, BASE, fixtureFetch({ ...earlier, 'index.json': undefined }).fetch);
    await expect(noIndex.find(60010)).rejects.toThrow(/index\.json.*404/);
    const noYear = new DataLoader(twoYears, BASE, fixtureFetch({ ...earlier, 'prs-2025.json': undefined }).fetch);
    await expect(noYear.find(60010)).rejects.toThrow(/prs-2025\.json.*404/);
  });
});
