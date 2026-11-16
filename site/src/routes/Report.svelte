<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import DotPlot from '../components/DotPlot.svelte';
  import FilterBar from '../components/FilterBar.svelte';
  import Lanes from '../components/Lanes.svelte';
  import LlmUse from '../components/LlmUse.svelte';
  import People from '../components/People.svelte';
  import PrTable from '../components/PrTable.svelte';
  import PrTimeline from '../components/PrTimeline.svelte';
  import Review from '../components/Review.svelte';
  import ReviewsRecordedNote from '../components/ReviewsRecordedNote.svelte';
  import Velocity from '../components/Velocity.svelte';
  import { yearHolds } from '../lib/data';
  import { createLanding, setLanding } from '../lib/landing';
  import { keepEqual } from '../lib/memo';
  import { type LoadProgress, getPage } from '../lib/page';
  import { reportSection } from '../lib/report-sections';
  import { type Sort, sameSort } from '../lib/sort';
  import { ALL_TABLE_ROWS, narrowing, rowText, sortWords, tableOrder } from '../lib/table';
  import { tableLoads } from '../lib/tables';
  import { periodZoom } from '../lib/zoom';

  const { data, selection, view, loader } = getPage();
  const { zoomed } = periodZoom(getPage());

  // The lanes list the PR table's rows in the PR table's order. Choosing a
  // PR leaves the order, and so the lanes, alone; titles count only when the
  // table is sorted by title.
  const loads = tableLoads(loader);
  const keepSort = keepEqual<Sort>(sameSort);
  const sort = $derived(keepSort($selection.sort));
  const week = $derived($selection.week);
  const band = $derived($selection.band);
  // Each part of the view on its own, so a view that keeps them, such as the
  // busy state before a recompute, orders nothing again.
  const dataset = $derived($view.dataset);
  const rows = $derived($view.rows);
  const filters = $derived($view.filters);
  const titles = $derived(sort.column === 'title' ? rowText(dataset, loads.map) : undefined);
  const laneOrder = $derived(tableOrder(dataset, rows, { filters, week, band }, sort, titles));
  const laneOrderName = $derived(`in the PR table’s order, ${sortWords(sort)}`);
  // A file that did not arrive may arrive when fetched again; one that
  // arrived and could not be read is the same file until the data is
  // published again.
  const canRetry = $derived($data.errors.some((e) => e.retry));
  const remedy = $derived(
    canRetry
      ? 'Try again fetches what failed.'
      : 'A file arrived but could not be read, so trying again would not help; reloading the page after the data is next published may.',
  );
  // What a load fetches, said once for the whole load: the line is a live
  // region, so it changes when the load does, never as each year arrives.
  const loadingWhat = (p: LoadProgress | null) => {
    const years = p?.years ?? [];
    const first = years[0];
    const last = years.at(-1);
    if (first === undefined || last === undefined) return 'Loading the data for this period.';
    return years.length === 1
      ? `Loading the data for this period: the files of ${first}.`
      : `Loading the data for this period: the files of ${years.length} years, ${first} to ${last}.`;
  };
  // How far it has come, beside the line and outside it, for the eye and for
  // a reader who asks; years.length is at least two.
  const arrivedText = (p: LoadProgress) =>
    `${p.arrived} of ${p.years.length} years ${p.arrived === 1 ? 'has' : 'have'} arrived.`;
  // A period is never shown over fewer years than it needs: while its years
  // load, or after one failed, the sections keep the last period that loaded
  // whole, and the line says which. A large recompute keeps the figures
  // shown until it is done. A zoom from a chart is said once its figures are
  // shown.
  const status = $derived(
    $data.loading
      ? $view.pending && !$view.first
        ? `Loading the data for this period; everything below is still for ${$view.filters.from} to ${$view.filters.to}, with the filters then chosen.`
        : loadingWhat($data.progress)
      : $view.recomputing
        ? $view.first
          ? 'Computing the figures for this period…'
          : 'Recomputing the figures for the filters chosen; everything below is still for the filters chosen before.'
        : $view.pending
          ? `The data for the period chosen could not be loaded, so everything below is still for ${$view.filters.from} to ${$view.filters.to}, with the filters then chosen. ${remedy}`
          : $zoomed !== null && $zoomed.from === $view.filters.from && $zoomed.to === $view.filters.to
            ? `The period is now ${$zoomed.from} to ${$zoomed.to}.`
            : $data.retry.state === 'succeeded'
              ? 'All the data for this period has loaded.'
              : '',
  );
  const retrying = $derived($data.retry.state === 'running');
  const clock = (at: number) => new Date(at).toTimeString().slice(0, 5);

  // The alert, and the button the reader pressed in it, go once a retry
  // brings every year: the focus moves to the line that says so.
  let statusLine = $state<HTMLElement>();
  let lastRetry = $data.retry.state;
  $effect(() => {
    const now = $data.retry.state;
    if (now === 'succeeded' && lastRetry !== 'succeeded') void tick().then(() => statusLine?.focus());
    lastRetry = now;
  });
  const tryAgain = () => {
    if (!retrying) data.retry();
  };
  // The lanes name their rows in the PR table's own words for them.
  const laneRowsName = $derived(
    narrowing(dataset, { filters, week, band }) ?? ALL_TABLE_ROWS,
  );

  // The page moves to the section the address names when it opens and
  // whenever the name changes; any other change to the address, such as a
  // filter's, leaves the reader where they are.
  const landing = createLanding(window);
  setLanding(landing);
  onDestroy(landing.release);
  let shownSection: string | null = null;
  $effect(() => {
    const name = $selection.section;
    const changed = name !== shownSection;
    shownSection = name;
    const id = name === null ? undefined : reportSection(name)?.id;
    if (changed && id !== undefined) void tick().then(() => landing.land(id));
    else landing.release();
  });
</script>

<h1 class="visually-hidden">Rook pull requests</h1>

<FilterBar />

{#if $data.errors.length > 0}
  <div class="load-errors" role="alert">
    <p>
      {$view.pending
        ? 'Some of the data for the period chosen could not be loaded:'
        : 'Some of the data could not be loaded, so everything below leaves these years out:'}
    </p>
    <ul>
      {#each $data.errors as e (e.file)}
        <li>{yearHolds(loader.meta, e.year)}: <code>{e.file}</code>, {e.message}</li>
      {/each}
    </ul>
    {#if $data.retry.state === 'failed'}
      <p>Tried again at {clock($data.retry.at)}; it still could not be loaded.</p>
    {/if}
    {#if canRetry}
      <button type="button" aria-disabled={retrying ? 'true' : undefined} onclick={tryAgain}>
        {retrying ? 'Trying again…' : 'Try again'}
      </button>
    {/if}
  </div>
{/if}

<p class="loading" role="status" tabindex="-1" bind:this={statusLine}>{status}</p>
{#if $data.progress !== null && $data.progress.years.length > 1}
  <p class="progress">{arrivedText($data.progress)}</p>
{/if}

{#if $view.first}
  <!-- Reached from another route while the period's years load: no section has figures to show yet. -->
  <div class="waiting" aria-busy="true"></div>
{:else}
  <ReviewsRecordedNote />
  <Velocity />
  <Review />
  <LlmUse />
  <DotPlot />
  <Lanes
    order={laneOrder}
    orderName={laneOrderName}
    newest={sort.column === 'opened' && sort.descending}
    rowsName={laneRowsName}
  />
  <!-- The chosen PR, what it is and then its timeline, between the views that choose one. -->
  <PrTimeline />
  <PrTable />
  <People />
{/if}

<style>
  .load-errors {
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
  }

  .load-errors p,
  .load-errors ul {
    margin: 0;
  }

  .load-errors button {
    margin-top: var(--space-2);
    min-height: 2.25rem;
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--page);
    color: var(--accent);
    font: inherit;
    cursor: pointer;
  }

  .load-errors button:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }

  .waiting {
    min-height: 60vh;
  }

  .loading,
  .progress {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  /* The count reads as the end of the status line above it. */
  .progress {
    margin-top: calc(-1 * var(--space-5));
  }

  /* Out of the flow while empty, but still rendered, so the live region announces. */
  .loading:empty {
    position: absolute;
  }
</style>
