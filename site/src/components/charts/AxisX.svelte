<svelte:options namespace="svg" />

<!-- The horizontal axis: a baseline and its tick labels under it. -->
<script lang="ts">
  import type { Tick } from '../../lib/plot';

  interface Props {
    /** Each tick's `at` is its x, in the plot's pixels. */
    ticks: readonly Tick[];
    /** The baseline's height. */
    y: number;
    x0: number;
    x1: number;
  }

  let { ticks, y, x0, x1 }: Props = $props();
</script>

<g class="axis-x" aria-hidden="true">
  <line class="baseline" x1={x0} x2={x1} y1={y} y2={y} />
  {#each ticks as t (t.at)}
    <text x={t.at} y={y + 16} class:strong={t.strong}>{t.label}</text>
  {/each}
</g>

<style>
  .baseline {
    stroke: var(--baseline);
    stroke-width: 1;
    shape-rendering: crispEdges;
  }

  text {
    fill: var(--text-faint);
    font-size: 12px;
    text-anchor: middle;
    font-variant-numeric: tabular-nums;
  }

  .strong {
    fill: var(--text);
    font-weight: 600;
  }
</style>
