<!--
  One of the People tables: a row per person, in the order chosen, each
  column sortable both ways. The first column is the row's place in that
  order. Only the rows in view are drawn, as in the PR table.
-->
<script lang="ts" generics="C extends string, R extends { person: number }">
  import type { Meta } from '../lib/data';
  import { isBot, personHandle } from '../lib/handles';
  import type { PeopleColumn } from '../lib/people';
  import type { Sort } from '../lib/sort';
  import { windowRows } from '../lib/table';
  import Person from './Person.svelte';

  interface Props {
    /** The table's name, e.g. "Authors". */
    name: string;
    meta: Meta;
    /** The person's column first. */
    columns: readonly PeopleColumn<C, R>[];
    /** In the order shown. */
    rows: readonly R[];
    sort: Sort<C>;
    onsort: (column: C) => void;
    /** What the row's filter control filters by: "author" or "reviewer". */
    role: string;
    /** The `people` entry the matching filter is set to. */
    active: string | null;
    ontoggle: (login: string) => void;
  }

  let { name, meta, columns, rows, sort, onsort, role, active, ontoggle }: Props = $props();

  const ROW = 40;
  let scrollTop = $state(0);
  let viewport = $state(0);
  let scroller = $state<HTMLElement>();
  // A new order or a new set of rows starts at the top.
  $effect(() => {
    void sort;
    void rows;
    if (scroller) scroller.scrollTop = 0;
    scrollTop = 0;
  });
  function measureHeight(node: HTMLElement) {
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => (viewport = node.clientHeight));
    observer.observe(node);
    return () => observer.disconnect();
  }
  const win = $derived(windowRows(scrollTop, viewport > 0 ? viewport : 480, ROW, rows.length, 8));
  const visible = $derived(rows.slice(win.start, win.end));
  const width = $derived(columns.length + 1);

  const ariaSort = (column: C) => (sort.column !== column ? 'none' : sort.descending ? 'descending' : 'ascending');
  const sortedBy = $derived(
    `${columns.find((c) => c.id === sort.column)?.label}, ${sort.descending ? 'descending' : 'ascending'}`,
  );
</script>

<!-- A scrolling region must take the focus, or a keyboard cannot scroll it to the rows not yet drawn. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  class="viewport"
  role="region"
  aria-label="{name}, scrollable"
  tabindex="0"
  bind:this={scroller}
  {@attach measureHeight}
  onscroll={(e) => (scrollTop = e.currentTarget.scrollTop)}
>
  <table aria-rowcount={rows.length + 1}>
    <caption class="visually-hidden">{name}, sorted by {sortedBy}</caption>
    <thead>
      <tr aria-rowindex={1}>
        <th scope="col" class="rank"><span class="visually-hidden">Place in this order</span><span aria-hidden="true">#</span></th>
        {#each columns as c, i (c.id)}
          <th scope="col" class:number={i > 0} class:person={i === 0} aria-sort={ariaSort(c.id)}>
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
        <tr class="spacer" aria-hidden="true" style:height="{win.start * ROW}px"><td colspan={width}></td></tr>
      {/if}
      {#each visible as r, i (r.person)}
        {@const handle = personHandle(meta, r.person)}
        <tr aria-rowindex={win.start + i + 2}>
          <td class="rank">{win.start + i + 1}</td>
          <th scope="row" class="person">
            <Person
              {handle}
              bot={isBot(meta, r.person)}
              filter={{ role, active: active === handle.login, ontoggle: () => ontoggle(handle.login) }}
            />
          </th>
          {#each columns.slice(1) as c (c.id)}
            {@const cell = c.cell(r, meta)}
            <td class="number" title={cell.detail}
              >{cell.text}{#if cell.detail}<span class="visually-hidden">, {cell.detail}</span>{/if}</td
            >
          {/each}
        </tr>
      {/each}
      {#if win.end < rows.length}
        <tr class="spacer" aria-hidden="true" style:height="{(rows.length - win.end) * ROW}px"><td colspan={width}></td></tr>
      {/if}
    </tbody>
  </table>
</div>

<style>
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
    padding: 0 var(--space-2);
    text-align: start;
    white-space: nowrap;
  }

  td,
  tbody th {
    border-bottom: 1px solid var(--grid);
    font-weight: normal;
  }

  .number {
    text-align: end;
  }

  .rank {
    color: var(--text-muted);
    text-align: end;
  }

  /* A sticky cell loses a collapsed border, so the header's rule is a shadow. */
  thead th {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--surface);
    box-shadow: inset 0 -1px 0 var(--grid);
    font-weight: 600;
    white-space: normal;
    vertical-align: bottom;
    max-width: 7rem;
  }

  th button {
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    color: var(--text-muted);
    font-weight: 600;
    cursor: pointer;
    text-align: inherit;
  }

  th[aria-sort='ascending'] button,
  th[aria-sort='descending'] button {
    color: var(--text);
  }

  /* The person stays in view while the figures scroll across a narrow screen. */
  tbody th.person,
  thead th.person {
    position: sticky;
    left: 0;
    background: var(--surface);
  }

  tbody th.person {
    z-index: 1;
    box-shadow: inset -1px 0 0 var(--grid);
  }

  thead th.person {
    z-index: 2;
    box-shadow:
      inset 0 -1px 0 var(--grid),
      inset -1px 0 0 var(--grid);
  }

  .spacer td {
    height: auto;
    padding: 0;
    border: 0;
  }
</style>
