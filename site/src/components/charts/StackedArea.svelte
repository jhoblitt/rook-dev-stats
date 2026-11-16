<!--
  Layers stacked per week (or month), each bucket a flat step because the
  stock is measured once, at the bucket's end. Each layer of each bucket is a
  hit target: hovering or focusing it shows the bucket's every layer, the
  arrow keys move between buckets (left, right) and layers (up, down), and a
  click, Enter or Space chooses it. Given a zoom, dragging across the plot
  sets the period (`PeriodBrush`). The chart takes its columns from
  `timeColumns`, as every chart over the period does, so a bucket sits at
  the same x as in the other charts.
-->
<script lang="ts">
  import { scaleLinear } from 'd3-scale';
  import { area, line } from 'd3-shape';
  import { type AreaModel, areaReadout } from '../../lib/charts';
  import { bucketName, formatCount } from '../../lib/format';
  import { PLOT_LEFT as LEFT, type Tick, bucketTicks, timeColumns } from '../../lib/plot';
  import AxisX from './AxisX.svelte';
  import { type PeriodZoom, columnAxis } from '../../lib/zoom';
  import AxisY from './AxisY.svelte';
  import PeriodBrush from './PeriodBrush.svelte';
  import Tooltip from './Tooltip.svelte';
  import { focusSibling, measureWidth } from './measure';

  interface Props {
    model: AreaModel;
    /** The chart's name for assistive technology, usually its title. */
    label: string;
    unit?: string;
    /** The selected bucket's first instant and layer key. */
    selected: { bucket: number | null; key: string | null };
    /** Called with a bucket's first instant and a layer's key when that layer of that bucket is chosen. */
    onselect: (bucket: number, key: string) => void;
    height?: number;
    /** Sets the period from a drag across the plot. */
    zoom?: PeriodZoom;
  }

  let { model, label, unit, selected, onselect, height = 220, zoom }: Props = $props();

  let measured = $state(0);
  const width = $derived(measured > 0 ? measured : 640);

  const top = $derived(unit ? 24 : 8);
  const base = $derived(height - 24);

  const n = $derived(model.buckets.length);
  const x = $derived(timeColumns(width, n));
  const zoomAxis = $derived(columnAxis(x, model.buckets, model.step));
  let dragging = $state(false);
  // Each layer's lower and upper edge per bucket.
  const bands = $derived.by(() => {
    const below = model.buckets.map(() => 0);
    return model.layers.map((l) => {
      const lo = [...below];
      const hi = lo.map((v, i) => v + (l.values[i] as number));
      hi.forEach((v, i) => (below[i] = v));
      return { lo, hi };
    });
  });
  const highest = $derived(Math.max(1, ...(bands.at(-1)?.hi ?? [])));
  const y = $derived(scaleLinear().domain([0, highest]).nice().range([base, top]));

  const yTicks: Tick[] = $derived(
    y
      .ticks(4)
      .filter((t) => Number.isInteger(t))
      .map((t) => ({ at: y(t), label: formatCount(t) })),
  );
  const selectedIndex = $derived(selected.bucket === null ? -1 : model.buckets.indexOf(selected.bucket));
  const selectedLayer = $derived(model.layers.findIndex((l) => l.key === selected.key));
  const centre = (i: number) => x.centre(i);
  const xTicks: Tick[] = $derived(
    bucketTicks(model.buckets, model.step, centre).map(({ i, label }) => ({ at: centre(i), label, strong: i === selectedIndex })),
  );

  type Point = readonly [x: number, lo: number, hi: number];
  const shapes = $derived(
    bands.map(({ lo, hi }) => {
      const points: Point[] = model.buckets.flatMap((_, i) => {
        const left = x.start(i);
        return [
          [left, lo[i] as number, hi[i] as number],
          [left + x.step, lo[i] as number, hi[i] as number],
        ] as const;
      });
      const fill = area<Point>()
        .x((p) => p[0])
        .y0((p) => y(p[1]))
        .y1((p) => y(p[2]));
      const edge = line<Point>()
        .x((p) => p[0])
        .y((p) => y(p[2]));
      return { fill: fill(points) ?? '', edge: edge(points) ?? '' };
    }),
  );

  let active = $state<{ i: number; k: number } | null>(null);
  let focused = $state<{ i: number; k: number } | null>(null);
  const tabStop = $derived(
    focused ?? (selectedIndex >= 0 && selectedLayer >= 0 ? { i: selectedIndex, k: selectedLayer } : { i: n - 1, k: 0 }),
  );

  function cell(i: number, k: number) {
    const b = bands[k] as { lo: number[]; hi: number[] };
    const upper = y(b.hi[i] as number);
    return { x: x.start(i), y: upper, height: y(b.lo[i] as number) - upper };
  }

  function name(i: number, k: number): string {
    const layer = model.layers[k] as AreaModel['layers'][number];
    const total = bands.at(-1)?.hi[i] as number;
    return (
      `${bucketName(model.buckets[i] as number, model.step)}, ${layer.label}: ` +
      `${formatCount(layer.values[i] as number)} of ${formatCount(total)} ${model.totalLabel}`
    );
  }

  function choose(i: number, k: number) {
    onselect(model.buckets[i] as number, (model.layers[k] as AreaModel['layers'][number]).key);
  }

  function onkeydown(e: KeyboardEvent, i: number, k: number) {
    let next = { i, k };
    switch (e.key) {
      case 'ArrowRight':
        next = { i: Math.min(n - 1, i + 1), k };
        break;
      case 'ArrowLeft':
        next = { i: Math.max(0, i - 1), k };
        break;
      case 'ArrowUp':
        next = { i, k: Math.min(model.layers.length - 1, k + 1) };
        break;
      case 'ArrowDown':
        next = { i, k: Math.max(0, k - 1) };
        break;
      case 'Home':
        next = { i: 0, k };
        break;
      case 'End':
        next = { i: n - 1, k };
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        choose(i, k);
        return;
      default:
        return;
    }
    e.preventDefault();
    focused = next;
    // The hit targets run bucket by bucket, layer by layer within each.
    focusSibling(e.currentTarget, next.i * model.layers.length + next.k);
  }
</script>

<div class="plot" {@attach measureWidth((w) => (measured = w))}>
  <PeriodBrush {zoom} axis={zoomAxis} {top} bottom={base} bind:dragging>
    <svg {width} {height} role="group" aria-label={label} class:zoomable={zoom !== undefined}>
      <AxisY ticks={yTicks} x0={LEFT} x1={x.right} {unit} unitY={12} />
      <g aria-hidden="true">
        {#each shapes as s, k (k)}
          {@const fill = (model.layers[k] as AreaModel['layers'][number]).fill}
          <path class="layer" d={s.fill} style:fill />
          <path class="edge" d={s.edge} style:stroke={fill} />
        {/each}
        {#if selectedIndex >= 0}
          <rect class="selected-rule" x={x.start(selectedIndex)} y={base - 3} width={x.step} height={3} />
          {#if selectedLayer >= 0}
            {@const c = cell(selectedIndex, selectedLayer)}
            <rect class="selected" x={c.x + 1} y={c.y + 1} width={Math.max(0, x.step - 2)} height={Math.max(2, c.height - 2)} />
          {/if}
        {/if}
        {#if active !== null && !dragging}
          {@const c = cell(active.i, active.k)}
          <rect class="cursor" x={c.x} y={c.y} width={x.step} height={Math.max(2, c.height)} />
        {/if}
      </g>
      <AxisX ticks={xTicks} y={base} x0={LEFT} x1={x.right} />
      <g>
        {#each model.buckets as start, i (start)}
          {#each model.layers as layer, k (layer.key)}
            {@const c = cell(i, k)}
            <rect
              class="hit"
              class:zero={c.height <= 0}
              x={c.x}
              y={c.y}
              width={x.step}
              height={Math.max(0, c.height)}
              role="button"
              tabindex={i === tabStop.i && k === tabStop.k ? 0 : -1}
              aria-pressed={i === selectedIndex && k === selectedLayer}
              aria-label={name(i, k)}
              onpointerenter={() => (active = { i, k })}
              onpointerleave={() => (active = null)}
              onfocus={() => (active = focused = { i, k })}
              onblur={() => (active = null)}
              onclick={() => choose(i, k)}
              onkeydown={(e) => onkeydown(e, i, k)}
            />
          {/each}
        {/each}
      </g>
    </svg>
  </PeriodBrush>
  {#if active !== null && !dragging}
    <Tooltip
      title={bucketName(model.buckets[active.i] as number, model.step)}
      rows={areaReadout(model, active.i, active.k)}
      x={x.centre(active.i)}
      y={top}
      frameWidth={width}
    />
  {/if}
</div>

<style>
  .plot {
    position: relative;
  }

  svg {
    display: block;
    overflow: visible;
  }

  .layer {
    fill-opacity: 0.6;
  }

  .edge {
    fill: none;
    stroke-width: 2;
    stroke-linejoin: round;
  }

  .selected {
    fill: none;
    stroke: var(--text);
    stroke-width: 2;
  }

  .selected-rule {
    fill: var(--accent);
  }

  .cursor {
    fill: var(--text);
    fill-opacity: 0.08;
  }

  .hit {
    fill: transparent;
    cursor: pointer;
  }

  .zoomable .hit {
    cursor: crosshair;
  }

  .zero {
    pointer-events: none;
  }

  .hit:focus {
    outline: none;
  }

  .hit:focus-visible {
    stroke: var(--focus);
    stroke-width: 2;
  }
</style>
