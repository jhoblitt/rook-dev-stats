<!--
  The selected PR in one place: what it is, then its timeline. Choosing a PR
  anywhere, a dot, a lane or a table row, brings the reader here: the section
  is scrolled to its top and its heading takes the focus, while a PR the
  address names on arrival leaves the reader where the page starts. Both the
  panel and the timeline need that PR's year of the table file, and it is
  loaded only once the section is on screen: a link naming a PR must not
  fetch the large file at page load. A PR in none of the years the period
  loads is looked up in index.json and shown from its own year, which no
  chart, lane or table counts.
-->
<script lang="ts">
  import { tick } from 'svelte';
  import { get } from 'svelte/store';
  import { DataError, type Found, locateRow } from '../lib/data';
  import { getPage } from '../lib/page';
  import { prUrl } from '../lib/links';
  import { tableLoads } from '../lib/tables';
  import { prTimeline, rowOf } from '../lib/timeline';
  import SelectedPr from './SelectedPr.svelte';
  import { onScreen } from './onscreen';
  import TimelineChart from './timeline/TimelineChart.svelte';

  const { selection, data, view, loader, meta } = getPage();
  const loads = tableLoads(loader);

  const pr = $derived($selection.pr);
  const loaded = $derived($view.dataset);
  const loadedRow = $derived(pr === null ? -1 : rowOf(loaded, pr));

  let shown = $state(false);

  // A PR in none of the years the period loads, looked up in the index and
  // shown from its own year, which joins no figure. The lookup waits for the
  // section to be on screen, as the table file does: the index is large.
  type Away =
    | { pr: number; status: 'looking' }
    | { pr: number; status: 'found'; found: Found }
    | { pr: number; status: 'missing' }
    | { pr: number; status: 'error'; message: string };
  let away = $state<Away | null>(null);
  $effect(() => {
    if (pr === null || loadedRow !== -1 || $data.loading || !shown) return;
    const want = pr;
    away = { pr: want, status: 'looking' };
    const settle = (next: Away) => {
      if (away?.pr === want) away = next;
    };
    loader.find(want).then(
      (found) => settle(found === null ? { pr: want, status: 'missing' } : { pr: want, status: 'found', found }),
      (err: unknown) =>
        settle({
          pr: want,
          status: 'error',
          message: err instanceof DataError ? `${err.file}: ${err.detail}` : String(err),
        }),
    );
  });
  const elsewhere = $derived(loadedRow === -1 && away?.pr === pr ? away : null);
  const looking = $derived(loadedRow === -1 && ($data.loading || elsewhere === null || elsewhere.status === 'looking'));

  const dataset = $derived(loadedRow !== -1 ? loaded : elsewhere?.status === 'found' ? elsewhere.found.dataset : loaded);
  const row = $derived(loadedRow !== -1 ? loadedRow : elsewhere?.status === 'found' ? elsewhere.found.row : -1);
  const located = $derived(row === -1 ? null : locateRow(dataset, row));
  const year = $derived(located?.year ?? null);
  const table = $derived(year === null || !shown ? null : loader.table(year));

  $effect(() => {
    if (shown && year !== null) loads.request(year);
  });

  /** Whether a PR the panel offers to show is in the data: in the loaded years, or failing that in the index. */
  const isPr = (number: number): Promise<boolean> =>
    rowOf(loaded, number) !== -1 || rowOf(dataset, number) !== -1
      ? Promise.resolve(true)
      : loader.yearOf(number).then(
          (y) => y !== null,
          () => false,
        );

  /** Whether the ascending `rows` hold `r`. */
  function holds(rows: Uint32Array, r: number): boolean {
    let lo = 0;
    let hi = rows.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((rows[mid] as number) < r) lo = mid + 1;
      else hi = mid;
    }
    return rows[lo] === r;
  }
  const outside = $derived(row !== -1 && (loadedRow === -1 || !holds($view.rows, row)));

  // Watches for the section on screen, and forgets it was when the section
  // goes, so a PR chosen later loads only once it is on screen in its turn.
  function watch(node: HTMLElement) {
    const stop = onScreen(() => (shown = true))(node);
    return () => {
      if (typeof stop === 'function') stop();
      shown = false;
    };
  }

  let section = $state<HTMLElement>();
  let heading = $state<HTMLElement>();
  // The PR the page arrived with is not "chosen": the reader stays put.
  let arrived = get(selection).pr;
  $effect(() => {
    const now = pr;
    if (now === arrived) return;
    arrived = now;
    if (now === null) return;
    void tick().then(() => {
      heading?.focus({ preventScroll: true });
      section?.scrollIntoView?.({ block: 'start' });
    });
  });

  const choose = (number: number) => selection.update((s) => ({ ...s, pr: number }));
</script>

{#if pr !== null}
  <section id="pr" aria-labelledby="pr-heading" aria-busy={looking ? 'true' : undefined} bind:this={section} {@attach watch}>
    <h2 id="pr-heading" tabindex="-1" bind:this={heading}>
      Pull request <a href={prUrl(meta.repo, pr)} target="_blank" rel="noopener noreferrer">#{pr}</a>
    </h2>
    {#if row === -1 || located === null}
      {#if $data.loading}
        <p class="status" role="status">Loading the data…</p>
      {:else if elsewhere === null || elsewhere.status === 'looking'}
        <p class="status" role="status">Looking for #{pr} in the years this period does not load…</p>
      {:else if elsewhere.status === 'error'}
        <p class="missing" role="alert">
          #{pr} could not be looked up in the years this period does not load: {elsewhere.message}. Reloading the page
          will try again.
        </p>
      {:else}
        <p class="missing">
          no such PR: #{pr} is not in the data{$data.errors.length > 0 ? ' that could be loaded' : ''}.
        </p>
      {/if}
    {:else}
      {#if outside}
        <p class="outside">
          This pull request is not in the current selection: the filters leave it out, so no chart, lane or table on
          this page counts it.
        </p>
      {/if}
      <SelectedPr
        data={dataset}
        {row}
        index={located.index}
        table={loads.map.get(located.year)}
        onchoose={choose}
        isPr={isPr}
      />
      {#if table === null}
        <p class="status waiting">The timeline of #{pr} loads when this section is on screen.</p>
      {:else}
        <!-- A new PR starts afresh: no scroll, open commits list or focus carries over. -->
        {#key pr}
          {#await table}
            <p class="status waiting" role="status">Loading the timeline of #{pr}…</p>
          {:then t}
            <TimelineChart timeline={prTimeline(dataset, row, t)} />
          {:catch err}
            <p class="missing" role="alert">
              The timeline of #{pr} could not be loaded: {err instanceof Error ? err.message : String(err)}. Reloading
              the page will try again.
            </p>
          {/await}
        {/key}
      {/if}
    {/if}
  </section>
{/if}

<style>
  section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-5);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    scroll-margin-top: var(--space-4);
  }

  h2 {
    margin: 0;
  }

  h2:focus {
    outline: none;
  }

  h2:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }

  .status,
  .missing {
    margin: 0;
    color: var(--text-muted);
  }

  .outside {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border-inline-start: 3px solid var(--border-strong);
    background: var(--page);
    font-size: var(--text-sm);
  }

  /* From the placeholder through the load, holds about a timeline's height,
     so the section does not shrink before the chart replaces it. */
  .waiting {
    min-height: 24rem;
  }

  @media (width < 720px) {
    section {
      padding: var(--space-4);
    }
  }
</style>
