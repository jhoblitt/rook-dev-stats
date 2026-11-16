<!--
  Bars stacked per week (or month) and lines, in one panel or in several
  stacked on one time axis. Panels share one value scale when they count the
  same thing, or each keeps its own when their units differ; either way no
  line is drawn over a bar whose colour it could be taken for. Durations take
  a log scale.

  Each bucket is one hit target, as wide as its column and as tall as every
  panel: hovering or focusing it shows every series' exact value, the arrow
  keys move between buckets, and a click, Enter or Space chooses it. A bucket
  the data covers only in part has faded bars, and its line values are hollow
  markers left unconnected, so a short bucket does not read as a fall. A
  value that can no longer be reached is marked in a strip above its panel.
  Given a zoom, dragging across the plot sets the period (`PeriodBrush`).

  The chart takes its columns from `timeColumns`, as every chart over the
  period does, so a bucket sits at the same x as in the other charts.
-->
<script lang="ts">
  import { scaleLinear, scaleLog } from 'd3-scale';
  import { line } from 'd3-shape';
  import {
    type BarSeries,
    type BucketModel,
    type LineSeries,
    type Panel,
    bucketHead,
    bucketReadout,
    readoutText,
  } from '../../lib/charts';
  import { COLOURS } from '../../lib/colours';
  import {
    HOUR,
    NARROW,
    PLOT_LEFT as LEFT,
    type Tick,
    barPath,
    bucketTicks,
    durationTicks,
    logDays,
    markerPath,
    spaceTicks,
    timeColumns,
  } from '../../lib/plot';
  import { type PeriodZoom, columnAxis } from '../../lib/zoom';
  import AxisX from './AxisX.svelte';
  import AxisY from './AxisY.svelte';
  import PeriodBrush from './PeriodBrush.svelte';
  import Tooltip from './Tooltip.svelte';
  import { focusSibling, measureWidth } from './measure';

  interface Props {
    model: BucketModel;
    /** Writes one value exactly: a count, a duration. */
    format: (v: number) => string;
    /** The chart's name for assistive technology, usually its title. */
    label: string;
    /** What the value axis measures, when there is one panel. */
    unit?: string;
    /** The values are counts: the value axis ticks only whole numbers. */
    integer?: boolean;
    /** The selected bucket's first instant. */
    selected?: number | null;
    /** Called with a bucket's first instant when it is chosen. */
    onselect: (bucket: number) => void;
    height?: number;
    /** A top for the value axis shared by small multiples; by default the largest value. */
    yMax?: number;
    /** Leave the bucket axis off, for the upper panels of small multiples. */
    axis?: boolean;
    /** Panels stacked top to bottom on the one time axis; by default one with every series. */
    panels?: readonly Panel[];
    /** The panels share one value scale; false gives each its own, for panels of different units. */
    sharedScale?: boolean;
    /** The value scale: linear, or log over durations in days, from one hour. */
    scale?: 'linear' | 'logDays';
    /** Sets the period from a drag across the plot. */
    zoom?: PeriodZoom;
  }

  let {
    model,
    format,
    label,
    unit,
    integer = false,
    selected = null,
    onselect,
    height = 220,
    yMax,
    axis = true,
    panels,
    sharedScale = true,
    scale = 'linear',
    zoom,
  }: Props = $props();

  let measured = $state(0);
  const width = $derived(measured > 0 ? measured : 640);
  const TOP = 8;
  const UNIT = 16;
  const STRIP = 14;
  const GAP = 12;
  const base = $derived(height - (axis ? 24 : 4));
  const n = $derived(model.buckets.length);
  const isPartial = (i: number) => model.partial?.[i] != null;

  // A line marked undrawn is in the readout and the table only.
  const shownLines = $derived(model.lines.filter((l) => !l.undrawn));
  const specs = $derived(panels ?? [{ keys: [...model.bars.map((b) => b.key), ...shownLines.map((l) => l.key)], unit }]);

  /** The largest value a panel draws: its stacks' totals and its lines' values. */
  function largest(bars: readonly BarSeries[], lines: readonly LineSeries[]): number {
    const stacks = model.buckets.map((_, i) => bars.reduce((t, b) => t + (b.values[i] as number), 0));
    const points = lines.flatMap((l) => l.values.filter((v): v is number => v !== null));
    return Math.max(0, ...stacks, ...points);
  }

  // Each panel's place, series and value scale. The panels split what the
  // units, the "not reached" strips and the gaps leave, in equal parts.
  const layout = $derived.by(() => {
    const parts = specs.map((p) => {
      const bars = model.bars.filter((b) => p.keys.includes(b.key));
      const lines = shownLines.filter((l) => p.keys.includes(l.key));
      const strip = lines.some((l) => l.unreached?.some(Boolean));
      return {
        unit: width < NARROW && p.narrowUnit !== undefined ? p.narrowUnit : p.unit,
        minTicks: p.minTicks,
        bars,
        lines,
        strip,
        reserve: (p.unit ? UNIT : 0) + (strip ? STRIP : 0),
      };
    });
    const shared = Math.max(...parts.map((p) => largest(p.bars, p.lines)));
    const each = (base - TOP - parts.reduce((t, p) => t + p.reserve, 0) - GAP * (parts.length - 1)) / parts.length;
    let cursor = TOP;
    return parts.map((p) => {
      const top = cursor + p.reserve;
      const bottom = top + each;
      cursor = bottom + GAP;
      const max = yMax ?? (sharedScale ? shared : largest(p.bars, p.lines));
      let y: (v: number) => number;
      let ticks: Tick[];
      if (scale === 'logDays') {
        const [lo, hi] = logDays(max);
        const s = scaleLog().domain([lo, hi]).range([bottom, top]).clamp(true);
        // Anything shorter than an hour is drawn at the hour.
        y = (v) => s(Math.max(v, HOUR));
        ticks = spaceTicks(
          durationTicks(lo, hi).map((t) => ({ at: s(t.days), label: t.label })),
          14,
        );
      } else {
        // A panel asking for more ticks also ends its scale on one, so its top value can be read.
        const want = p.minTicks ?? 0;
        let count = Math.max(bottom - top < 100 ? 2 : 4, want);
        const domain = scaleLinear().domain([0, Math.max(1, max)]);
        const s = (want > 0 ? domain.nice(count) : domain.nice()).range([bottom, top]);
        const values = () => s.ticks(count).filter((t) => !integer || Number.isInteger(t));
        let shown = values();
        while (shown.length < want && count < 12) {
          count++;
          shown = values();
        }
        y = s;
        ticks = shown.map((t) => ({ at: s(t), label: t.toLocaleString('en-US', { maximumFractionDigits: 1 }) }));
      }
      return { ...p, top, bottom, y, ticks };
    });
  });
  const plotTop = $derived((layout[0]?.top ?? TOP) - (layout[0]?.strip ? STRIP : 0));

  const x = $derived(timeColumns(width, n));
  const zoomAxis = $derived(columnAxis(x, model.buckets, model.step));
  let dragging = $state(false);
  // A bar takes three quarters of its column, centred in it.
  const barWidth = $derived(Math.min(24, x.step * 0.75));
  const centre = (i: number) => x.centre(i);
  const column = (i: number) => x.start(i);

  const selectedIndex = $derived(selected === null ? -1 : model.buckets.indexOf(selected));
  const xTicks: Tick[] = $derived(
    bucketTicks(model.buckets, model.step, centre).map(({ i, label }) => ({ at: centre(i), label, strong: i === selectedIndex })),
  );

  // Each panel's stacks from the baseline up; a 2px gap of surface separates
  // a segment from the one under it, and only the top one has a rounded end.
  // Its lines join only whole buckets.
  const drawn = $derived(
    layout.map((p) => ({
      ...p,
      stacks: model.buckets.map((_, i) => {
        const left = centre(i) - barWidth / 2;
        let topmost = -1;
        p.bars.forEach((b, j) => {
          if ((b.values[i] as number) > 0) topmost = j;
        });
        const segments: { key: string; color: string; d: string }[] = [];
        let below = 0;
        p.bars.forEach((b, j) => {
          const v = b.values[i] as number;
          if (v <= 0) return;
          const bottom = p.y(below) - (segments.length > 0 ? 2 : 0);
          const upper = p.y(below + v);
          below += v;
          segments.push({
            key: b.key,
            color: b.color,
            d: barPath(left, upper, barWidth, Math.max(1, bottom - upper), j === topmost ? 4 : 0),
          });
        });
        return segments;
      }),
      paths: p.lines.map((l) => {
        const joined = (i: number) => (l.values[i] ?? null) !== null && !isPartial(i);
        const path = line<number | null>()
          .defined((_, i) => joined(i))
          .x((_, i) => centre(i))
          .y((v) => p.y(v as number));
        const all = x.step >= 12;
        const last = l.values.reduce((k: number, _, i) => (joined(i) ? i : k), -1);
        // Markers on every point when the buckets are wide enough; otherwise
        // where a point stands alone, ends its line, or is a partial bucket's.
        const markers = l.values.flatMap((v, i) => {
          if (v === null) return [];
          const alone = !joined(i - 1) && !joined(i + 1);
          return all || alone || i === last || isPartial(i) ? [{ i, cx: centre(i), cy: p.y(v), partial: isPartial(i) }] : [];
        });
        return {
          key: l.key,
          color: l.color,
          shape: l.shape,
          dashed: l.dashed === true,
          d: path([...l.values]) ?? '',
          markers,
          unreached: (l.unreached ?? []).flatMap((u, i) => (u ? [i] : [])),
        };
      }),
    })),
  );

  let active = $state<number | null>(null);
  let focused = $state<number | null>(null);
  const tabStop = $derived(Math.min(n - 1, focused ?? (selectedIndex >= 0 ? selectedIndex : 0)));

  function onkeydown(e: KeyboardEvent, i: number) {
    let next: number;
    switch (e.key) {
      case 'ArrowRight':
        next = Math.min(n - 1, i + 1);
        break;
      case 'ArrowLeft':
        next = Math.max(0, i - 1);
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = n - 1;
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        onselect(model.buckets[i] as number);
        return;
      default:
        return;
    }
    e.preventDefault();
    focused = next;
    focusSibling(e.currentTarget, next);
  }

  function name(i: number): string {
    return `${bucketHead(model, i)}: ${readoutText(bucketReadout(model, i, format))}`;
  }
</script>

<div class="plot" {@attach measureWidth((w) => (measured = w))}>
  <PeriodBrush {zoom} axis={zoomAxis} top={plotTop} bottom={base} bind:dragging>
    <svg {width} {height} role="group" aria-label={label} class:zoomable={zoom !== undefined}>
      <g aria-hidden="true">
        {#each model.buckets as _, i (i)}
          {#if model.shade?.[i]}
            <rect class="shade" x={column(i)} y={plotTop} width={x.step} height={base - plotTop} style:fill={COLOURS.notYetKnown} />
          {/if}
        {/each}
        {#if selectedIndex >= 0}
          <rect class="selected" x={column(selectedIndex)} y={plotTop} width={x.step} height={base - plotTop} />
          <rect class="selected-rule" x={column(selectedIndex)} y={base - 3} width={x.step} height={3} />
        {/if}
      </g>
      {#each layout as p, k (k)}
        <AxisY ticks={p.ticks} x0={LEFT} x1={x.right} unit={p.unit} unitY={p.top - p.reserve + 12} />
        {#if k < layout.length - 1}
          <line class="panel-base" aria-hidden="true" x1={LEFT} x2={x.right} y1={p.bottom} y2={p.bottom} />
        {/if}
      {/each}
      {#if active !== null && !dragging}
        <line class="crosshair" aria-hidden="true" x1={centre(active)} x2={centre(active)} y1={plotTop} y2={base} />
      {/if}
      {#each drawn as p, k (k)}
        <g class="plot-panel" aria-hidden="true">
          {#each p.stacks as segments, i (i)}
            {#each segments as s (s.key)}
              <path class="bar" class:partial={isPartial(i)} d={s.d} style:fill={s.color} />
            {/each}
          {/each}
          {#each p.paths as l (l.key)}
            <path class="line" class:dashed={l.dashed} d={l.d} style:stroke={l.color} />
            {#each l.markers as m (m.i)}
              <path
                class="marker"
                class:hollow={m.partial}
                d={markerPath(l.shape)}
                transform="translate({m.cx} {m.cy})"
                style:fill={m.partial ? 'var(--surface)' : l.color}
                style:stroke={m.partial ? l.color : 'var(--surface)'}
              />
            {/each}
            {#each l.unreached as i (i)}
              <path class="unreached" d={markerPath(l.shape, 40)} transform="translate({centre(i)} {p.top - 8})" style:stroke={l.color} />
            {/each}
          {/each}
        </g>
      {/each}
      {#if axis}
        <AxisX ticks={xTicks} y={base} x0={LEFT} x1={x.right} />
      {/if}
      <g>
        {#each model.buckets as start, i (start)}
          <rect
            class="hit"
            x={column(i)}
            y={plotTop}
            width={x.step}
            height={base - plotTop}
            role="button"
            tabindex={i === tabStop ? 0 : -1}
            aria-pressed={i === selectedIndex}
            aria-label={name(i)}
            onpointerenter={() => (active = i)}
            onpointerleave={() => (active = null)}
            onfocus={() => (active = focused = i)}
            onblur={() => (active = null)}
            onclick={() => onselect(start)}
            onkeydown={(e) => onkeydown(e, i)}
          />
        {/each}
      </g>
    </svg>
  </PeriodBrush>
  {#if active !== null && !dragging}
    <Tooltip
      title={bucketHead(model, active)}
      rows={bucketReadout(model, active, format)}
      x={centre(active)}
      y={plotTop}
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

  .shade {
    opacity: 0.6;
  }

  .panel-base {
    stroke: var(--baseline);
    stroke-width: 1;
    shape-rendering: crispEdges;
  }

  .selected {
    fill: var(--accent-wash);
  }

  .selected-rule {
    fill: var(--accent);
  }

  .crosshair {
    stroke: var(--text-faint);
    stroke-width: 1;
    shape-rendering: crispEdges;
  }

  .line {
    fill: none;
    stroke-width: 2;
    stroke-linejoin: round;
    stroke-linecap: round;
  }

  .dashed {
    stroke-dasharray: 5 4;
  }

  .marker {
    stroke-width: 2;
  }

  .hollow {
    stroke-width: 1.5;
  }

  /* A partial bucket's bars are faded: fewer days, not fewer PRs a day. */
  .partial {
    fill-opacity: 0.45;
  }

  .unreached {
    fill: var(--surface);
    stroke-width: 1.5;
  }

  .hit {
    fill: transparent;
    cursor: pointer;
  }

  .zoomable .hit {
    cursor: crosshair;
  }

  .hit:focus {
    outline: none;
  }

  .hit:focus-visible {
    stroke: var(--focus);
    stroke-width: 2;
  }
</style>
