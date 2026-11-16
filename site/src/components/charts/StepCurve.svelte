<!--
  Outcome curves: by day N of a span, the share of PRs at each outcome, as
  steps, on a log time axis from one hour: spans run from minutes to years,
  and a linear axis crushes all but the longest. Anything shorter than an
  hour is drawn at the hour, so a curve may start above zero there. The plot
  is one slider over the time axis: the pointer or the arrow keys move a
  crosshair, and the tooltip and the slider's value text give every exact
  share at that time. On an axis shared with longer curves, each line stops
  at its own longest duration: past it there is nothing measured to show.
-->
<script lang="ts">
  import { scaleLinear, scaleLog } from 'd3-scale';
  import { curveStepAfter, line } from 'd3-shape';
  import { type CurveModel, curveAt, curveReadout, readoutText } from '../../lib/charts';
  import { formatDays, formatShare } from '../../lib/format';
  import { HOUR, type Tick, durationTicks, logDays, markerPath, spaceTicks } from '../../lib/plot';
  import AxisX from './AxisX.svelte';
  import AxisY from './AxisY.svelte';
  import Tooltip from './Tooltip.svelte';
  import { measureWidth } from './measure';

  interface Props {
    model: CurveModel;
    /** The chart's name for assistive technology, usually its title. */
    label: string;
    /** What the horizontal axis measures, e.g. "time since opened"; the chart adds that it is a log scale. */
    xUnit: string;
    /** A right end of the day axis shared with neighbouring curves; by default the longest duration. */
    xMax?: number | undefined;
    height?: number;
  }

  let { model, label, xUnit, xMax, height = 200 }: Props = $props();

  let measured = $state(0);
  const width = $derived(measured > 0 ? measured : 640);

  const LEFT = 44;
  const RIGHT = 12;
  const TOP = 8;
  const base = $derived(height - 40);
  const last = $derived(model.days.at(-1) ?? 0);
  const domain = $derived(logDays(Math.max(xMax ?? 0, last)));
  const min = $derived(domain[0]);
  const max = $derived(domain[1]);
  // Where the line ends: its longest duration, or the hour when all are shorter.
  const lastAt = $derived(Math.max(last, HOUR));
  const y = $derived(scaleLinear().domain([0, 1]).range([base, TOP]));
  const start = $derived(curveAt(model, HOUR));
  const end = $derived(curveAt(model, last));
  const x = $derived(scaleLog().domain([min, max]).range([LEFT, width - RIGHT]).clamp(true));

  const yTicks: Tick[] = $derived([0, 0.25, 0.5, 0.75, 1].map((t) => ({ at: y(t), label: formatShare(t) })));
  const xTicks: Tick[] = $derived(
    spaceTicks(
      durationTicks(min, max).map((t) => ({ at: x(t.days), label: t.label })),
      64,
    ),
  );

  const lines = $derived(
    model.series.map((s, k) => {
      const points: [number, number][] = [
        [HOUR, start[k] as number],
        ...model.days.flatMap((d, i): [number, number][] => (d > HOUR ? [[d, s.values[i] as number]] : [])),
      ];
      const path = line<[number, number]>()
        .x((p) => x(p[0]))
        .y((p) => y(p[1]))
        .curve(curveStepAfter);
      return { key: s.key, color: s.color, shape: s.shape, d: path(points) ?? '', endY: y(end[k] as number) };
    }),
  );

  // A key press moves a fixed share of the axis: on a log axis, a fixed factor.
  const step = $derived((max / min) ** (1 / 48));
  let day = $state(HOUR);
  let hovering = $state(false);
  let focused = $state(false);
  const showing = $derived(hovering || focused);
  const clamp = (d: number) => Math.min(max, Math.max(min, Math.round(d * 1e6) / 1e6));
  // Past the curve's own longest duration nothing was measured.
  const past = $derived(day > lastAt + 1e-9);
  const reading = $derived(
    past ? `past the longest measured, ${formatDays(last)}` : readoutText(curveReadout(model, day)),
  );
  const valueText = $derived(`after ${formatDays(day)}: ${reading}`);
  const atDay = $derived(curveAt(model, day));

  let svg: SVGSVGElement | undefined = $state();

  function onpointermove(e: PointerEvent) {
    const left = svg?.getBoundingClientRect().left ?? 0;
    day = clamp(x.invert(e.clientX - left));
    hovering = true;
  }

  function onkeydown(e: KeyboardEvent) {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        day = clamp(day * step);
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        day = clamp(day / step);
        break;
      case 'PageUp':
        day = clamp(day * step ** 8);
        break;
      case 'PageDown':
        day = clamp(day / step ** 8);
        break;
      case 'Home':
        day = min;
        break;
      case 'End':
        day = max;
        break;
      default:
        return;
    }
    e.preventDefault();
  }
</script>

<div class="plot" {@attach measureWidth((w) => (measured = w))}>
  <svg bind:this={svg} {width} {height}>
    <AxisY ticks={yTicks} x0={LEFT} x1={width - RIGHT} />
    <g aria-hidden="true">
      {#if showing}
        <line class="crosshair" x1={x(day)} x2={x(day)} y1={TOP} y2={base} />
      {/if}
      {#each lines as l (l.key)}
        <path class="line" d={l.d} style:stroke={l.color} />
        <path class="marker end-marker" d={markerPath(l.shape)} transform="translate({x(lastAt)} {l.endY})" style:fill={l.color} />
      {/each}
      {#if showing && !past}
        {#each lines as l, k (l.key)}
          <path class="marker" d={markerPath(l.shape)} transform="translate({x(day)} {y(atDay[k] as number)})" style:fill={l.color} />
        {/each}
      {/if}
    </g>
    <AxisX ticks={xTicks} y={base} x0={LEFT} x1={width - RIGHT} />
    <text class="unit" x={LEFT} y={height - 4} aria-hidden="true">{xUnit}, log scale</text>
    <rect
      class="hit"
      x={LEFT}
      y={TOP}
      width={Math.max(0, width - RIGHT - LEFT)}
      height={base - TOP}
      role="slider"
      tabindex="0"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={day}
      aria-valuetext={valueText}
      {onpointermove}
      onpointerleave={() => (hovering = false)}
      onfocus={() => (focused = true)}
      onblur={() => (focused = false)}
      {onkeydown}
    />
  </svg>
  {#if showing}
    <Tooltip
      title={past ? valueText : `after ${formatDays(day)}`}
      rows={past ? [] : curveReadout(model, day)}
      x={x(day)}
      y={TOP}
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

  .marker {
    stroke: var(--surface);
    stroke-width: 2;
  }

  .unit {
    fill: var(--text-faint);
    font-size: 12px;
  }

  .hit {
    fill: transparent;
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
