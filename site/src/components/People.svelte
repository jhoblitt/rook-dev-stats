<!--
  The people behind the selected PRs: who opened them and what those PRs came
  to, and who reviewed or commented on them. Each person is named by their
  GitHub login, linked to their page there, or as a deleted account, with a
  control that filters the whole page by them. Bot accounts among the
  authors are left out until asked for; the data keeps no login for a bot's
  comment or review, so the reviewers are never bots. The pooled deleted
  entry stands for many accounts, so it is not ranked or counted: a line
  beneath each table gives its figures.
-->
<script lang="ts">
  import { formatCount } from '../lib/format';
  import { isBot } from '../lib/handles';
  import { getPage, sectionsBusy, sectionsStale } from '../lib/page';
  import {
    AUTHOR_TABLE,
    REVIEWER_TABLE,
    pooledAuthorLine,
    pooledReviewerLine,
    pooledRow,
    shownPeople,
    sortPeople,
  } from '../lib/people';
  import { periodRange } from '../lib/filters';
  import { openedIn } from '../lib/select';
  import { keepEqual } from '../lib/memo';
  import { type AuthorColumn, type ReviewerColumn, type Sort, nextSort, sameSort } from '../lib/sort';
  import { authorRows, reviewerRows } from '../lib/stats/people';
  import PeopleTable from './PeopleTable.svelte';
  import SectionHead from './SectionHead.svelte';

  const { selection, data, view } = getPage();
  const uid = $props.id();

  const dataset = $derived($view.dataset);
  const meta = $derived(dataset.meta);
  const filters = $derived($view.filters);
  const period = $derived(periodRange(filters));
  const rows = $derived($view.rows);
  const empty = $derived(rows.length === 0);

  const authors = $derived(authorRows(dataset, openedIn(dataset, rows, period)));
  const reviewers = $derived(reviewerRows(dataset, rows, period));

  // Choosing a PR or another table's order leaves these orders, and so the rows, alone.
  const keepAuthorSort = keepEqual<Sort<AuthorColumn>>(sameSort);
  const keepReviewerSort = keepEqual<Sort<ReviewerColumn>>(sameSort);
  const authorSort = $derived(keepAuthorSort($selection.authorSort));
  const reviewerSort = $derived(keepReviewerSort($selection.reviewerSort));
  const bots = $derived($selection.bots);

  const shownAuthors = $derived(sortPeople(shownPeople(authors, meta, bots), AUTHOR_TABLE, authorSort, meta));
  const shownReviewers = $derived(sortPeople(shownPeople(reviewers, meta, true), REVIEWER_TABLE, reviewerSort, meta));
  const hiddenBots = $derived(bots ? 0 : authors.filter((r) => isBot(meta, r.person)).length);
  const pooledAuthor = $derived(pooledRow(authors, meta));
  const pooledReviewer = $derived(pooledRow(reviewers, meta));

  // A count sorts the most first; a handle, from A.
  const onAuthorSort = (column: AuthorColumn) =>
    selection.update((s) => ({ ...s, authorSort: nextSort(s.authorSort, column, column !== 'author') }));
  const onReviewerSort = (column: ReviewerColumn) =>
    selection.update((s) => ({ ...s, reviewerSort: nextSort(s.reviewerSort, column, column !== 'reviewer') }));
  const toggle = (which: 'author' | 'reviewer') => (login: string) =>
    selection.update((s) => {
      const next = s.filters[which] === login ? null : login;
      return { ...s, filters: { ...s.filters, ...(which === 'author' ? { author: next } : { reviewer: next }) } };
    });
  const setBots = (show: boolean) => selection.update((s) => ({ ...s, bots: show }));

  const count = (n: number, one: string, many: string) => `${n === 0 ? 'no' : formatCount(n)} ${n === 1 ? one : many}`;
  const hiddenText = (n: number) => (n === 0 ? '' : `, and ${count(n, 'bot account', 'bot accounts')} not shown`);
</script>

<section id="people" tabindex="-1" aria-labelledby="people-heading" class:stale={sectionsStale($view, $data)} aria-busy={sectionsBusy($view, $data) ? 'true' : undefined}>
  <SectionHead name="people">
    <h2 id="people-heading">People</h2>
  </SectionHead>

  {#if empty}
    <p class="muted">no PRs match</p>
  {:else}
    <div class="part">
      <h3 id="{uid}-authors">Authors</h3>
      <p role="status">
        {count(shownAuthors.length, 'author', 'authors')} of the selected PRs opened in the period{hiddenText(hiddenBots)}
      </p>
      <label class="bots">
        <input type="checkbox" checked={bots} onchange={(e) => setBots(e.currentTarget.checked)} />
        Show bot accounts among the authors
      </label>
      {#if shownAuthors.length > 0}
        <PeopleTable
          name="Authors"
          {meta}
          columns={AUTHOR_TABLE}
          rows={shownAuthors}
          sort={authorSort}
          onsort={onAuthorSort}
          role="author"
          active={filters.author}
          ontoggle={toggle('author')}
        />
      {/if}
      {#if pooledAuthor !== null}
        <p class="pooled">{pooledAuthorLine(pooledAuthor, meta)}</p>
      {/if}
      <div class="notes">
        <p>
          Commits and lines are those of the pull requests a person opened, because the data does not record who wrote
          each commit. A backport’s commits and lines count for whoever opened the backport, most often Mergify’s bot
          account, which is left out until bot accounts are shown; the Target filter separates original work on master
          from backports. Lines are a pull request’s whole
          diff, lines added plus lines deleted, so one large import can dominate a total.
        </p>
        <p>
          The medians are read from the outcome curves over each person’s pull requests, as the Review section’s are:
          the time from ready for review to the first human response, and from opening to merging. Each gives the number
          of pull requests behind it; with fewer than five it says “too few”.
        </p>
      </div>
    </div>

    <div class="part">
      <h3 id="{uid}-reviewers">Reviewers</h3>
      <p role="status">
        {count(shownReviewers.length, 'reviewer', 'reviewers')} of the selected PRs in the period, none of them a bot: the
        data keeps no login for a bot’s comment or review.
      </p>
      {#if shownReviewers.length > 0}
        <PeopleTable
          name="Reviewers"
          {meta}
          columns={REVIEWER_TABLE}
          rows={shownReviewers}
          sort={reviewerSort}
          onsort={onReviewerSort}
          role="reviewer"
          active={filters.reviewer}
          ontoggle={toggle('reviewer')}
        />
      {/if}
      {#if pooledReviewer !== null}
        <p class="pooled">{pooledReviewerLine(pooledReviewer, meta)}</p>
      {/if}
      <div class="notes">
        <p>
          Nothing a person does on a pull request they opened is counted here, neither their comments on it nor their
          replies in its review threads. Reviews and comments are those made during the period on other people’s pull
          requests, and PRs reviewed or commented on counts each pull request once. A comment is any such comment by a
          person that is not a bot command, such as a posted test result, so a row with comments and no reviews is
          someone who commented without reviewing. Someone who reviews without leaving a review or a comment that the
          data records, such as an approval given by another route, is not seen here.
        </p>
        <p>
          A first response is the first comment or review on a pull request by a person other than its author; comments
          and reviews from bot accounts, and bot commands, do not count. First responses counts the pull requests whose
          first response was this person’s and came before the pull request was finally merged or closed; a pull request
          never made ready for review has none, so it counts for no one. The median is of the time from a pull request
          being ready for review to this person’s first comment or review on it, made before the pull request was finally
          merged or closed. One made before the pull request was ready counts as no time, and pull requests never made ready for review are left out. With
          fewer than five pull requests behind it, the median says “too few”.
        </p>
        {#if meta.people_deleted.length > 0}
          <p>
            A deleted account’s pull requests can be credited to the name on their commits, but its comments and reviews
            carry no name, so they are all counted for “(deleted, unknown)” beneath the table, and no “(deleted)” author with
            a name has a row here.
          </p>
        {/if}
      </div>
    </div>
  {/if}
</section>

<style>
  section {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-5);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    transition: opacity 0.2s;
  }

  h2,
  h3,
  p {
    margin: 0;
  }

  h3 {
    font-size: var(--text-lg);
  }

  .stale {
    opacity: 0.6;
  }

  .muted {
    color: var(--text-muted);
  }

  .part {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .pooled {
    max-width: 48rem;
  }

  .bots {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    align-self: flex-start;
    cursor: pointer;
  }

  .notes {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    max-width: 48rem;
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  @media (width < 720px) {
    section {
      padding: var(--space-4);
    }
  }
</style>
