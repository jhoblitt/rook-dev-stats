<svelte:options namespace="svg" />

<!--
  One mark of a PR's timeline, centred on x, y: filled and ringed in the
  surface colour, hollow and outlined, or drawn as lines over a surface halo,
  so it stays legible where it crosses the line or another mark.
-->
<script lang="ts">
  import { type Glyph, glyphPath } from '../../lib/timeline-glyphs';

  interface Props {
    glyph: Glyph;
    colour: string;
    r: number;
    x?: number;
    y?: number;
  }

  let { glyph, colour, r, x = 0, y = 0 }: Props = $props();
  const g = $derived(glyphPath(glyph, r));
</script>

<g transform="translate({x} {y})" aria-hidden="true">
  {#if g.fill === 'solid'}
    <path class="solid" d={g.d} style:fill={colour} />
  {:else if g.fill === 'hollow'}
    <path class="hollow" d={g.d} style:stroke={colour} />
    {#if g.inner}<path d={g.inner} style:fill={colour} />{/if}
  {:else}
    <path class="halo" d={g.d} />
    <path class="stroke" d={g.d} style:stroke={colour} />
  {/if}
</g>

<style>
  .solid {
    stroke: var(--surface);
    stroke-width: 3;
    paint-order: stroke;
  }

  .hollow {
    fill: var(--surface);
    stroke-width: 1.75;
  }

  .halo,
  .stroke {
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .halo {
    stroke: var(--surface);
    stroke-width: 5;
  }

  .stroke {
    stroke-width: 2;
  }
</style>
