import { describe, expect, it } from 'vitest';
import rawMeta from './__fixtures__/data/meta.json';
import { NAMED_A, NAMED_B, NAME_A, NAME_B, POOLED, deletedMeta } from './__fixtures__/deleted';
import { parseMeta } from './data';
import {
  POOLED_NOTE,
  findLogin,
  handle,
  isBot,
  isNamedDeleted,
  isPooledDeleted,
  personHandle,
  personIndex,
} from './handles';

const meta = parseMeta(rawMeta);

describe('handle', () => {
  it('links a login to its page on GitHub', () => {
    expect(handle('fixture-author-a')).toEqual({
      login: 'fixture-author-a',
      text: 'fixture-author-a',
      url: 'https://github.com/fixture-author-a',
    });
  });

  it.each(['a', 'A1-b2-C3', 'x'.repeat(39), 'dependabot[bot]'])('links %s, which has the form of a login', (login) => {
    expect(handle(login).url).toBe(`https://github.com/${encodeURIComponent(login)}`);
  });

  it('writes the pooled deleted account as "(deleted, unknown)", with no link, and says what it pools', () => {
    const h = handle('ghost');
    expect(h).toMatchObject({ login: 'ghost', text: '(deleted, unknown)', url: null });
    expect(h.note).toBe(POOLED_NOTE);
    expect(POOLED_NOTE).toMatch(/every deleted account/);
  });

  it('gives no note to anyone but the pooled entry', () => {
    expect(handle('fixture-author-a').note).toBeUndefined();
  });

  it.each([
    ['empty', ''],
    ['with a slash', 'ceph/ceph'],
    ['a path upward', '..'],
    ['an address', 'https://example.com'],
    ['with a space', 'two words'],
    ['with markup', '<b>x</b>'],
    ['starting with a hyphen', '-x'],
    ['too long', 'x'.repeat(40)],
    ['with a query', 'x?tab=repositories'],
    ['with a suffix other than [bot]', 'x[app]'],
  ])('shows a login that is %s as plain text, never a link', (_name, login) => {
    expect(handle(login)).toEqual({ login, text: login, url: null });
  });
});

describe('personHandle and isBot', () => {
  it("gives a person's handle by their index into people", () => {
    expect(personHandle(meta, 4).url).toBe('https://github.com/fixture-reviewer-k');
  });

  it('names the bot accounts', () => {
    expect(isBot(meta, 10)).toBe(true);
    expect(isBot(meta, 4)).toBe(false);
  });
});

describe('a deleted account', () => {
  const named = parseMeta(deletedMeta());
  const unlisted = parseMeta(deletedMeta(false));

  it('is written "(deleted)" and the name on its commits, with no link, when people_deleted lists it', () => {
    expect(personHandle(named, NAMED_A)).toEqual({ login: `ghost:${NAME_A}`, text: `(deleted) ${NAME_A}`, url: null });
    expect(personHandle(named, NAMED_B)).toEqual({ login: `ghost:${NAME_B}`, text: `(deleted) ${NAME_B}`, url: null });
  });

  it('is "(deleted, unknown)" with its note when it is the pooled entry', () => {
    expect(personHandle(named, POOLED)).toEqual({ login: 'ghost', text: '(deleted, unknown)', url: null, note: POOLED_NOTE });
  });

  it('is never a bot, and the bots are as before', () => {
    expect([POOLED, NAMED_A, NAMED_B].map((i) => isBot(named, i))).toEqual([false, false, false]);
    expect(isBot(named, 10)).toBe(true);
  });

  it('tells the named entries from the pooled one and from everyone else', () => {
    expect([2, 10, POOLED, NAMED_A, NAMED_B].map((i) => isNamedDeleted(named, i))).toEqual([false, false, false, true, true]);
    expect([2, 10, POOLED, NAMED_A, NAMED_B].map((i) => isPooledDeleted(named, i))).toEqual([false, false, true, false, false]);
  });

  it('is shown as the data gives it, never as a name, when the data has no people_deleted', () => {
    expect(unlisted.people_deleted).toEqual([]);
    expect(personHandle(unlisted, POOLED)).toMatchObject({ text: '(deleted, unknown)', url: null });
    // An entry no list names is shown as written, and has no form of a login to link.
    expect(personHandle(unlisted, NAMED_A)).toEqual({ login: `ghost:${NAME_A}`, text: `ghost:${NAME_A}`, url: null });
    expect(isNamedDeleted(unlisted, NAMED_A)).toBe(false);
  });

  it('leaves every login of the shared fixture as it was', () => {
    meta.people.forEach((login, i) => {
      expect(personHandle(named, i)).toEqual(personHandle(meta, i));
      expect(personHandle(meta, i)).toEqual(handle(login));
    });
  });
});

describe('findLogin', () => {
  it('finds a login the data names, in any case, as the data gives it', () => {
    expect(findLogin(meta, 'fixture-author-a')).toBe('fixture-author-a');
    expect(findLogin(meta, 'Fixture-Author-A')).toBe('fixture-author-a');
  });

  it.each(['', 'someone-else', '__proto__', 'constructor'])('finds no login for %j', (login) => {
    expect(findLogin(meta, login)).toBeNull();
  });

  const named = parseMeta(deletedMeta());

  it('finds a named deleted account by its entry, exactly, and by what the page writes', () => {
    expect(findLogin(named, `ghost:${NAME_B}`)).toBe(`ghost:${NAME_B}`);
    expect(findLogin(named, `(deleted) ${NAME_B}`)).toBe(`ghost:${NAME_B}`);
    expect(findLogin(named, `(deleted) ${NAME_A.toLowerCase()}`)).toBe(`ghost:${NAME_A}`);
    expect(personIndex(named, `ghost:${NAME_A}`)).toBe(NAMED_A);
  });

  it('finds the pooled entry by `ghost`, in any case, and by "(deleted, unknown)"', () => {
    expect(findLogin(named, 'ghost')).toBe('ghost');
    expect(findLogin(named, 'Ghost')).toBe('ghost');
    expect(findLogin(named, '(deleted, unknown)')).toBe('ghost');
  });

  it('tells apart two names that differ only in case', () => {
    const m = parseMeta({ ...deletedMeta(), people: [...meta.people, 'ghost', 'ghost:Ada Example', 'ghost:ada example'] });
    expect(findLogin(m, 'ghost:ada example')).toBe('ghost:ada example');
    expect(findLogin(m, '(deleted) Ada Example')).toBe('ghost:Ada Example');
  });

  it('never writes a name as the pooled entry is written, even the name "unknown"', () => {
    const m = parseMeta({ ...deletedMeta(), people: [...meta.people, 'ghost', 'ghost:unknown', `ghost:${NAME_B}`] });
    expect(personHandle(m, NAMED_A).text).toBe('(deleted) unknown');
    expect(personHandle(m, POOLED).text).toBe('(deleted, unknown)');
    expect(findLogin(m, '(deleted) unknown')).toBe('ghost:unknown');
    expect(findLogin(m, '(deleted, unknown)')).toBe('ghost');
  });

  it('finds no name the data does not hold', () => {
    expect(findLogin(named, 'ghost:Someone Else')).toBeNull();
    expect(findLogin(named, '(deleted) Someone Else')).toBeNull();
    expect(findLogin(named, NAME_A)).toBeNull();
  });
});
