<!--
  One chart: its title and any note on it, a text alternative stating the
  headline figures for screen readers, its legend, the plot, any figures
  shown beside it, and the exact values as a table. With nothing selected it
  says "no PRs match" in place of all of them; with PRs selected but nothing
  to measure, it says what is missing.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { LegendItem, Table } from '../../lib/charts';
  import Legend from './Legend.svelte';

  interface Props {
    title: string;
    /** The headline figures, as sentences. */
    summary: string;
    /** The selection is empty. */
    empty: boolean;
    /** PRs match but the chart has nothing to measure: what is missing, in words. */
    nothing?: string | null;
    /** A line under the title qualifying what the chart measures. */
    note?: string | undefined;
    /** A legend is drawn for two series or more; one series is named by the title. */
    legend?: readonly LegendItem[];
    table?: Table | undefined;
    /** Figures printed under the plot, such as its quantiles. */
    figures?: Snippet;
    children?: Snippet;
  }

  let { title, summary, empty, nothing = null, note, legend, table, figures, children }: Props = $props();
  const uid = $props.id();
  // A single series needs no key; a mark such as a partial bucket's always does.
  const keyed = $derived(
    legend !== undefined && (legend.length > 1 || legend.some((i) => i.mark !== 'bar' && i.mark !== 'line' && i.mark !== 'area')),
  );
</script>

<figure class="chart" aria-labelledby="{uid}-title" aria-describedby="{uid}-summary">
  <h3 id="{uid}-title">{title}</h3>
  {#if note}<p class="note">{note}</p>{/if}
  {#if empty}
    <p id="{uid}-summary" class="empty">no PRs match</p>
  {:else if nothing !== null}
    <p id="{uid}-summary" class="empty">{nothing}</p>
  {:else}
    <p id="{uid}-summary" class="visually-hidden">{summary}</p>
    {#if legend && keyed}
      <Legend items={legend} />
    {/if}
    {@render children?.()}
    {@render figures?.()}
    {#if table}
      <details>
        <summary>Show the figures as a table</summary>
        <div class="scroll">
          <table>
            <caption class="visually-hidden">{title}</caption>
            <thead>
              <tr>
                {#each table.columns as c, i (i)}<th scope="col">{c}</th>{/each}
              </tr>
            </thead>
            <tbody>
              {#each table.rows as row, i (i)}
                <tr>
                  <th scope="row">{row.head}</th>
                  {#each row.cells as cell, i (i)}<td>{cell}</td>{/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </details>
    {/if}
  {/if}
</figure>

<style>
  .chart {
    margin: 0;
    min-width: 0;
  }

  h3 {
    margin: 0 0 var(--space-2);
    font-size: var(--text-base);
    font-weight: 600;
  }

  .note {
    margin: 0 0 var(--space-2);
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  .empty {
    margin: 0;
    padding: var(--space-5) 0;
    color: var(--text-muted);
  }

  details {
    margin-top: var(--space-2);
    font-size: var(--text-sm);
  }

  summary {
    cursor: pointer;
    color: var(--accent);
  }

  .scroll {
    overflow-x: auto;
    max-height: 24rem;
    margin-top: var(--space-2);
  }

  table {
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
  }

  th,
  td {
    padding: var(--space-1) var(--space-3);
    border-bottom: 1px solid var(--grid);
    text-align: end;
    white-space: nowrap;
  }

  th[scope='row'] {
    text-align: start;
    font-weight: 400;
  }

  thead th {
    position: sticky;
    top: 0;
    background: var(--surface);
    color: var(--text-muted);
    font-weight: 600;
  }
</style>
