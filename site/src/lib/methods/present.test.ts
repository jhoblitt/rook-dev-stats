import { describe, expect, it } from 'vitest';
import events2026 from '../__fixtures__/data/events-2026.json';
import prs2026 from '../__fixtures__/data/prs-2026.json';
import table2026 from '../__fixtures__/data/table-2026.json';
import { NAMED_A, NAMED_B, POOLED, deletedMeta } from '../__fixtures__/deleted';
import { parseMeta, parseTable, parseYear } from '../data';
import { META, at, dataset, fixture } from '../stats/testing';
import {
  type DataFigures,
  INLINE_FIGURES,
  type Loadable,
  TABLE_FIGURES,
  type TableFigures,
  dataFigures,
  inlineView,
  tableFigures,
  tableView,
} from './present';

const data = fixture();
const DAYS = { from: '2026-05-15', to: '2026-11-15' };
const tables = new Map([
  [2026, parseTable(table2026, 'table-2026.json', parseYear(2026, prs2026, events2026, META), META)],
]);
const d: Loadable<DataFigures> = { state: 'ready', value: dataFigures(data, DAYS) };
const t: Loadable<TableFigures> = { state: 'ready', value: tableFigures(data, tables, DAYS) };
const loading = { state: 'loading' } as const;
const failed = { state: 'error', message: 'prs-2026.json: HTTP 404' } as const;

const value = (name: string) => {
  const v = inlineView(name, META, d, t);
  if (v.state !== 'ready') throw new Error(`${name} is ${v.state}`);
  return v.value;
};

describe('inline figures on the fixture', () => {
  it.each([
    ['asOf', '2026-11-15'],
    ['windowStart', '2026-05-15'],
    // The last six months' first day, which is the window's in the fixture.
    ['periodStart', '2026-05-15'],
    ['prs.active', '12'],
    ['prs.openedInPeriod', '9'],
    ['prs.openedBeforePeriod', '3'],
    ['prs.neverReady', '1'],
    ['commits.firstUnknown', '1'],
    ['commits.none', '0'],
    ['standing.unknown', '3'],
    ['kind.unknown', '1'],
    // 1 of 12.
    ['kind.unknownShare', '8.3%'],
    // #66500, #66800, #67000 and #67100.
    ['disclosure.disclosed', '4'],
    ['disclosure.share', '33%'],
    ['comments.total', '11'],
    ['comments.commands', '3'],
    // 3 of 11.
    ['comments.commandShare', '27%'],
    ['comments.commandsByAuthor', '2'],
    ['comments.botAccount', '1'],
    ['refs.forcePushes', '7'],
    ['refs.forcePushesWithoutCommit', '0'],
    ['refs.forcePushShareWithoutCommit', '0%'],
    ['refs.merges', '6'],
    ['refs.mergesWithoutCommit', '0'],
    ['const.minPrs', '5'],
    ['const.horizons', '7, 30 and 90'],
    ['const.minFollowed', '30'],
    ['const.topAuthors', '3'],
    ['const.recentMonths', '6'],
    ['const.laneCap', '200'],
    ['view.prs', '9'],
    // Rows 0 and 2, both not disclosing.
    ['view.openedBefore', '2'],
    ['view.notDisclosedInPeriod', '67%'],
    ['view.disclosedInPeriod', '100%'],
    ['const.reviewsRecordedFrom', '2016-09-14'],
    ['people.authors', '5'],
    ['people.botAuthors', '1'],
    ['people.reviewers', '5'],
    ['people.authorsTooFew', '5'],
    ['people.largestLines', '2,200'],
    // 2,200 of 2,644, the bot dependabot's #66600 left out.
    ['people.largestShare', '83%'],
    // The fixture has no deleted account.
    ['people.deletedNamedPrs', '0'],
    ['people.deletedNames', '0'],
    ['people.deletedPooledPrs', '0'],
  ])('%s is %s', (name, expected) => {
    expect(value(name)).toBe(expected);
  });

  it('has a spec above for every inline figure', () => {
    expect(Object.keys(INLINE_FIGURES).length).toBe(44);
  });
});

describe('the deleted accounts’ figures', () => {
  // Ada two PRs, Åsa one, the pooled entry one, on master in the period.
  const t = at('2026-06-01T00:00:00Z');
  const named = dataset(
    [NAMED_A, NAMED_A, NAMED_B, POOLED].map((author) => ({ created: t, author })),
    [],
    parseMeta(deletedMeta()),
  );
  const figures: Loadable<DataFigures> = { state: 'ready', value: dataFigures(named, DAYS) };
  const noTables: Loadable<TableFigures> = { state: 'loading' };
  const shown = (name: string) => inlineView(name, named.meta, figures, noTables);

  it('counts the PRs credited to names, the names, and the pooled entry’s PRs', () => {
    expect(['people.deletedNamedPrs', 'people.deletedNames', 'people.deletedPooledPrs'].map(shown)).toEqual([
      { state: 'ready', value: '3' },
      { state: 'ready', value: '2' },
      { state: 'ready', value: '1' },
    ]);
  });
});

describe('figures over a period shorter than the window', () => {
  // The window starts two years before the period, as the full history's
  // does before its last six months: #1 was opened in the window but before
  // the period and is still open, #2 was opened in the period, #3 finished
  // before the period, and #4, of unknown standing, was opened before the
  // window.
  const meta = { window_start: at('2024-05-15T00:00:00Z') };
  const early = dataset(
    [
      { number: 1, created: at('2025-01-01T00:00:00Z'), standing: -1 },
      { number: 2, created: at('2026-06-01T00:00:00Z'), standing: 3 },
      { number: 3, created: at('2025-01-01T00:00:00Z'), closed: at('2025-02-01T00:00:00Z'), state: 1 },
      { number: 4, created: at('2024-01-01T00:00:00Z'), in_window: 0, standing: -1 },
    ],
    [],
    meta,
  );
  const f: Loadable<DataFigures> = { state: 'ready', value: dataFigures(early, DAYS) };
  const show = (name: string) => {
    const v = inlineView(name, early.meta, f, loading);
    if (v.state !== 'ready') throw new Error(`${name} is ${v.state}`);
    return v.value;
  };

  it.each([
    ['prs.active', '3'],
    ['prs.openedInPeriod', '1'],
    ['prs.openedBeforePeriod', '2'],
    ['standing.unknown', '2'],
    ['view.prs', '3'],
    ['view.openedBefore', '2'],
    ['view.notDisclosedInPeriod', '33%'],
  ])('%s is %s', (name, expected) => {
    expect(show(name)).toBe(expected);
  });

  it('names the period it was given in its captions', () => {
    const v = tableView('table.disclosureForms', early.meta, f, loading);
    if (v.state !== 'ready') throw new Error(`the table is ${v.state}`);
    expect(v.value.caption).toBe(
      'Pull requests by the strongest form of disclosure they make, of the 3 pull requests open at some point in the last 6 months, 2026-05-15 to 2026-11-15, as of 2026-11-15',
    );
  });
});

describe('figure states', () => {
  it('shows a figure of meta at once', () => {
    expect(inlineView('asOf', META, loading, loading)).toEqual({ state: 'ready', value: '2026-11-15' });
  });

  it('waits for the data, and for the tables when it needs them', () => {
    expect(inlineView('prs.active', META, loading, loading)).toEqual({ state: 'loading' });
    expect(inlineView('prs.active', META, d, loading).state).toBe('ready');
    expect(inlineView('refs.forcePushes', META, d, loading)).toEqual({ state: 'loading' });
  });

  it('fails a figure whose data or tables failed, and no other', () => {
    expect(inlineView('prs.active', META, failed, loading)).toEqual({ state: 'error' });
    expect(inlineView('refs.forcePushes', META, d, failed)).toEqual({ state: 'error' });
    expect(inlineView('prs.active', META, d, failed).state).toBe('ready');
    expect(inlineView('refs.forcePushes', META, failed, loading)).toEqual({ state: 'error' });
  });

  it('throws for a name no figure has', () => {
    expect(() => inlineView('prs.nothing', META, d, t)).toThrow(/no inline figure is named "prs.nothing"/);
    expect(() => tableView('table.nothing', META, d, t)).toThrow(/no table figure is named "table.nothing"/);
  });
});

describe('table figures on the fixture', () => {
  const model = (name: string) => {
    const v = tableView(name, META, d, t);
    if (v.state !== 'ready') throw new Error(`${name} is ${v.state}`);
    return v.value;
  };

  it('has a spec below for every table', () => {
    expect(Object.keys(TABLE_FIGURES)).toEqual([
      'table.kindSources',
      'table.disclosureForms',
      'table.families',
      'table.disclosureGroups',
      'table.eventRefs',
    ]);
  });

  it('says where each kind came from, by target', () => {
    expect(model('table.kindSources')).toEqual({
      caption:
        'Where each pull request’s kind came from, of the 12 pull requests open at some point in the last 6 months, 2026-05-15 to 2026-11-15, as of 2026-11-15',
      head: ['decided by', 'development branch', 'other branches', 'all'],
      rows: [
        ['a kind label', '7', '1', '8'],
        ['a kind label of an issue it closes', '2', '0', '2'],
        ['the PR it backports', '0', '1', '1'],
        ['unknown: no source decided', '0', '1', '1'],
      ],
    });
  });

  it('lists the forms of disclosure strongest first', () => {
    expect(model('table.disclosureForms').rows).toEqual([
      ['a disclosing trailer, such as Assisted-by:', '2', '0', '2'],
      ['Co-authored-by: naming a tool', '1', '0', '1'],
      ['disclosure phrasing in the description or a commit message', '0', '0', '0'],
      ['the PR template’s AI-guidelines box, ticked', '0', '1', '1'],
      ['AI use not disclosed', '6', '2', '8'],
    ]);
  });

  it('lists the tool families in meta order', () => {
    expect(model('table.families').caption).toBe(
      'Pull requests naming each tool family, of the 12 pull requests open at some point in the last 6 months, 2026-05-15 to 2026-11-15, as of 2026-11-15. A pull request naming two families counts under both.',
    );
    expect(model('table.families').rows).toEqual([
      ['Claude', '2', '0', '2'],
      ['GitHub Copilot', '1', '0', '1'],
      ['unspecified', '0', '1', '1'],
    ]);
  });

  it('sets side by side the two groups the AI-use section compares over the last six months', () => {
    // Rows 3, 4, 5, 6, 8, 9 and 10: master, opened in the period.
    expect(model('table.disclosureGroups')).toEqual({
      caption:
        'The 7 pull requests on the development branch opened in the last 6 months, 2026-05-15 to 2026-11-15, those the AI-use section compares over those months with every other filter as the report opens, by disclosure, as of 2026-11-15',
      head: ['', 'AI use not disclosed', 'AI use disclosed'],
      rows: [
        ['pull requests', '4', '3'],
        ['median lines changed', '70', '90'],
        ['median time since opened, at the last fetch', '153 days', '102 days'],
        ["opened by the group's 3 most active authors", '75%', '100%'],
        ['kind: bug fix', '0%', '33%'],
        ['kind: feature', '50%', '33%'],
        ['kind: cleanup', '0%', '0%'],
        ['kind: documentation', '25%', '0%'],
        ['kind: other', '25%', '33%'],
        ['kind: unknown', '0%', '0%'],
      ],
    });
  });

  it('counts the events with no address of their own', () => {
    expect(model('table.eventRefs').caption).toBe(
      'Events in the last 6 months, 2026-05-15 to 2026-11-15, on the 12 pull requests open at some point in them, and those with no address of their own, as of 2026-11-15',
    );
    const rows = model('table.eventRefs').rows;
    expect(rows).toContainEqual(['reopened', '1', '1 (100%)']);
    expect(rows).toContainEqual(['a force-push', '7', '0 (0%)']);
    expect(rows).toContainEqual(['a comment by a bot account', '1', '1 (100%)']);
    expect(rows).toHaveLength(14);
  });
});
