<!--
  A series' key, drawn as its mark is: a rounded square for a bar, a wash
  with its edge for an area, a short line with its marker for a line, a
  hollow marker for a value not reached, and a faded square for a partial
  bucket's bars, or, given a shape, a line stopping short of a lone hollow
  marker for a partial bucket's line value.
-->
<script lang="ts">
  import type { Readout } from '../../lib/charts';
  import { markerPath } from '../../lib/plot';

  interface Props {
    mark: Readout['mark'];
    color: string;
    shape?: Readout['shape'];
    dashed?: boolean | undefined;
  }

  let { mark, color, shape, dashed = false }: Props = $props();
</script>

<svg class="key" width="20" height="12" viewBox="0 0 20 12" aria-hidden="true">
  {#if mark === 'bar'}
    <rect x="4" y="0" width="12" height="12" rx="3" style:fill={color} />
  {:else if mark === 'partial' && shape}
    <line x1="0" x2="6" y1="6" y2="6" class="stroke" style:stroke={color} />
    <path d={markerPath(shape, 40)} transform="translate(14 6)" class="hollow" style:stroke={color} />
  {:else if mark === 'partial'}
    <rect x="4" y="0" width="12" height="12" rx="3" class="faded" style:fill={color} />
  {:else if mark === 'area'}
    <rect x="2" y="2" width="16" height="10" class="wash" style:fill={color} />
    <line x1="2" x2="18" y1="2" y2="2" class="edge" style:stroke={color} />
  {:else if mark === 'note'}
    <rect x="2" y="0" width="16" height="12" rx="2" style:fill={color} />
  {:else if mark === 'unreached'}
    <path d={markerPath('circle', 40)} transform="translate(10 6)" class="hollow" style:stroke={color} />
  {:else if mark === 'line'}
    <line x1="0" x2="20" y1="6" y2="6" class="stroke" class:dashed style:stroke={color} />
    {#if shape}
      <path d={markerPath(shape, 40)} transform="translate(10 6)" class="marker" style:fill={color} />
    {/if}
  {/if}
</svg>

<style>
  .key {
    flex: none;
  }

  .wash {
    fill-opacity: 0.6;
  }

  .faded {
    fill-opacity: 0.45;
  }

  .edge,
  .stroke {
    stroke-width: 2;
    stroke-linecap: round;
  }

  .dashed {
    stroke-dasharray: 4 3;
    stroke-linecap: butt;
  }

  .marker {
    stroke: var(--surface);
    stroke-width: 1.5;
  }

  .hollow {
    fill: var(--surface);
    stroke-width: 1.5;
  }
</style>
