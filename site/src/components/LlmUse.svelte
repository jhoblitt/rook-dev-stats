<script lang="ts">
  import { bucketLegend, bucketTable, withCoverage } from '../lib/charts';
  import { COLOURS } from '../lib/colours';
  import { DISCLOSED, NOT_DISCLOSED, dayStart, periodRange } from '../lib/filters';
  import {
    comparison,
    comparisonSummary,
    describeShares,
    familiesModel,
    percent,
    shareModel,
  } from '../lib/llm';
  import { getPage, sectionsBusy, sectionsStale } from '../lib/page';
  import { openedIn } from '../lib/select';
  import { chooseBucket } from '../lib/selection';
  import { sectionHash } from '../lib/state';
  import { disclosureCounts } from '../lib/stats/measures';
  import { weekly } from '../lib/stats/weekly';
  import { periodZoom } from '../lib/zoom';
  import BucketChart from './charts/BucketChart.svelte';
  import ChartFrame from './charts/ChartFrame.svelte';
  import Key from './charts/Key.svelte';
  import SectionHead from './SectionHead.svelte';

  const { meta, selection, data, view } = getPage();
  const zoom = periodZoom(getPage());

  const dataset = $derived($view.dataset);
  const filters = $derived($view.filters);
  const period = $derived(periodRange(filters));
  // Disclosure describes how a PR was written, so every figure here is about
  // the PRs opened in the period.
  const rows = $derived($view.rows);
  const opened = $derived(openedIn(dataset, rows, period));
  const empty = $derived(rows.length === 0);
  const fetched = $derived(dataset.meta.fetched_through);

  const shares = $derived(weekly(dataset, rows, period, 'disclosureShare'));
  const share = $derived(withCoverage(shareModel(shares), period, fetched));
  const step = $derived(share.step);
  const counts = $derived(disclosureCounts(dataset, opened));
  const families = $derived(familiesModel(shares, dataset.meta.families, counts));
  const familyModel = $derived(withCoverage(families.model, period, fetched));
  const familyNote =
    'In percent of the PRs opened, on one scale. A PR can name more than one tool, and “unspecified” counts a disclosure that names none, so the shares by tool do not add up to the share disclosing.';
  const compared = $derived(comparison(dataset, opened));

  const noneOpened = 'no PR was opened in this period';
  const shareNothing = $derived(opened.length === 0 ? noneOpened : null);
  const familyNothing = $derived(
    opened.length === 0 ? noneOpened : counts.disclosed === 0 ? 'no PR opened in this period discloses AI use' : null,
  );

  const selected = $derived($selection.week === null ? null : dayStart($selection.week));
  const onbucket = (bucket: number) => selection.update((s) => chooseBucket(s, bucket));

  const shareTitle = $derived(`Share of PRs opened that disclose AI use, per ${step}`);
  const familyTitle = $derived(`Share of PRs opened naming each tool, per ${step}`);
  const compareTitle = `${DISCLOSED} against not disclosed, PRs opened in the period`;
</script>

<section id="llm" tabindex="-1" aria-labelledby="llm-heading" class:stale={sectionsStale($view, $data)} aria-busy={sectionsBusy($view, $data) ? 'true' : undefined}>
  <SectionHead name="ai-use">
    <h2 id="llm-heading">AI use</h2>
  </SectionHead>

  <ChartFrame
    title={shareTitle}
    summary={describeShares(share)}
    {empty}
    nothing={shareNothing}
    table={bucketTable(share, percent)}
  >
    <BucketChart
      model={share}
      format={percent}
      label={shareTitle}
      unit="% of PRs opened"
      height={200}
      {selected}
      onselect={onbucket}
      {zoom}
    />
  </ChartFrame>

  <ChartFrame
    title={familyTitle}
    note={familyNote}
    summary={describeShares(familyModel)}
    {empty}
    nothing={familyNothing}
    legend={bucketLegend(familyModel)}
    table={bucketTable(familyModel, percent)}
  >
    <BucketChart
      model={familyModel}
      format={percent}
      label={familyTitle}
      panels={families.panels}
      height={200}
      {selected}
      onselect={onbucket}
      {zoom}
    />
  </ChartFrame>

  <ChartFrame
    title={compareTitle}
    summary={comparisonSummary(compared)}
    {empty}
    nothing={opened.length === 0 ? noneOpened : null}
  >
    <div class="scroll">
      <table class="compare">
        <thead>
          <tr>
            <th scope="col"><span class="visually-hidden">Figure</span></th>
            <th scope="col"><span class="head"><Key mark="bar" color={COLOURS.notDisclosed} />{NOT_DISCLOSED}</span></th>
            <th scope="col"><span class="head"><Key mark="bar" color={COLOURS.disclosed} />{DISCLOSED}</span></th>
          </tr>
        </thead>
        <tbody>
          {#each compared as r (r.key)}
            <tr>
              <th scope="row">{r.label}</th>
              {#each r.cells as c, i (i)}
                <td>
                  <span class="value">{c.text}</span>
                  {#if c.basis !== null}<span class="count">{c.basis}</span>{/if}
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </ChartFrame>

  <p class="caveat">
    “{NOT_DISCLOSED}” is not “no AI”: disclosure is voluntary, and a PR can use AI without saying so. The two
    groups also differ in other ways, such as kind, size and author, so a difference between them does not show that
    AI use caused it. Disclosed PRs are newer on average, so the share merged at a long horizon is about fewer of them,
    and only their earliest ones, opened when disclosure was rarer. To compare PRs of like size, use the Size filter.
    <a href={sectionHash($selection, 'disclosure', meta)}>How disclosure is detected, and what it cannot show</a>.
  </p>
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

  /* While a wider period loads, the charts keep their last figures, dimmed. */
  .stale {
    opacity: 0.6;
  }

  .scroll {
    overflow-x: auto;
  }

  .compare {
    border-collapse: collapse;
    font-size: var(--text-sm);
  }

  .compare th,
  .compare td {
    padding: var(--space-2) var(--space-4) var(--space-2) 0;
    border-bottom: 1px solid var(--grid);
    text-align: start;
    vertical-align: top;
  }

  .compare thead th {
    color: var(--text-muted);
    font-weight: 600;
  }

  .compare th[scope='row'] {
    font-weight: 400;
    color: var(--text-muted);
  }

  .head {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }

  .value {
    display: block;
    font-weight: 600;
  }

  .count {
    display: block;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .caveat {
    margin: 0;
    max-width: var(--measure);
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  @media (width < 720px) {
    section {
      padding: var(--space-4);
    }
  }
</style>
