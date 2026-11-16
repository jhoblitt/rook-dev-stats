<script lang="ts">
  import { areaLegend, areaTable, bucketLegend, bucketTable, describeArea, describeCounts, withCoverage } from '../lib/charts';
  import { dayStart, periodRange } from '../lib/filters';
  import { formatCount } from '../lib/format';
  import { getPage, sectionsBusy, sectionsStale } from '../lib/page';
  import { chooseBand, chooseBucket } from '../lib/selection';
  import { backlog } from '../lib/stats/backlog';
  import { weekly } from '../lib/stats/weekly';
  import { backlogModel, prsModel } from '../lib/velocity';
  import { periodZoom } from '../lib/zoom';
  import BucketChart from './charts/BucketChart.svelte';
  import ChartFrame from './charts/ChartFrame.svelte';
  import StackedArea from './charts/StackedArea.svelte';
  import SectionHead from './SectionHead.svelte';

  const { selection, data, view } = getPage();
  const zoom = periodZoom(getPage());

  const dataset = $derived($view.dataset);
  const filters = $derived($view.filters);
  const period = $derived(periodRange(filters));
  // The calendar charts count every PR active in the period.
  const rows = $derived($view.rows);
  const empty = $derived(rows.length === 0);

  const prs = $derived(
    withCoverage(
      prsModel(
        weekly(dataset, rows, period, 'opened'),
        weekly(dataset, rows, period, 'merged'),
        weekly(dataset, rows, period, 'closed'),
      ),
      period,
      dataset.meta.fetched_through,
    ),
  );
  const open = $derived(backlogModel(backlog(dataset, rows, period)));
  const step = $derived(prs.step);

  const selected = $derived($selection.week === null ? null : dayStart($selection.week));
  const onbucket = (bucket: number) => selection.update((s) => chooseBucket(s, bucket));
  const onband = (bucket: number, key: string) => selection.update((s) => chooseBand(s, bucket, key));

  const prsTitle = $derived(`PRs opened, merged and closed unmerged, per ${step}`);
  const backlogTitle = $derived(`Open PRs at the end of each ${step}, by age`);
</script>

<section id="velocity" tabindex="-1" aria-labelledby="velocity-heading" class:stale={sectionsStale($view, $data)} aria-busy={sectionsBusy($view, $data) ? 'true' : undefined}>
  <SectionHead name="velocity">
    <h2 id="velocity-heading">Velocity</h2>
  </SectionHead>

  <ChartFrame
    title={prsTitle}
    summary={describeCounts(prs)}
    {empty}
    legend={bucketLegend(prs)}
    table={bucketTable(prs, formatCount)}
  >
    <BucketChart
      model={prs}
      format={formatCount}
      label={prsTitle}
      panels={[
        { keys: ['not-disclosed', 'disclosed'], unit: `PRs opened per ${step}` },
        { keys: ['merged', 'closed'], unit: `PRs merged or closed unmerged per ${step}` },
      ]}
      height={320}
      integer
      {selected}
      onselect={onbucket}
      {zoom}
    />
    <p class="hint">Drag across a chart to zoom to that range</p>
  </ChartFrame>

  <ChartFrame title={backlogTitle} summary={describeArea(open)} {empty} legend={areaLegend(open)} table={areaTable(open)}>
    <StackedArea
      model={open}
      label={backlogTitle}
      unit="open PRs"
      selected={{ bucket: selected, key: $selection.band }}
      onselect={onband}
      {zoom}
    />
  </ChartFrame>
</section>

<style>
  section {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    padding: var(--space-5);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    transition: opacity 0.2s;
  }

  h2 {
    margin: 0;
  }

  /* The one place the page says a chart can be dragged across. */
  .hint {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  /* While a wider period loads, the charts keep their last figures, dimmed. */
  .stale {
    opacity: 0.6;
  }

  @media (width < 720px) {
    section {
      padding: var(--space-4);
    }
  }
</style>
