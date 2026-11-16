<script lang="ts">
  import {
    bucketLegend,
    bucketTable,
    curveLegend,
    curveTable,
    describeCounts,
    describeCurve,
    describeWaits,
    withCoverage,
  } from '../lib/charts';
  import { dayStart, periodRange } from '../lib/filters';
  import { formatCount, formatDays } from '../lib/format';
  import { getPage, sectionsBusy, sectionsStale } from '../lib/page';
  import {
    capacityLegend,
    capacityModel,
    capacityNote,
    capacityNothing,
    capacityPanels,
    commandFigures,
    commandSummary,
    commandsModel,
    curveModel,
    curveNothing,
    curveQuantiles,
    describeCapacity,
    formatRatio,
    reviewerShareText,
    reviewsModel,
    onlyBackports,
    spanNote,
    spanTitle,
    waitingSeries,
    BUSIEST_COMMANDS,
    waitsModel,
    waitsNothing,
  } from '../lib/review';
  import { openedIn } from '../lib/select';
  import { chooseBucket } from '../lib/selection';
  import { awaitingResponse } from '../lib/stats/backlog';
  import { capacity } from '../lib/stats/capacity';
  import { commandUse } from '../lib/stats/commands';
  import { type Span, outcomeCurve } from '../lib/stats/curve';
  import { reviewLoad } from '../lib/stats/reviewers';
  import { weekly } from '../lib/stats/weekly';
  import { periodZoom } from '../lib/zoom';
  import BucketChart from './charts/BucketChart.svelte';
  import ChartFrame from './charts/ChartFrame.svelte';
  import StepCurve from './charts/StepCurve.svelte';
  import SectionHead from './SectionHead.svelte';

  const { selection, data, view } = getPage();
  const zoom = periodZoom(getPage());

  const dataset = $derived($view.dataset);
  const filters = $derived($view.filters);
  const period = $derived(periodRange(filters));
  // The calendar charts count every PR active in the period; the curves, the
  // waits and bot-command use are about the PRs opened in it.
  const rows = $derived($view.rows);
  const opened = $derived(openedIn(dataset, rows, period));
  const empty = $derived(rows.length === 0);

  const fetched = $derived(dataset.meta.fetched_through);
  const openedWeekly = $derived(weekly(dataset, rows, period, 'opened'));
  const reviewsWeekly = $derived(weekly(dataset, rows, period, 'reviews'));
  // Whether human review keeps up with the PRs arriving: the people giving
  // reviews, two ratios Velocity cannot show, and the part of its backlog
  // waiting for a first response.
  const capacityCounts = $derived(
    capacity(
      openedWeekly,
      reviewsWeekly,
      weekly(dataset, rows, period, 'reviewers'),
      awaitingResponse(dataset, rows, period),
    ),
  );
  const capacityChart = $derived(withCoverage(capacityModel(capacityCounts), period, fetched));
  const capacityPartial = $derived(capacityChart.partial ?? []);
  const reviews = $derived(withCoverage(reviewsModel(reviewsWeekly), period, fetched));
  const step = $derived(capacityCounts.step);

  // A chart with PRs selected but nothing to measure says what is missing;
  // only an empty selection says "no PRs match".
  function curve<S extends Span>(span: S, title: string, xUnit: string, note?: string) {
    const c = outcomeCurve(dataset, opened, span);
    const model = curveModel(c, span);
    const nothing = model.days.length === 0 ? curveNothing(span, opened.length) : null;
    return { span, title, note, xUnit, model, q: curveQuantiles(c, span), nothing };
  }

  function waits(span: Span, title: string, note?: string) {
    const model = withCoverage(
      waitsModel(weekly(dataset, rows, period, waitingSeries(span)), openedWeekly, span),
      period,
      fetched,
    );
    return { span, title, note, model, nothing: waitsNothing(model, span, opened.length) };
  }

  const outcomes = $derived([
    curve('response', 'Time to first response', 'time since ready for review'),
    curve('approval', 'Time to first approval', 'time since ready for review'),
    curve('merge', 'Time to merge', 'time since opened'),
  ]);
  // One day axis for the three, so their pace compares at a glance.
  const outcomeDays = $derived(Math.max(...outcomes.map((c) => c.model.days.at(-1) ?? 0)));
  const outcomeWaits = $derived([
    waits('response', `Wait for a first response, by ${step} opened`),
    waits('approval', `Wait for a first approval, by ${step} opened`),
    waits('merge', `Wait to merge, by ${step} opened`),
  ]);
  const afterApproval = $derived(curve('afterApproval', 'Time after first approval', 'time since first approval'));

  const SPAN_UNITS = {
    firstCommitToOpened: 'time since the first commit',
    openedToLastCommit: 'time since opened',
    afterLastCommit: 'time since the last commit',
  } as const;
  const spans = $derived(
    (['firstCommitToOpened', 'openedToLastCommit', 'afterLastCommit'] as const).map((span) => {
      const title = spanTitle(span, onlyBackports(filters));
      const note = spanNote(span, filters);
      return {
        curve: curve(span, title, SPAN_UNITS[span], note),
        waits: waits(span, `${title}, by ${step} opened`, note),
      };
    }),
  );

  const commands = $derived(
    withCoverage(commandsModel(weekly(dataset, rows, period, 'commands'), dataset.meta.commands), period, fetched),
  );
  // The panels share one value axis, so their bars compare.
  const commandTop = $derived(Math.max(1, ...commands.bars.flatMap((b) => b.values)));
  // The busiest commands show; the rest wait behind a control. The table and
  // the text alternative always cover every command.
  let allCommands = $state(false);
  const shownCommands = $derived(allCommands ? commands.bars : commands.bars.slice(0, BUSIEST_COMMANDS));
  const use = $derived(commandFigures(commandUse(dataset, opened)));
  const load = $derived(reviewLoad(dataset, rows, period, 10));

  const selected = $derived($selection.week === null ? null : dayStart($selection.week));
  const onbucket = (bucket: number) => selection.update((s) => chooseBucket(s, bucket));
</script>

{#snippet curveFrame(c: ReturnType<typeof curve>, xMax?: number)}
  <ChartFrame
    title={c.title}
    note={c.note}
    summary={describeCurve(c.model, c.q)}
    {empty}
    nothing={c.nothing}
    legend={curveLegend(c.model)}
    table={curveTable(c.model)}
  >
    {#snippet figures()}
      <p class="quantiles">Median <strong>{c.q.median}</strong> · 90th percentile <strong>{c.q.p90}</strong></p>
    {/snippet}
    <StepCurve model={c.model} label={c.title} xUnit={c.xUnit} {xMax} />
  </ChartFrame>
{/snippet}

{#snippet waitFrame(w: ReturnType<typeof waits>)}
  <ChartFrame
    title={w.title}
    note={w.note}
    summary={describeWaits(w.model)}
    {empty}
    nothing={w.nothing}
    legend={bucketLegend(w.model)}
    table={bucketTable(w.model, formatDays)}
  >
    <BucketChart
      model={w.model}
      format={formatDays}
      label={w.title}
      unit="wait, log scale"
      scale="logDays"
      {selected}
      onselect={onbucket}
      {zoom}
    />
  </ChartFrame>
{/snippet}

<section id="review" tabindex="-1" aria-labelledby="review-heading" class:stale={sectionsStale($view, $data)} aria-busy={sectionsBusy($view, $data) ? 'true' : undefined}>
  <SectionHead name="review">
    <h2 id="review-heading">Review</h2>
  </SectionHead>

  <ChartFrame
    title="Review capacity against arrivals, per {step}"
    note={capacityNote(step)}
    summary={describeCapacity(capacityCounts, capacityPartial)}
    {empty}
    nothing={capacityNothing(capacityCounts, capacityPartial)}
    legend={capacityLegend(capacityChart)}
    table={bucketTable(capacityChart, formatRatio)}
  >
    <BucketChart
      model={capacityChart}
      format={formatRatio}
      label="Review capacity against arrivals, per {step}"
      panels={capacityPanels(step)}
      sharedScale={false}
      height={420}
      {selected}
      onselect={onbucket}
      {zoom}
    />
  </ChartFrame>

  <ChartFrame
    title="Human and bot reviews per {step}"
    summary={describeCounts(reviews)}
    {empty}
    legend={bucketLegend(reviews)}
    table={bucketTable(reviews, formatCount)}
  >
    <BucketChart
      model={reviews}
      format={formatCount}
      label="Human and bot reviews per {step}"
      unit="reviews per {step}"
      integer
      {selected}
      onselect={onbucket}
      {zoom}
    />
  </ChartFrame>

  <div class="grid">
    {#each outcomes as c (c.span)}
      {@render curveFrame(c, outcomeDays)}
    {/each}
  </div>

  <div class="grid">
    {#each outcomeWaits as w (w.span)}
      {@render waitFrame(w)}
    {/each}
  </div>

  {@render curveFrame(afterApproval)}

  {#each spans as s (s.curve.span)}
    <div class="pair">
      {@render curveFrame(s.curve)}
      {@render waitFrame(s.waits)}
    </div>
  {/each}

  <ChartFrame
    title="Bot commands per {step}, by command"
    summary={commandSummary(commands, use)}
    {empty}
    table={bucketTable(commands, formatCount)}
  >
    {#snippet figures()}
      <dl class="use">
        <div>
          <dt>PRs opened in the period with a bot command</dt>
          <dd>{use.share ?? 'no PRs opened in the period'}</dd>
        </div>
        <div>
          <dt>bot commands on merged PRs</dt>
          <dd>
            {#if use.merged}
              mean {use.merged.mean} · median {use.merged.median} · 90th percentile {use.merged.p90}
            {:else}
              no PR opened in the period has merged
            {/if}
          </dd>
        </div>
      </dl>
    {/snippet}
    {#if commands.bars.length === 0}
      <p class="none">No bot commands in this period.</p>
    {/if}
    {#each shownCommands as b, i (b.key)}
      {@const last = i === shownCommands.length - 1}
      <div class="command">
        <p class="command-name">{b.label}</p>
        <BucketChart
          model={{ ...commands, bars: [b] }}
          format={formatCount}
          label="{b.label}, per {step}"
          integer
          height={last ? 88 : 64}
          yMax={commandTop}
          axis={last}
          {selected}
          onselect={onbucket}
          {zoom}
        />
      </div>
    {/each}
    {#if commands.bars.length > BUSIEST_COMMANDS}
      <button type="button" class="more" aria-expanded={allCommands} onclick={() => (allCommands = !allCommands)}>
        {allCommands ? `show the ${BUSIEST_COMMANDS} busiest commands` : `show all ${commands.bars.length} commands`}
      </button>
    {/if}
  </ChartFrame>

  <div class="load">
    <h3>Review load</h3>
    <p>{empty ? 'no PRs match' : reviewerShareText(load)}</p>
  </div>
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

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr));
    gap: var(--space-6) var(--space-5);
  }

  .pair {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 26rem), 1fr));
    gap: var(--space-6) var(--space-5);
  }

  .quantiles,
  .none {
    margin: var(--space-2) 0 0;
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  .quantiles strong {
    color: var(--text);
    font-weight: 600;
  }

  .command-name {
    margin: var(--space-2) 0 0;
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  .use {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-6);
    margin: var(--space-3) 0 0;
  }

  .use dt {
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  .use dd {
    margin: 0;
    font-weight: 600;
  }

  .more {
    margin-top: var(--space-3);
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--page);
    color: var(--accent);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .load h3 {
    margin: 0 0 var(--space-2);
    font-size: var(--text-base);
    font-weight: 600;
  }

  .load p {
    margin: 0;
  }

  @media (width < 720px) {
    section {
      padding: var(--space-4);
    }
  }
</style>
