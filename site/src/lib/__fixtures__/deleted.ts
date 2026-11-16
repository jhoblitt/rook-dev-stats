// The fixture's meta with deleted accounts added, in memory, as `rookstats
// rollup` writes them: the pooled `ghost` entry, and two deleted accounts
// known by the names on their commits, each `ghost:` and the name, listed in
// `people_deleted`. The names are invented; the second holds a space, an
// ampersand, a percent sign and letters outside ASCII.

import events2026 from './data/events-2026.json';
import rawMeta from './data/meta.json';
import prs2026 from './data/prs-2026.json';

export const NAME_A = 'Ada Example';
export const NAME_B = 'Åsa Prov & Söner 100%';

/** The index of each added entry in `people`: after the fixture's own people. */
export const POOLED = rawMeta.people.length;
export const NAMED_A = POOLED + 1;
export const NAMED_B = POOLED + 2;

/**
 * meta.json with `ghost`, `ghost:<NAME_A>` and `ghost:<NAME_B>` after the
 * fixture's people; `people_deleted` lists the two named ones, or is left
 * out, as in data written before the rollup gave names, when `list` is false.
 */
export function deletedMeta(list = true): Record<string, unknown> {
  return {
    ...rawMeta,
    people: [...rawMeta.people, 'ghost', `ghost:${NAME_A}`, `ghost:${NAME_B}`],
    ...(list ? { people_deleted: [NAMED_B, NAMED_A] } : {}),
  };
}

/** The fixture's PRs `deletedFiles` gives to Ada, to Åsa and to the pooled entry. */
export const PR_A = 66510;
export const PR_B = 66700;
export const PR_POOLED = 67000;

/**
 * The fixture's files for `fixturePage` with deleted accounts: #66510 is
 * Ada's, #66700 Åsa's and #67000 the pooled entry's, all on main and opened
 * in the window, and the comment on #66700 by another person is by a deleted
 * account, so the pooled entry's.
 */
export function deletedFiles(): Record<string, unknown> {
  const authorOf = new Map([
    [PR_A, NAMED_A],
    [PR_B, NAMED_B],
    [PR_POOLED, POOLED],
  ]);
  const author = prs2026.author.map((a, r) => authorOf.get(prs2026.number[r] as number) ?? a);
  const row = prs2026.number.indexOf(PR_B);
  const commentOther = rawMeta.event_kinds.indexOf('comment_other');
  const actor = events2026.actor.map((a, e) =>
    events2026.pr[e] === row && events2026.kind[e] === commentOther ? POOLED : a,
  );
  return {
    'meta.json': deletedMeta(),
    'prs-2026.json': { ...prs2026, author },
    'events-2026.json': { ...events2026, actor },
  };
}
