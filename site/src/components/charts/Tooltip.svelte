<!--
  The exact values at the pointer or the focus, value first. It repeats what
  the focused mark's accessible name and the table hold, so screen readers
  skip it.
-->
<script lang="ts">
  import type { Readout } from '../../lib/charts';
  import Key from './Key.svelte';
  import { measureWidth } from './measure';

  interface Props {
    title: string;
    rows: readonly Readout[];
    /** The point to sit beside, in the plot's pixels. */
    x: number;
    y: number;
    frameWidth: number;
  }

  let { title, rows, x, y, frameWidth }: Props = $props();

  let width = $state(0);
  const GAP = 12;
  const left = $derived(x + GAP + width <= frameWidth ? x + GAP : Math.max(0, x - GAP - width));
</script>

<div class="tip" style:left="{left}px" style:top="{y}px" {@attach measureWidth((w) => (width = w))} aria-hidden="true">
  <p class="title">{title}</p>
  <table>
    <tbody>
      {#each rows as r (r.label)}
        <tr class:strong={r.strong} class:total={r.mark === 'total'}>
          <td class="key">
            {#if r.color !== null}<Key mark="line" color={r.color} shape={r.shape} dashed={r.dashed} />{/if}
          </td>
          <td class="value">{r.value}</td>
          <td class="label">{r.label}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .tip {
    position: absolute;
    z-index: 2;
    width: max-content;
    max-width: min(20rem, 90%);
    padding: var(--space-2) var(--space-3);
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    box-shadow: 0 6px 20px rgb(0 0 0 / 0.18);
    font-size: var(--text-sm);
    line-height: 1.4;
    pointer-events: none;
  }

  .title {
    margin: 0 0 var(--space-1);
    color: var(--text-muted);
  }

  table {
    border-collapse: collapse;
  }

  td {
    padding: 0;
    vertical-align: middle;
  }

  .key {
    width: 20px;
    padding-right: var(--space-2);
    line-height: 0;
  }

  .value {
    padding-right: var(--space-2);
    font-weight: 700;
    text-align: end;
    font-variant-numeric: tabular-nums;
  }

  .label {
    color: var(--text-muted);
  }

  .strong .label {
    color: var(--text);
    font-weight: 600;
  }

  .total td {
    border-top: 1px solid var(--grid);
  }
</style>
