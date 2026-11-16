<!-- The names of a chart's series, each beside a key drawn as its mark is. -->
<script lang="ts">
  import type { LegendItem } from '../../lib/charts';
  import Key from './Key.svelte';

  interface Props {
    items: readonly LegendItem[];
  }

  let { items }: Props = $props();
</script>

<ul class="legend" aria-label="Legend">
  {#each items as item (item.label)}
    <li><Key mark={item.mark} color={item.color} shape={item.shape} dashed={item.dashed} />{item.label}</li>
  {/each}
</ul>

<style>
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-4);
    margin: 0 0 var(--space-2);
    padding: 0;
    list-style: none;
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
</style>
