<!--
  The PRs behind the page: the current selection, narrowed by a chosen week
  or band, one row each, sortable by any column, the order kept in the URL.
  Only the rows in view are drawn, so the full history stays quick. Titles
  come from each year's table file, fetched once the table is on screen and
  only for the years of the rows drawn, or of every row when the order is by
  title. A row's title chooses that
  PR; its number links to it on GitHub, and its author's handle to theirs,
  beside a control that filters by that author. The chosen PR's summary and
  timeline are a section of their own, above this one.
-->
<script lang="ts">
  import { yearHolds } from '../lib/data';
  import { keepEqual } from '../lib/memo';
  import { isBot, personHandle } from '../lib/handles';
  import { getPage, sectionsBusy, sectionsStale } from '../lib/page';
  import { periodRange } from '../lib/filters';
  import { openedIn } from '../lib/select';
  import { type Sort, type SortColumn, nextSort, sameSort } from '../lib/sort';
  import {
    TABLE_COLUMNS,
    cellText,
    countText,
    narrowRows,
    narrowing,
    prUrl,
    rowText,
    sortWords,
    tableOrder,
    windowRows,
    yearsOfRows,
  } from '../lib/table';
  import { tableLoads } from '../lib/tables';
  import Person from './Person.svelte';
  import { onScreen } from './onscreen';
  import SectionHead from './SectionHead.svelte';

  const { selection, data, view, loader } = getPage();

  const dataset = $derived($view.dataset);
  // Choosing a PR leaves the order alone, so it is not worked out again.
  const keepSort = keepEqual<Sort>(sameSort);
  const filters = $derived($view.filters);
  const week = $derived($selection.week);
  const band = $derived($selection.band);
  const sort = $derived(keepSort($selection.sort));
  const selected = $derived($view.rows);
  const rows = $derived(narrowRows(dataset, selected, { filters, week, band }));
  // "no PRs match" is for an empty selection; a week or band with none says so in its own words.
  const empty = $derived(selected.length === 0);
  const narrowed = $derived(narrowing(dataset, { filters, week, band }));
  // The table lists every PR open at some point in the period; the charts above count those opened in it.
  const openedCount = $derived(openedIn(dataset, selected, periodRange(filters)).length);

  // The table is "shown" once any of it has been on screen.
  let shown = $state(false);

  const loads = tableLoads(loader);
  const tables = loads.map;
  const request = (year: number) => loads.request(year);

  const text = $derived(rowText(dataset, tables));
  // The lanes list the same rows in this order (Report.svelte).
  const ordered = $derived(tableOrder(dataset, selected, { filters, week, band }, sort, text));

  const ROW = 40;
  let scrollTop = $state(0);
  let viewport = $state(0);
  let scroller = $state<HTMLElement>();
  // A new order or a new set of rows starts at the top; titles arriving do not move the reader.
  $effect(() => {
    void sort;
    void rows;
    if (scroller) scroller.scrollTop = 0;
    scrollTop = 0;
  });
  // Without a ResizeObserver (jsdom) the window keeps a default height.
  function measureHeight(node: HTMLElement) {
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => (viewport = node.clientHeight));
    observer.observe(node);
    return () => observer.disconnect();
  }
  const win = $derived(windowRows(scrollTop, viewport > 0 ? viewport : 480, ROW, ordered.length, 8));
  const visible = $derived(Array.from(ordered.subarray(win.start, win.end)));

  // A year's file holds the titles of the rows that came from it, so the rows
  // drawn need only their own years'; an order by title reads every row's.
  const keepYears = keepEqual<number[]>((a, b) => a.length === b.length && a.every((y, i) => y === b[i]));
  const needed = $derived(
    shown ? keepYears(yearsOfRows(dataset, sort.column === 'title' ? rows : ordered.subarray(win.start, win.end))) : [],
  );
  $effect(() => {
    for (const y of needed) request(y);
  });

  const repo = $derived(dataset.meta.repo);
  const choose = (pr: number) => selection.update((s) => ({ ...s, pr }));
  const onsort = (column: SortColumn) => selection.update((s) => ({ ...s, sort: nextSort(s.sort, column) }));
  const widen = () => selection.update((s) => ({ ...s, week: null, band: null }));
  const byAuthor = (login: string) =>
    selection.update((s) => ({ ...s, filters: { ...s.filters, author: s.filters.author === login ? null : login } }));

  const ariaSort = (column: SortColumn) =>
    sort.column !== column ? 'none' : sort.descending ? 'descending' : 'ascending';
  // A browser test waits on this: a table still loading titles may be about to reorder or relabel its rows.
  const busy = $derived(needed.some((y) => tables.get(y)?.status === 'loading'));
</script>

<section
  id="table"
  tabindex="-1"
  aria-labelledby="table-heading"
  class:stale={sectionsStale($view, $data)}
  aria-busy={sectionsBusy($view, $data) ? 'true' : undefined}
  {@attach onScreen(() => (shown = true))}>
  <SectionHead name="pull-requests">
    <h2 id="table-heading">Pull requests</h2>
  </SectionHead>

  {#if empty}
    <p class="muted">no PRs match</p>
  {:else}
    <div class="status">
      <p role="status">{countText(rows.length, openedCount, narrowed)}</p>
      {#if narrowed}
        <button type="button" onclick={widen}>Show every selected PR</button>
      {/if}
    </div>
    {#each needed as year (year)}
      {@const t = tables.get(year)}
      {#if t?.status === 'loading'}
        <p class="muted">Loading the titles of the {yearHolds(loader.meta, year)}…</p>
      {:else if t?.status === 'error'}
        <p class="error">
          The titles of the {yearHolds(loader.meta, year)} could not be loaded ({t.message}); their rows show the rest.
        </p>
      {/if}
    {/each}

    {#if rows.length > 0}
      <!-- A scrolling region must take the focus, or a keyboard cannot scroll it to the rows not yet drawn. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div
        class="viewport"
        role="region"
        aria-label="Pull requests, scrollable"
        tabindex="0"
        bind:this={scroller}
        {@attach measureHeight}
        onscroll={(e) => (scrollTop = e.currentTarget.scrollTop)}
      >
        <table aria-rowcount={ordered.length + 1} aria-busy={busy ? 'true' : 'false'}>
          <caption class="visually-hidden">Pull requests, sorted {sortWords(sort)}</caption>
          <thead>
            <tr aria-rowindex={1}>
              {#each TABLE_COLUMNS as c (c.id)}
                <th scope="col" class={c.id} aria-sort={ariaSort(c.id)}>
                  <button type="button" onclick={() => onsort(c.id)}>
                    {c.label}<span class="arrow" aria-hidden="true"
                      >{sort.column === c.id ? (sort.descending ? ' ↓' : ' ↑') : ''}</span
                    >
                  </button>
                </th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#if win.start > 0}
              <tr class="spacer" aria-hidden="true" style:height="{win.start * ROW}px"><td colspan={TABLE_COLUMNS.length}></td></tr>
            {/if}
            {#each visible as r, i (r)}
              {@const number = dataset.prs.number[r] as number}
              {@const title = cellText(dataset, r, 'title', text)}
              <tr aria-rowindex={win.start + i + 2} aria-current={number === $selection.pr ? 'true' : undefined}>
                <td class="number">
                  <a
                    href={prUrl(repo, number)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="#{number} on GitHub, opens in a new tab">#{number}</a
                  >
                </td>
                <td class="title">
                  <button type="button" class="pick" title={title || undefined} onclick={() => choose(number)}>
                    {title || `Show #${number}`}
                  </button>
                </td>
                {#each TABLE_COLUMNS.slice(2) as c (c.id)}
                  {#if c.id === 'author'}
                    {@const person = dataset.prs.author[r] as number}
                    {@const handle = personHandle(dataset.meta, person)}
                    <td class="author">
                      <Person
                        {handle}
                        bot={isBot(dataset.meta, person)}
                        filter={{ role: 'author', active: filters.author === handle.login, ontoggle: () => byAuthor(handle.login) }}
                      />
                    </td>
                  {:else}
                    <td class={c.id}>{cellText(dataset, r, c.id, text)}</td>
                  {/if}
                {/each}
              </tr>
            {/each}
            {#if win.end < ordered.length}
              <tr class="spacer" aria-hidden="true" style:height="{(ordered.length - win.end) * ROW}px"
                ><td colspan={TABLE_COLUMNS.length}></td></tr
              >
            {/if}
          </tbody>
        </table>
      </div>
    {/if}
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

  h2 {
    margin: 0;
  }

  .stale {
    opacity: 0.6;
  }

  p {
    margin: 0;
  }

  .muted {
    color: var(--text-muted);
  }

  .error {
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    font-size: var(--text-sm);
  }

  .status {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-4);
  }

  .status button,
  th button,
  .pick {
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    color: var(--accent);
    cursor: pointer;
    text-align: start;
  }

  /* Positioned, so a visually hidden label inside scrolls with it rather than widening the page. */
  .viewport {
    position: relative;
    max-height: 70vh;
    overflow: auto;
    border: 1px solid var(--grid);
    border-radius: var(--radius-sm);
  }

  .viewport:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }

  table {
    width: max-content;
    min-width: 100%;
    border-collapse: collapse;
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
  }

  th,
  td {
    height: 40px;
    padding: 0 var(--space-3);
    text-align: start;
    white-space: nowrap;
  }

  td {
    border-bottom: 1px solid var(--grid);
  }

  /* A sticky cell loses a collapsed border, so the header's rule is a shadow. */
  thead th {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--surface);
    box-shadow: inset 0 -1px 0 var(--grid);
    font-weight: 600;
  }

  th button {
    color: var(--text-muted);
    font-weight: 600;
  }

  th[aria-sort='ascending'] button,
  th[aria-sort='descending'] button {
    color: var(--text);
  }

  td.title {
    max-width: 24rem;
  }

  .pick {
    display: block;
    max-width: 100%;
    overflow: hidden;
    color: var(--text);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pick:hover {
    color: var(--accent);
    text-decoration: underline;
  }

  tr[aria-current='true'] td {
    background: var(--accent-wash);
  }

  tr[aria-current='true'] td:first-child {
    box-shadow: inset 3px 0 0 var(--accent);
  }

  .spacer td {
    height: auto;
    padding: 0;
    border: 0;
  }

  @media (width < 720px) {
    section {
      padding: var(--space-4);
    }

    td.title {
      max-width: 16rem;
    }
  }
</style>
