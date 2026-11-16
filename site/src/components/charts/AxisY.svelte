<svelte:options namespace="svg" />

<!-- The value axis: hairline gridlines across the plot, their labels to the left, and the unit above. -->
<script lang="ts">
  import type { Tick } from '../../lib/plot';

  interface Props {
    /** Each tick's `at` is its y, in the plot's pixels. */
    ticks: readonly Tick[];
    x0: number;
    x1: number;
    /** What the axis measures, written above its top tick. */
    unit?: string | undefined;
    unitY?: number;
  }

  let { ticks, x0, x1, unit, unitY = 10 }: Props = $props();
</script>

<g class="axis-y" aria-hidden="true">
  {#each ticks as t (t.at)}
    <line x1={x0} x2={x1} y1={t.at} y2={t.at} />
    <text x={x0 - 6} y={t.at} dy="0.32em">{t.label}</text>
  {/each}
  {#if unit}
    <text class="unit" x={x0} y={unitY}>{unit}</text>
  {/if}
</g>

<style>
  line {
    stroke: var(--grid);
    stroke-width: 1;
    shape-rendering: crispEdges;
  }

  text {
    fill: var(--text-faint);
    font-size: 12px;
    text-anchor: end;
    font-variant-numeric: tabular-nums;
  }

  .unit {
    text-anchor: start;
  }
</style>
