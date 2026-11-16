// The addresses on GitHub of a PR and of what happened on it, built from the
// PR's number and the ids and SHAs the data keeps (the data stores no
// address). A ref the data could not record, or one of the wrong form, gives
// no address rather than a broken one.

const SHA = /^[0-9a-f]{40}$/;
const ID = /^[1-9]\d*$/;

const COMMENT_KINDS = ['comment_other', 'comment_author', 'command_author', 'command_other', 'bot_account'];
const REVIEW_KINDS = ['review_approved', 'review_changes', 'review_commented', 'bot_review', 'review_author'];
const EVENT_KINDS = ['ready', 'draft', 'closed'];
const COMMIT_KINDS = ['merged', 'force_push'];

/** `repo` is meta's `owner/name`. */
export function prUrl(repo: string, number: number): string {
  return `https://github.com/${repo}/pull/${number}`;
}

/** A commit of the PR, shown in the PR's own commit view; null for a SHA that is not one. */
export function commitUrl(repo: string, number: number, sha: string): string | null {
  return SHA.test(sha) ? `${prUrl(repo, number)}/commits/${sha}` : null;
}

/**
 * Where an event of `kind` (one of meta's `event_kinds`) with the table's
 * `ref` is on GitHub: a comment or a review by its id, a ready, draft or
 * closed event by its id, a merge or a force-push by the commit it made. A
 * reopening has no address of its own, so it, and a kind this page does not
 * know, go to the PR. Null when the ref is empty or not of its kind's form.
 */
export function eventUrl(repo: string, number: number, kind: string, ref: string): string | null {
  const pr = prUrl(repo, number);
  const id = ID.test(ref);
  if (COMMENT_KINDS.includes(kind)) return id ? `${pr}#issuecomment-${ref}` : null;
  if (REVIEW_KINDS.includes(kind)) return id ? `${pr}#pullrequestreview-${ref}` : null;
  if (EVENT_KINDS.includes(kind)) return id ? `${pr}#event-${ref}` : null;
  if (COMMIT_KINDS.includes(kind)) return SHA.test(ref) ? `https://github.com/${repo}/commit/${ref}` : null;
  return pr;
}
