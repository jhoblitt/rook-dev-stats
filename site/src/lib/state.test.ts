import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import rawMeta from './__fixtures__/data/meta.json';
import { NAME_A, NAME_B, deletedMeta } from './__fixtures__/deleted';
import { parseMeta } from './data';
import {
  type AppState,
  type HashLocation,
  createStateStore,
  dataDays,
  defaultFilters,
  defaultState,
  hashFromState,
  monthsBefore,
  parseHash,
  recentFilters,
  reportSectionHash,
  routeHash,
  sectionHash,
  stateFromHash,
} from './state';

const meta = parseMeta(rawMeta);

// The fixture's window starts 2026-05-15 and was fetched through 2026-11-15.
const defaults: AppState = {
  route: 'report',
  filters: {
    from: '2026-05-15',
    to: '2026-11-15',
    target: 'master',
    base: null,
    backportLink: null,
    component: null,
    size: null,
    standing: null,
    disclosure: null,
    kind: null,
    excludeDrafts: false,
    reopenedOnly: false,
    author: null,
    reviewer: null,
  },
  week: null,
  band: null,
  pr: null,
  sort: { column: 'opened', descending: true },
  authorSort: { column: 'opened', descending: true },
  reviewerSort: { column: 'prs', descending: true },
  bots: false,
  section: null,
};

function withFilters(patch: Partial<AppState['filters']>): AppState {
  return { ...defaults, filters: { ...defaults.filters, ...patch } };
}

describe('stateFromHash defaults', () => {
  it.each(['', '#', '#/', '#/?'])('yields the defaults for %j', (hash) => {
    expect(stateFromHash(hash, meta)).toEqual(defaults);
  });

  it('matches defaultState', () => {
    expect(defaultState(meta)).toEqual(defaults);
  });
});

describe('round trip through the hash', () => {
  const full: AppState = {
    route: 'methods',
    filters: {
      from: '2026-06-01',
      to: '2026-09-30',
      target: 'backports',
      base: 'squid',
      backportLink: 'unlinked',
      component: 'rgw',
      size: '101-1000',
      standing: 'unknown',
      disclosure: 'not-disclosed',
      kind: 'docs',
      excludeDrafts: true,
      reopenedOnly: true,
      author: 'fixture-author-d',
      reviewer: 'fixture-reviewer-k',
    },
    week: '2026-06-01',
    band: '30-90',
    pr: 66600,
    sort: { column: 'size', descending: false },
    authorSort: { column: 'lines', descending: true },
    reviewerSort: { column: 'response', descending: false },
    bots: true,
    section: 'disclosure',
  };

  it('preserves every field at once', () => {
    expect(stateFromHash(hashFromState(full, meta), meta)).toEqual(full);
  });

  it.each([
    ['route', { route: 'methods' }],
    ['period', { filters: { ...defaults.filters, from: '2026-07-01', to: '2026-07-31' } }],
    ['target all', { filters: { ...defaults.filters, target: 'all' } }],
    ['target backports', { filters: { ...defaults.filters, target: 'backports' } }],
    ['branch under master', { filters: { ...defaults.filters, base: 'master' } }],
    ['branch under backports', { filters: { ...defaults.filters, target: 'backports', base: 'reef' } }],
    ['branch under all', { filters: { ...defaults.filters, target: 'all', base: 'tentacle' } }],
    ['backport link', { filters: { ...defaults.filters, backportLink: 'linked' } }],
    ['no backport link', { filters: { ...defaults.filters, backportLink: 'unlinked' } }],
    ['component', { filters: { ...defaults.filters, component: 'cephfs' } }],
    ['size band', { filters: { ...defaults.filters, size: 'le10' } }],
    ['standing band', { filters: { ...defaults.filters, standing: 'first' } }],
    ['disclosure', { filters: { ...defaults.filters, disclosure: 'disclosed' } }],
    ['kind bugfix', { filters: { ...defaults.filters, kind: 'bugfix' } }],
    ['kind feature', { filters: { ...defaults.filters, kind: 'feature' } }],
    ['kind cleanup', { filters: { ...defaults.filters, kind: 'cleanup' } }],
    ['kind docs', { filters: { ...defaults.filters, kind: 'docs' } }],
    ['kind other', { filters: { ...defaults.filters, kind: 'other' } }],
    ['kind unknown', { filters: { ...defaults.filters, kind: 'unknown' } }],
    ['drafts', { filters: { ...defaults.filters, excludeDrafts: true } }],
    ['reopened', { filters: { ...defaults.filters, reopenedOnly: true } }],
    ['author', { filters: { ...defaults.filters, author: 'fixture-author-a' } }],
    ['reviewer', { filters: { ...defaults.filters, reviewer: 'fixture-author-e' } }],
    ['a bot as author', { filters: { ...defaults.filters, author: 'fixture-author-j' } }],
    ['week', { week: '2026-11-09' }],
    ['band', { band: 'lt7' }],
    ['pr', { pr: 64010 }],
    ['sort ascending', { sort: { column: 'title', descending: false } }],
    ['sort descending', { sort: { column: 'reopened', descending: true } }],
    ['authors by author ascending', { authorSort: { column: 'author', descending: false } }],
    ['authors by lines changed', { authorSort: { column: 'lines', descending: true } }],
    ['reviewers by first responses', { reviewerSort: { column: 'first', descending: true } }],
    ['reviewers by median response ascending', { reviewerSort: { column: 'response', descending: false } }],
    ['bots shown', { bots: true }],
  ] satisfies [string, Partial<AppState>][])('preserves %s', (_name, patch) => {
    const state = { ...defaults, ...patch };
    expect(stateFromHash(hashFromState(state, meta), meta)).toEqual(state);
  });

  it('writes only the target for the defaults, so the default period follows the data', () => {
    expect(hashFromState(defaults, meta)).toBe('#/?target=master');
  });

  it('writes a period that differs from the default', () => {
    const params = new URLSearchParams(hashFromState(withFilters({ from: '2026-06-01' }), meta).split('?')[1]);
    expect(params.get('from')).toBe('2026-06-01');
    expect(params.has('to')).toBe(false);
  });

  it('writes the start beside an end of its own, even the default start', () => {
    expect(hashFromState(withFilters({ to: '2026-08-31' }), meta)).toBe('#/?target=master&from=2026-05-15&to=2026-08-31');
  });

  it('writes the kind as its id after the component, or unknown', () => {
    expect(hashFromState(withFilters({ component: 'rgw', kind: 'feature' }), meta)).toBe(
      '#/?target=master&component=rgw&kind=feature',
    );
    expect(hashFromState(withFilters({ kind: 'unknown' }), meta)).toBe('#/?target=master&kind=unknown');
  });

  it('writes the branch and the backport link right after the target', () => {
    expect(
      hashFromState(withFilters({ target: 'backports', base: 'reef', backportLink: 'unlinked', component: 'rgw' }), meta),
    ).toBe('#/?target=backports&base=reef&backport=unlinked&component=rgw');
    expect(hashFromState(withFilters({ backportLink: 'linked' }), meta)).toBe('#/?target=master&backport=linked');
  });

  it('writes the author and the reviewer as logins, after the other filters', () => {
    expect(hashFromState(withFilters({ reopenedOnly: true, author: 'fixture-author-a', reviewer: 'fixture-author-e' }), meta)).toBe(
      '#/?target=master&reopened=only&author=fixture-author-a&reviewer=fixture-author-e',
    );
  });

  it('writes the table sort last, as a column or a minus and a column, and leaves out the default', () => {
    expect(hashFromState({ ...defaults, pr: 66600, sort: { column: 'size', descending: false } }, meta)).toBe(
      '#/?target=master&pr=66600&sort=size',
    );
    expect(hashFromState({ ...defaults, sort: { column: 'title', descending: true } }, meta)).toBe('#/?target=master&sort=-title');
    expect(hashFromState({ ...defaults, sort: { column: 'opened', descending: true } }, meta)).toBe('#/?target=master');
  });

  it("writes the People tables' orders and the bots after the PR table's order, leaving out the defaults", () => {
    expect(
      hashFromState(
        {
          ...defaults,
          sort: { column: 'size', descending: true },
          authorSort: { column: 'lines', descending: true },
          reviewerSort: { column: 'first', descending: false },
          bots: true,
        },
        meta,
      ),
    ).toBe('#/?target=master&sort=-size&authorsort=-lines&reviewersort=first&bots=show');
    expect(hashFromState({ ...defaults, authorSort: { column: 'opened', descending: true } }, meta)).toBe('#/?target=master');
  });

  it('puts the route in the hash path', () => {
    expect(hashFromState({ ...defaults, route: 'methods' }, meta)).toMatch(/^#\/methods\?/);
    expect(hashFromState(defaults, meta)).toMatch(/^#\/\?/);
  });

  it('keeps the filters and selection when changing page, and leaves a methods section behind', () => {
    expect(stateFromHash(routeHash(full, 'report', meta), meta)).toEqual({ ...full, route: 'report', section: null });
  });
});

describe('unknown values fall back to their defaults', () => {
  it.each([
    ['route', '#/nowhere'],
    ['target', '#/?target=feature-branches'],
    ['branch the data does not name', '#/?base=no-such-branch'],
    ['branch named in another case', '#/?base=MAIN'],
    ['branch that is empty', '#/?base='],
    ['branch named like a prototype key', '#/?base=__proto__'],
    ['branch outside the target', '#/?target=master&base=reef'],
    ['backport link', '#/?backport=maybe'],
    ['component', '#/?component=no-such-component'],
    ['component named like a prototype key', '#/?component=__proto__'],
    ['size band', '#/?size=huge'],
    ['standing band', '#/?standing=veteran'],
    ['disclosure', '#/?disclosure=ai-written'],
    ['kind', '#/?kind=refactor'],
    ['kind named rather than given by id', '#/?kind=Bug%20fix'],
    ['kind named like a prototype key', '#/?kind=__proto__'],
    ['kind that is empty', '#/?kind='],
    ['drafts', '#/?drafts=maybe'],
    ['reopened', '#/?reopened=yes'],
    ['author the data does not name', '#/?author=someone-else'],
    ['author that is empty', '#/?author='],
    ['author named like a prototype key', '#/?author=__proto__'],
    ['reviewer the data does not name', '#/?reviewer=someone-else'],
    ['reviewer that is a person index, not a login', '#/?reviewer=4'],
    ['band', '#/?band=old'],
    ['pr that is not a number', '#/?pr=abc'],
    ['pr that is zero', '#/?pr=0'],
    ['pr that is negative', '#/?pr=-3'],
    ['pr in exponent form', '#/?pr=1e4'],
    ['pr with a fraction', '#/?pr=66600.5'],
    ['week that is not a Monday', '#/?week=2026-06-02'],
    ['week that is not a date', '#/?week=soon'],
    ['sort by an unknown column', '#/?sort=colour'],
    ['sort that is a bare minus', '#/?sort=-'],
    ['authors sorted by a PR table column', '#/?authorsort=title'],
    ['authors sorted by a reviewer column', '#/?authorsort=-prs'],
    ['reviewers sorted by an unknown column', '#/?reviewersort=colour'],
    ['bots other than show', '#/?bots=yes'],
    ['an unknown parameter', '#/?colour=blue'],
  ])('%s', (_name, hash) => {
    expect(stateFromHash(hash, meta)).toEqual(defaults);
  });

  it('takes a login in any case as the login the data gives, as GitHub does', () => {
    expect(stateFromHash('#/?author=FIXTURE-Author-A&reviewer=Fixture-Reviewer-K', meta).filters).toMatchObject({
      author: 'fixture-author-a',
      reviewer: 'fixture-reviewer-k',
    });
  });

  it('keeps the valid parameters beside an unknown one', () => {
    expect(stateFromHash('#/?target=all&size=huge&component=rbd', meta)).toEqual(
      withFilters({ target: 'all', component: 'rbd' }),
    );
  });

  it('takes the first of a repeated parameter', () => {
    expect(stateFromHash('#/?target=all&target=backports', meta).filters.target).toBe('all');
  });
});

describe('the author filter in the address, with deleted accounts', () => {
  const named = parseMeta(deletedMeta());

  it.each([
    ['a space', NAME_A],
    ['an ampersand, a percent sign and letters outside ASCII', NAME_B],
  ])('round-trips a deleted account known by a name with %s', (_what, name) => {
    const state = { ...defaultState(named), filters: { ...defaultFilters(named), author: `ghost:${name}` } };
    const hash = hashFromState(state, named);
    // The name is encoded, so nothing in it ends the parameter or starts another.
    expect(hash).toBe(`#/?target=master&author=${encodeURIComponent(`ghost:${name}`)}`);
    expect(stateFromHash(hash, named)).toEqual(state);
  });

  it('writes a name with characters the address would read otherwise as escapes', () => {
    expect(hashFromState({ ...defaultState(named), filters: { ...defaultFilters(named), author: `ghost:${NAME_B}` } }, named)).toBe(
      '#/?target=master&author=ghost%3A%C3%85sa%20Prov%20%26%20S%C3%B6ner%20100%25',
    );
  });

  it('still takes an old address with author=ghost as the pooled entry', () => {
    expect(stateFromHash('#/?author=ghost', named).filters.author).toBe('ghost');
    expect(stateFromHash('#/?author=ghost', meta).filters.author).toBeNull();
    expect(stateFromHash('#/?author=ghost', parseMeta(deletedMeta(false))).filters.author).toBe('ghost');
  });

  it('takes a name as the page writes it, and writes it back as the data gives it', () => {
    const state = stateFromHash(`#/?author=${encodeURIComponent(`(deleted) ${NAME_A}`)}`, named);
    expect(state.filters.author).toBe(`ghost:${NAME_A}`);
    expect(hashFromState(state, named)).toBe(`#/?target=master&author=${encodeURIComponent(`ghost:${NAME_A}`)}`);
  });

  it('takes a name the data does not hold as no filter', () => {
    expect(stateFromHash('#/?author=ghost%3ASomeone%20Else', named).filters.author).toBeNull();
  });
});

describe('the Branch filter in the address', () => {
  const odd = parseMeta({ ...rawMeta, bases: ['feature/ptl-ci-test', 'main', 'pacific-16.2.7_RC1', 'reef', 'wip-a&b=c#d%e'] });

  it.each([
    ['a slash', 'feature/ptl-ci-test', 'feature%2Fptl-ci-test'],
    ['dots and an underscore', 'pacific-16.2.7_RC1', 'pacific-16.2.7_RC1'],
    ['characters the address would read otherwise', 'wip-a&b=c#d%e', 'wip-a%26b%3Dc%23d%25e'],
  ])('round-trips a branch name with %s', (_what, base, written) => {
    const state = { ...defaultState(odd), filters: { ...defaultFilters(odd), target: 'backports' as const, base } };
    const hash = hashFromState(state, odd);
    expect(hash).toBe(`#/?target=backports&base=${written}`);
    expect(stateFromHash(hash, odd)).toEqual(state);
  });

  it('takes a branch the data does not name as no filter, keeping the others', () => {
    expect(stateFromHash('#/?target=backports&base=octopus&backport=linked', odd).filters).toMatchObject({
      target: 'backports',
      base: null,
      backportLink: 'linked',
    });
  });
});

describe('malformed hashes yield the defaults', () => {
  it.each([
    '#%',
    '#/?%E0%A4%A',
    '#/?target',
    '#/?&&==&',
    '##/methods',
    '#/?target=%',
    '#/?from=2026-13-45',
    '#/?from=2026-02-30',
    '#/?to=20261101',
    '#/?pr=%F0',
    'not a hash at all',
  ])('%j', (hash) => {
    expect(stateFromHash(hash, meta)).toEqual(defaults);
  });
});

const utc = (iso: string) => Date.parse(iso) / 1000;

/** The fixture's meta with its window and its fetch moved. */
function metaWith(windowStart: string, fetchedThrough: string) {
  return parseMeta({ ...rawMeta, window_start: utc(windowStart), fetched_through: utc(fetchedThrough) });
}

describe('monthsBefore', () => {
  it.each([
    ['2026-11-15', '2026-05-15'],
    ['2026-11-16', '2026-05-16'],
    ['2026-02-10', '2025-08-10'],
    ['2026-07-01', '2026-01-01'],
    // A day the month six back does not have is that month's last.
    ['2026-08-31', '2026-02-28'],
    ['2028-08-31', '2028-02-29'],
    ['2026-03-31', '2025-09-30'],
    ['2026-12-31', '2026-06-30'],
  ])('six calendar months before %s is %s', (day, expected) => {
    expect(monthsBefore(day, 6)).toBe(expected);
  });
});

describe('the default period', () => {
  it('is the whole window, on the development branch, on fifteen years of data', () => {
    const m = metaWith('2011-03-04T00:00:00Z', '2026-11-16T07:36:00Z');
    expect(defaultFilters(m)).toEqual({ ...defaults.filters, from: '2011-03-04', to: '2026-11-16', target: 'master' });
  });

  it('is the whole window on three months of data', () => {
    const m = metaWith('2026-08-16T00:00:00Z', '2026-11-16T07:36:00Z');
    expect(defaultFilters(m)).toMatchObject({ from: '2026-08-16', to: '2026-11-16' });
  });

  it('is the one day the data covers when the window starts on the day of the last fetch', () => {
    const m = metaWith('2026-11-16T00:00:00Z', '2026-11-16T07:36:00Z');
    expect(defaultFilters(m)).toMatchObject({ from: '2026-11-16', to: '2026-11-16' });
  });

  it("is the fixture's whole window, as before", () => {
    expect(defaultFilters(meta)).toMatchObject({ from: '2026-05-15', to: '2026-11-15' });
  });
});

describe('the recent period', () => {
  it.each([
    ['2026-11-15T06:00:00Z', '2026-05-15', '2026-11-15'],
    ['2026-11-16T07:36:00Z', '2026-05-16', '2026-11-16'],
    // A day the month six back does not have is that month's last.
    ['2026-08-31T06:00:00Z', '2026-02-28', '2026-08-31'],
    ['2028-08-31T06:00:00Z', '2028-02-29', '2028-08-31'],
    ['2028-02-29T06:00:00Z', '2027-08-29', '2028-02-29'],
    ['2026-12-31T23:00:00Z', '2026-06-30', '2026-12-31'],
  ])('fetched through %s, is the six calendar months from %s to %s', (fetched, from, to) => {
    const m = metaWith('2011-03-04T00:00:00Z', fetched);
    expect(recentFilters(m)).toEqual({ ...defaultFilters(m), from, to });
  });

  it('never starts before the window does', () => {
    expect(recentFilters(metaWith('2026-09-01T00:00:00Z', '2026-11-15T06:00:00Z'))).toMatchObject({
      from: '2026-09-01',
      to: '2026-11-15',
    });
    expect(recentFilters(metaWith('2026-11-16T00:00:00Z', '2026-11-16T07:36:00Z'))).toMatchObject({
      from: '2026-11-16',
      to: '2026-11-16',
    });
  });

  it("is the fixture's whole window, which is six months long", () => {
    expect(recentFilters(meta)).toEqual(defaultFilters(meta));
  });
});

describe('the address of a period on fifteen years of data', () => {
  const long = metaWith('2011-03-04T00:00:00Z', '2026-11-15T06:00:00Z');
  const state = (hash: string) => stateFromHash(hash, long);
  const period = (hash: string) => {
    const { from, to } = state(hash).filters;
    return { from, to };
  };
  const round = (hash: string) => hashFromState(state(hash), long);

  it('bounds the days by the window and the last fetch', () => {
    expect(dataDays(long)).toEqual({ first: '2011-03-04', last: '2026-11-15' });
  });

  it('names no period for the whole history, and reads an address naming none as the whole history', () => {
    expect(period('#/')).toEqual({ from: '2011-03-04', to: '2026-11-15' });
    expect(hashFromState(defaultState(long), long)).toBe('#/?target=master');
    expect(round('#/?from=2011-03-04&to=2026-11-15')).toBe('#/?target=master');
  });

  it('keeps an explicit six-month period through a round trip', () => {
    expect(period('#/?from=2026-05-15&to=2026-11-15')).toEqual({ from: '2026-05-15', to: '2026-11-15' });
    expect(round('#/?from=2026-05-15&to=2026-11-15')).toBe('#/?target=master&from=2026-05-15');
    expect(period('#/?target=master&from=2026-05-15')).toEqual({ from: '2026-05-15', to: '2026-11-15' });
    const recent = { ...defaultState(long), filters: recentFilters(long) };
    expect(stateFromHash(hashFromState(recent, long), long)).toEqual(recent);
  });

  it('keeps a start between the window and the last fetch', () => {
    expect(period('#/?from=2015-06-01')).toEqual({ from: '2015-06-01', to: '2026-11-15' });
    expect(period('#/?from=2011-03-04&to=2012-01-31')).toEqual({ from: '2011-03-04', to: '2012-01-31' });
    expect(round('#/?from=2011-03-04&to=2012-01-31')).toBe('#/?target=master&from=2011-03-04&to=2012-01-31');
  });

  it('reads an end named alone, as the report wrote it when it opened on six months, from the start of the last six months', () => {
    expect(period('#/?to=2026-08-31')).toEqual({ from: '2026-05-15', to: '2026-08-31' });
    expect(round('#/?to=2026-08-31')).toBe('#/?target=master&from=2026-05-15&to=2026-08-31');
    // An end before that start was read as the last six months, and still is.
    expect(period('#/?to=2020-01-01')).toEqual({ from: '2026-05-15', to: '2026-11-15' });
  });

  it('defaults a start before the window, and a period that ends before it starts, to the whole history', () => {
    expect(period('#/?from=2011-03-03')).toEqual({ from: '2011-03-04', to: '2026-11-15' });
    expect(period('#/?from=2020-01-01&to=2019-01-01')).toEqual({ from: '2011-03-04', to: '2026-11-15' });
  });

  it('keeps a month bucket over a fifteen-year period', () => {
    expect(state('#/?week=2011-03-01').week).toBe('2011-03-01');
    expect(state('#/?from=2011-03-04&week=2011-03-01').week).toBe('2011-03-01');
    expect(state('#/?from=2011-03-04&week=2011-02-28').week).toBeNull();
  });
});

describe('a period outside the data', () => {
  it.each([
    ['entirely before the window', '#/?from=2020-01-01&to=2020-02-01'],
    ['entirely after the data', '#/?from=2027-01-01&to=2027-02-01'],
    ['reversed', '#/?from=2026-09-01&to=2026-06-01'],
  ])('yields the default period when %s', (_name, hash) => {
    expect(stateFromHash(hash, meta).filters).toEqual(defaults.filters);
  });

  it('keeps the end that lies inside the data and defaults the other', () => {
    expect(stateFromHash('#/?from=2026-06-01&to=2030-01-01', meta).filters).toEqual(
      withFilters({ from: '2026-06-01' }).filters,
    );
    expect(stateFromHash('#/?from=2026-01-01&to=2026-08-31', meta).filters).toEqual(
      withFilters({ to: '2026-08-31' }).filters,
    );
  });

  it('drops a selected week that does not overlap the period', () => {
    expect(stateFromHash('#/?from=2026-07-01&to=2026-07-31&week=2026-06-01', meta).week).toBeNull();
  });

  it('keeps a selected week that overlaps the start of the period', () => {
    expect(stateFromHash('#/?from=2026-06-03&week=2026-06-01', meta).week).toBe('2026-06-01');
  });
});

describe('the selected bucket over a period beyond 53 weeks', () => {
  // Fetched through 2027-11-15 and starting at the window, so the period steps by month.
  const longMeta = parseMeta({ ...rawMeta, fetched_through: Date.UTC(2027, 10, 15) / 1000 });
  const from = 'from=2026-05-15';

  it('keeps the first of a month', () => {
    expect(stateFromHash(`#/?${from}&week=2026-07-01`, longMeta).week).toBe('2026-07-01');
  });

  it('keeps a month that overlaps the start of the period', () => {
    expect(stateFromHash(`#/?${from}&week=2026-05-01`, longMeta).week).toBe('2026-05-01');
  });

  it('drops a Monday that is not the first of a month, which names no bucket', () => {
    expect(stateFromHash(`#/?${from}&week=2026-06-08`, longMeta).week).toBeNull();
  });

  it('drops a first of the month when the period steps by week', () => {
    expect(stateFromHash(`#/?${from}&to=2027-05-12&week=2026-07-01`, longMeta).week).toBeNull();
    expect(stateFromHash(`#/?${from}&to=2027-05-12&week=2026-07-06`, longMeta).week).toBe('2026-07-06');
  });
});

describe('parseHash', () => {
  it('reads the route and the first value of each parameter', () => {
    expect(parseHash('#/methods/?target=all&pr=12&pr=13')).toEqual({
      route: 'methods',
      params: { target: 'all', pr: '12' },
    });
  });

  it('never throws on a broken escape', () => {
    expect(() => parseHash('#/?%')).not.toThrow();
  });
});

/** A HashLocation over an in-memory history, recording every write. */
function fakeLocation(initial: string) {
  let hash = initial;
  let listener: (() => void) | undefined;
  const writes: string[] = [];
  const loc: HashLocation = {
    read: () => hash,
    push: (h) => {
      hash = h;
      writes.push(`push ${h}`);
    },
    replace: (h) => {
      hash = h;
      writes.push(`replace ${h}`);
    },
    listen: (onChange) => {
      listener = onChange;
      return () => (listener = undefined);
    },
  };
  return {
    loc,
    writes,
    navigate(h: string) {
      hash = h;
      listener?.();
    },
    listening: () => listener !== undefined,
  };
}

describe('createStateStore', () => {
  it('restores the state from the hash on load and canonicalises the hash', () => {
    const f = fakeLocation('#/?pr=66600&target=all&size=huge');
    const store = createStateStore(meta, f.loc);
    expect(get(store)).toEqual({ ...withFilters({ target: 'all' }), pr: 66600 });
    expect(f.writes).toEqual(['replace #/?target=all&pr=66600']);
  });

  it('leaves a canonical hash alone on load', () => {
    const f = fakeLocation('#/?target=master');
    createStateStore(meta, f.loc);
    expect(f.writes).toEqual([]);
  });

  it('pushes a history entry for a change, or replaces when asked', () => {
    const f = fakeLocation('');
    const store = createStateStore(meta, f.loc);
    store.update((s) => ({ ...s, filters: { ...s.filters, target: 'all' } }));
    store.update((s) => ({ ...s, pr: 66500 }), { replace: true });
    expect(f.writes).toEqual([
      'replace #/?target=master',
      'push #/?target=all',
      'replace #/?target=all&pr=66500',
    ]);
    expect(get(store).pr).toBe(66500);
  });

  it('returns the branch to any when the target changes to one that does not hold it, and says so in the address', () => {
    const f = fakeLocation('#/?target=backports&base=reef&backport=unlinked');
    const store = createStateStore(meta, f.loc);
    expect(get(store).filters.base).toBe('reef');
    store.update((s) => ({ ...s, filters: { ...s.filters, target: 'all' } }));
    expect(get(store).filters.base).toBe('reef');
    store.update((s) => ({ ...s, filters: { ...s.filters, target: 'master' } }));
    expect(get(store).filters).toMatchObject({ target: 'master', base: null, backportLink: 'unlinked' });
    store.update((s) => ({ ...s, filters: { ...s.filters, target: 'backports' } }));
    expect(get(store).filters.base).toBeNull();
    expect(f.writes).toEqual([
      'push #/?target=all&base=reef&backport=unlinked',
      'push #/?target=master&backport=unlinked',
      'push #/?target=backports&backport=unlinked',
    ]);
  });

  it('keeps master as the branch when the target goes from master to all, and drops it going to backports', () => {
    const f = fakeLocation('#/?target=master&base=master');
    const store = createStateStore(meta, f.loc);
    store.update((s) => ({ ...s, filters: { ...s.filters, target: 'all' } }));
    expect(get(store).filters.base).toBe('master');
    store.update((s) => ({ ...s, filters: { ...s.filters, target: 'backports' } }));
    expect(get(store).filters.base).toBeNull();
    expect(f.writes).toEqual(['push #/?target=all&base=master', 'push #/?target=backports']);
  });

  it('validates what is written', () => {
    const f = fakeLocation('');
    const store = createStateStore(meta, f.loc);
    store.set(withFilters({ component: 'no-such-component', from: '1999-01-01' }));
    expect(get(store)).toEqual(defaults);
    expect(f.writes).toEqual(['replace #/?target=master']);
  });

  it('notifies only when the state changes', () => {
    const f = fakeLocation('');
    const store = createStateStore(meta, f.loc);
    const seen: AppState[] = [];
    store.subscribe((s) => seen.push(s));
    store.set(defaults);
    store.set(withFilters({ reopenedOnly: true }));
    expect(seen).toEqual([defaults, withFilters({ reopenedOnly: true })]);
  });

  it('follows navigation and stops on destroy', () => {
    const f = fakeLocation('');
    const store = createStateStore(meta, f.loc);
    f.navigate('#/methods?target=backports');
    expect(get(store)).toEqual({ ...withFilters({ target: 'backports' }), route: 'methods' });
    store.destroy();
    expect(f.listening()).toBe(false);
  });
});

describe('a section of the methods page', () => {
  it('reads a section of the methods page and writes it back last', () => {
    const state = stateFromHash('#/methods?target=master&section=disclosure', meta);
    expect(state).toEqual({ ...defaults, route: 'methods', section: 'disclosure' });
    expect(hashFromState(state, meta)).toBe('#/methods?target=master&section=disclosure');
  });

  it('reads a subheading of a section too', () => {
    expect(stateFromHash('#/methods?section=privacy-what-is-withheld', meta).section).toBe('privacy-what-is-withheld');
  });

  it.each([
    ['an id no section has', '#/methods?section=nowhere'],
    ['an empty id', '#/methods?section='],
    ['an id named like a prototype key', '#/methods?section=__proto__'],
    ['an anchor written with its hash', '#/methods?section=%23disclosure'],
    ['a section on the report', '#/?section=disclosure'],
    ['a section of the report', '#/methods?section=review'],
  ])('takes %s as none', (_name, hash) => {
    expect(stateFromHash(hash, meta).section).toBeNull();
  });

  it('never writes a section of the methods page on the report', () => {
    expect(hashFromState({ ...defaults, section: 'disclosure' }, meta)).toBe('#/?target=master');
  });

  it('builds the address of a section, keeping the filters', () => {
    const state = { ...withFilters({ target: 'all', kind: 'docs' }), pr: 66600 };
    expect(sectionHash(state, 'commands', meta)).toBe('#/methods?target=all&kind=docs&pr=66600&section=commands');
    expect(stateFromHash(sectionHash(state, 'commands', meta), meta)).toEqual({ ...state, route: 'methods', section: 'commands' });
  });

  it.each([
    '#/?target=master',
    '#/methods?target=master',
    '#/?target=backports&from=2026-06-01&kind=docs&pr=66600&sort=size',
    '#/methods?target=all&author=fixture-author-a&bots=show',
  ])('reads the address %s as it did before there were sections', (hash) => {
    const state = stateFromHash(hash, meta);
    expect(state.section).toBeNull();
    expect(hashFromState(state, meta)).toBe(hash);
  });
});

describe('a section of the report', () => {
  const names = ['velocity', 'review', 'ai-use', 'each-pr', 'timelines', 'pull-requests', 'people'];

  it.each(names)('reads and writes back section=%s alone', (name) => {
    const state = stateFromHash(`#/?section=${name}`, meta);
    expect(state).toEqual({ ...defaults, section: name });
    expect(hashFromState(state, meta)).toBe(`#/?target=master&section=${name}`);
  });

  it.each(names)('reads and writes back section=%s among filters', (name) => {
    const hash = `#/?target=master&from=2026-06-01&to=2026-08-31&kind=docs&section=${name}`;
    const state = stateFromHash(hash, meta);
    expect(state).toEqual({
      ...withFilters({ from: '2026-06-01', to: '2026-08-31', kind: 'docs' }),
      section: name,
    });
    expect(hashFromState(state, meta)).toBe(hash);
  });

  it.each([
    ['a name no section has', '#/?section=nowhere'],
    ["an element's id rather than its name", '#/?section=llm'],
    ['a name in another case', '#/?section=Review'],
    ['a section of the methods page', '#/?section=commands'],
  ])('drops %s from the address', (_name, hash) => {
    const f = fakeLocation(hash);
    const store = createStateStore(meta, f.loc);
    expect(get(store).section).toBeNull();
    expect(f.loc.read()).toBe('#/?target=master');
    store.destroy();
  });

  it('builds the address of a section, keeping the filters and selection', () => {
    const state = { ...withFilters({ from: '2026-06-01', to: '2026-08-31', target: 'all' }), pr: 66600 };
    const hash = reportSectionHash(state, 'review', meta);
    expect(hash).toBe('#/?target=all&from=2026-06-01&to=2026-08-31&pr=66600&section=review');
    expect(stateFromHash(hash, meta)).toEqual({ ...state, section: 'review' });
  });

  it('builds the address of a section from the methods page, leaving its section behind', () => {
    const state = { ...withFilters({ target: 'all' }), route: 'methods' as const, section: 'disclosure' };
    expect(reportSectionHash(state, 'people', meta)).toBe('#/?target=all&section=people');
  });

  it('leaves the section behind when changing page', () => {
    const onReport = { ...defaults, section: 'people' };
    expect(routeHash(onReport, 'methods', meta)).toBe('#/methods?target=master');
    expect(routeHash(onReport, 'report', meta)).toBe('#/?target=master');
  });
});
