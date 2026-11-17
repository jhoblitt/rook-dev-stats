// The seam between `rookstats rollup` and the site: what the rollup writes
// for its hand-made dataset (internal/rollup/testdata/golden/, rewritten by
// `ROOKSTATS_UPDATE_GOLDEN=1 go test ./internal/rollup/`) must load through
// the site's own loader. The values checked by hand here follow from the
// records in internal/rollup/testdata/data/.
import { describe, expect, it } from 'vitest';
import { parseMeta, parseTable, parseYear } from './data';

const DIR = '../../../internal/rollup/testdata/golden/';
const files: Record<string, unknown> = import.meta.glob('../../../internal/rollup/testdata/golden/*.json', {
  eager: true,
  import: 'default',
});

function file(name: string): unknown {
  const f = files[DIR + name];
  if (f === undefined) throw new Error(`the rollup wrote no ${name}`);
  return f;
}

const at = (y: number, mo: number, d: number, h: number) => Date.UTC(y, mo - 1, d, h) / 1000;

const meta = parseMeta(file('meta.json'));
const years = meta.years.map((y) => parseYear(y, file(`prs-${y}.json`), file(`events-${y}.json`), meta));
const tables = years.map((y) => parseTable(file(`table-${y.year}.json`), `table-${y.year}.json`, y, meta));


describe('the rollup output for the hand-made dataset', () => {
  it('is exactly meta.json, index.json and three files for each year', () => {
    expect(meta.years).toEqual([2025, 2026]);
    const expected = [
      'meta.json',
      'index.json',
      ...meta.years.flatMap((y) => [`prs-${y}.json`, `events-${y}.json`, `table-${y}.json`]),
    ];
    expect(Object.keys(files).map((k) => k.slice(DIR.length)).sort()).toEqual(expected.sort());
  });

  it('loads every year and table through the loader', () => {
    expect(years.map((y) => y.prs.number.length)).toEqual([1, 8]);
    expect(years.map((y) => y.events.pr.length)).toEqual([1, 30]);
    expect(tables.map((t) => t.refs.length)).toEqual([1, 30]);
    expect(meta.window_start).toBe(at(2026, 5, 15, 0));
  });

  it('files a PR under the year it finished in, or open under the year of fetched_through', () => {
    const [y2025, y2026] = years;
    // #64100 opened in 2025 and merged in 2026; #64150 closed at the last second of 2025.
    expect([...y2025!.prs.number]).toEqual([64150]);
    expect(y2025!.prs.closed[0]).toBe(at(2026, 1, 1, 0) - 1);
    expect(y2026!.prs.number).toContain(64100);
    for (const y of years) {
      y.prs.closed.forEach((c, row) => {
        const finished = c === -1 ? meta.fetched_through : c;
        expect(new Date(finished * 1000).getUTCFullYear(), `#${y.prs.number[row]}`).toBe(y.year);
      });
    }
  });

  it('writes index.json as exactly numbers ascending and the year whose files hold each', () => {
    const index = file('index.json') as Record<string, unknown>;
    expect(Object.keys(index).sort()).toEqual(['numbers', 'years']);
    const numbers = index['numbers'] as number[];
    const yearOf = index['years'] as number[];
    expect(numbers).toEqual([64100, 64150, 66200, 66300, 66400, 66500, 66600, 66700, 66800]);
    expect(yearOf).toEqual([2026, 2025, 2026, 2026, 2026, 2026, 2026, 2026, 2026]);
    numbers.forEach((n, i) => {
      const y = years.find((d) => d.year === yearOf[i]);
      expect(y?.prs.number, `#${n}`).toContain(n);
    });
  });

  it('writes a first response before ready as ready', () => {
    const y2026 = years[1]!;
    const row = y2026.prs.number.indexOf(66200);
    expect(y2026.prs.ready[row]).toBe(at(2026, 6, 3, 10));
    expect(y2026.prs.first_response[row]).toBe(at(2026, 6, 3, 10));
  });

  it("gives a ready event its event id as its ref", () => {
    const y2026 = years[1]!;
    const row = y2026.prs.number.indexOf(66200);
    const ready = meta.event_kinds.indexOf('ready');
    const i = y2026.events.kind.findIndex((k, e) => k === ready && y2026.events.pr[e] === row);
    expect(tables[1]!.refs[i]).toBe('28644873432');
  });

  it("writes the author's own review as review_author, with no actor and the review's id", () => {
    const y2026 = years[1]!;
    const row = y2026.prs.number.indexOf(66200);
    const own = meta.event_kinds.indexOf('review_author');
    expect(own).toBe(meta.event_kinds.indexOf('bot_review') + 1);
    const found = [...y2026.events.kind.keys()].filter((e) => y2026.events.kind[e] === own && y2026.events.pr[e] === row);
    expect(found).toHaveLength(1);
    expect(y2026.events.actor[found[0]!]).toBe(-1);
    expect(tables[1]!.refs[found[0]!]).toBe('3100000004');
    expect(y2026.prs.human_reviews[row]).toBe(2);
  });

  it("resolves a PR's author through people, a deleted account its commits name to its ghost: entry", () => {
    const row = years[1]!.prs.number.indexOf(66400);
    expect(meta.people[years[1]!.prs.author[row]!]).toBe('ghost:Ivy Example');
    expect(tables[1]!.authors[row]).toBe('ghost');
  });

  it('lists the deleted accounts named by their commits in people_deleted, beside the pooled ghost', () => {
    expect('people_deleted' in (file('meta.json') as object)).toBe(true);
    expect(meta.people_deleted.map((d) => meta.people[d])).toEqual(['ghost:Ivy Example']);
    expect(meta.people).toContain('ghost');
  });

  it('writes backport_link in every year, set exactly where the table names the PR a row backports', () => {
    years.forEach((y, i) => {
      expect(y.linksRecorded, `prs-${y.year}.json`).toBe(true);
      expect([...y.prs.backport_link], `prs-${y.year}.json`).toEqual(tables[i]!.backport_of.map((n) => (n > 0 ? 1 : 0)));
    });
    // #66500 on release-1.18 says it is a backport of #66200.
    const y2026 = years[1]!;
    expect(y2026.prs.backport_link[y2026.prs.number.indexOf(66500)]).toBe(1);
    expect([...y2026.prs.backport_link].filter((v) => v === 1)).toHaveLength(1);
  });

  it('names the bot accounts among the people', () => {
    expect(meta.people_bots.map((b) => meta.people[b])).toEqual(['dependabot']);
  });
});
