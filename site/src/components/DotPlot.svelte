<!--
  Each PR opened in the period as a dot: opened across, days to merging or
  closing up on a log scale, an open PR hollow at its age. The dots are
  drawn on a canvas so that tens of thousands stay responsive; the axes
  under it and the rings over it are SVG. The pointer finds the nearest dot
  through a grid, and a click chooses that PR. A canvas is invisible to
  assistive technology and to the keyboard, so the figure carries a text
  alternative and a table of counts, and the PR table is the keyboard's way
  to any PR. Dragging across the plot sets the period (`PeriodBrush`).
-->
<script lang="ts">
  import { COLOURS } from '../lib/colours';
  import {
    DOT_KIND,
    describeDots,
    dotLayout,
    dotReadout,
    dots,
    dotsTable,
    indexDots,
    nearestDot,
    project,
  } from '../lib/dots';
  import { DISCLOSED, NOT_DISCLOSED, periodRange } from '../lib/filters';
  import { getPage, sectionsBusy, sectionsStale } from '../lib/page';
  import { openedIn } from '../lib/select';
  import { stepFor } from '../lib/stats/buckets';
  import { linearAxis, periodZoom } from '../lib/zoom';
  import AxisX from './charts/AxisX.svelte';
  import AxisY from './charts/AxisY.svelte';
  import ChartFrame from './charts/ChartFrame.svelte';
  import PeriodBrush from './charts/PeriodBrush.svelte';
  import Tooltip from './charts/Tooltip.svelte';
  import { measureWidth } from './charts/measure';
  import SectionHead from './SectionHead.svelte';

  const { selection, data, view } = getPage();
  const zoom = periodZoom(getPage());

  const dataset = $derived($view.dataset);
  const filters = $derived($view.filters);
  const period = $derived(periodRange(filters));
  const rows = $derived($view.rows);
  const opened = $derived(openedIn(dataset, rows, period));
  const empty = $derived(rows.length === 0);
  const d = $derived(dots(dataset, opened));

  let measured = $state(0);
  const width = $derived(measured > 0 ? measured : 640);
  const height = $derived(width < 560 ? 300 : 360);
  const layout = $derived(dotLayout(period, d.longest, width, height));
  const points = $derived(project(d, layout));
  const index = $derived(indexDots(points.xs, points.ys, width, height));
  const zoomAxis = $derived(linearAxis(layout.left, layout.right, period, stepFor(period)));
  let dragging = $state(false);

  const RADIUS = 3;
  /** Half a mark's box: its radius and room for its stroke. */
  const HALF = RADIUS + 2;
  const HIT = 12;

  let hover = $state(-1);
  const chosen = $derived.by(() => {
    const pr = $selection.pr;
    if (pr === null) return -1;
    return d.rows.findIndex((r) => dataset.prs.number[r] === pr);
  });

  let canvas = $state<HTMLCanvasElement>();
  let probeNot = $state<HTMLElement>();
  let probeYes = $state<HTMLElement>();
  // Bumped when the theme changes, so the canvas is drawn again in the new colours.
  let theme = $state(0);

  $effect(() => {
    const bump = () => theme++;
    const root = document.documentElement;
    const observer = new MutationObserver(bump);
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', bump);
    return () => {
      observer.disconnect();
      media.removeEventListener('change', bump);
    };
  });

  // The device pixel ratio, followed as it changes (a zoom, or a move to
  // another screen) so the canvas is drawn again at the new resolution even
  // when its width in CSS pixels stays the same.
  let ratio = $state(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);
  $effect(() => {
    const media = window.matchMedia(`(resolution: ${ratio}dppx)`);
    const changed = () => (ratio = window.devicePixelRatio || 1);
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  });

  /** One mark drawn once, at the device's resolution, to be stamped at every dot of its kind. */
  function sprite(colour: string, kind: number, ratio: number): HTMLCanvasElement | null {
    const c = document.createElement('canvas');
    c.width = c.height = Math.ceil(2 * HALF * ratio);
    const g = c.getContext('2d');
    if (!g) return null;
    g.scale(ratio, ratio);
    g.beginPath();
    if (kind === DOT_KIND.closed) {
      g.moveTo(HALF - RADIUS, HALF - RADIUS);
      g.lineTo(HALF + RADIUS, HALF + RADIUS);
      g.moveTo(HALF - RADIUS, HALF + RADIUS);
      g.lineTo(HALF + RADIUS, HALF - RADIUS);
    } else {
      g.arc(HALF, HALF, RADIUS, 0, 2 * Math.PI);
    }
    if (kind === DOT_KIND.merged) {
      g.globalAlpha = 0.75;
      g.fillStyle = colour;
      g.fill();
    } else {
      g.globalAlpha = 0.9;
      g.strokeStyle = colour;
      g.lineWidth = kind === DOT_KIND.closed ? 1.5 : 1.25;
      g.stroke();
    }
    return c;
  }

  $effect(() => {
    void theme;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !probeNot || !probeYes) return;
    // A canvas cannot read a custom property, so the colours are read off elements wearing them.
    const colours = [getComputedStyle(probeNot).color, getComputedStyle(probeYes).color];
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const { xs, ys } = points;
    const n = d.rows.length;
    const size = 2 * HALF;
    // Stamping a drawn mark is far quicker than tracing tens of thousands of
    // arcs. The disclosed are stamped last, over the rest.
    for (const group of [0, 1]) {
      const marks = [DOT_KIND.merged, DOT_KIND.closed, DOT_KIND.open].map((k) => sprite(colours[group] as string, k, ratio));
      for (let i = 0; i < n; i++) {
        if (d.disclosed[i] !== group) continue;
        const mark = marks[d.kind[i] as number];
        if (mark) ctx.drawImage(mark, Math.round((xs[i] as number) - HALF), Math.round((ys[i] as number) - HALF), size, size);
      }
    }
  });

  function dotAt(e: MouseEvent): number {
    if (!canvas) return -1;
    const rect = canvas.getBoundingClientRect();
    return nearestDot(index, e.clientX - rect.left, e.clientY - rect.top, HIT);
  }

  function onclick(e: MouseEvent) {
    const i = dotAt(e);
    if (i < 0) return;
    const pr = dataset.prs.number[d.rows[i] as number] as number;
    selection.update((s) => ({ ...s, pr }));
  }

  const readout = $derived(!dragging && hover >= 0 && hover < d.rows.length ? dotReadout(dataset, d, hover) : null);
  const title = 'Days to merge or close, each PR opened in the period';
</script>

<section id="dots" tabindex="-1" aria-labelledby="dots-heading" class:stale={sectionsStale($view, $data)} aria-busy={sectionsBusy($view, $data) ? 'true' : undefined}>
  <SectionHead name="each-pr">
    <h2 id="dots-heading">Each PR</h2>
  </SectionHead>

  <ChartFrame
    {title}
    note="Hover over a dot to read it, and click it to choose that PR. The PR table below lists these PRs, and those opened before the period that were still open in it, and is the way to choose one from the keyboard."
    summary={describeDots(d)}
    {empty}
    nothing={opened.length === 0 ? 'no PR was opened in this period' : null}
    table={dotsTable(d)}
  >
    <ul class="legend" aria-label="Legend">
      <li><svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4" style:fill={COLOURS.notDisclosed} /></svg>{NOT_DISCLOSED}</li>
      <li><svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4" style:fill={COLOURS.disclosed} /></svg>{DISCLOSED}</li>
      <li><svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="3.5" class="ink" /></svg>merged</li>
      <li>
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2.5L9.5 9.5M2.5 9.5L9.5 2.5" class="ink-stroke" /></svg>closed unmerged
      </li>
      <li><svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="3.5" class="ink-stroke" /></svg>still open, at its age</li>
    </ul>
    <span class="probe" bind:this={probeNot} style:color={COLOURS.notDisclosed}></span>
    <span class="probe" bind:this={probeYes} style:color={COLOURS.disclosed}></span>

    <div class="plot" style:height="{height}px" {@attach measureWidth((w) => (measured = w))}>
      <PeriodBrush {zoom} axis={zoomAxis} top={layout.top} bottom={layout.bottom} bind:dragging>
        <svg class="layer" {width} {height} aria-hidden="true">
          <AxisY ticks={layout.yTicks} x0={layout.left} x1={layout.right} unit="days to merge or close, log scale" unitY={12} />
          <AxisX ticks={layout.xTicks} y={layout.bottom} x0={layout.left} x1={layout.right} />
        </svg>
        <canvas
          bind:this={canvas}
          class="layer"
          class:pointing={hover >= 0}
          style:width="{width}px"
          style:height="{height}px"
          aria-hidden="true"
          onmousemove={(e) => (hover = dotAt(e))}
          onmouseleave={() => (hover = -1)}
          {onclick}
        ></canvas>
        <svg class="layer overlay" {width} {height} aria-hidden="true">
          {#if chosen >= 0}
            <circle class="selected-ring" cx={points.xs[chosen]} cy={points.ys[chosen]} r="7" />
          {/if}
          {#if hover >= 0 && !dragging}
            <circle class="hover-ring" cx={points.xs[hover]} cy={points.ys[hover]} r="6" />
          {/if}
        </svg>
        {#if readout}
          <Tooltip
            title={readout.title}
            rows={readout.rows}
            x={points.xs[hover] as number}
            y={Math.max(0, (points.ys[hover] as number) - 40)}
            frameWidth={width}
          />
        {/if}
      </PeriodBrush>
    </div>
  </ChartFrame>
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

  /* While a wider period loads, the plot keeps its last dots, dimmed. */
  .stale {
    opacity: 0.6;
  }

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

  .legend li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .legend svg {
    width: 12px;
    height: 12px;
    flex: none;
  }

  .ink {
    fill: var(--text-muted);
  }

  .ink-stroke {
    fill: none;
    stroke: var(--text-muted);
    stroke-width: 1.5;
  }

  .probe {
    display: none;
  }

  .plot {
    position: relative;
  }

  .layer {
    position: absolute;
    inset: 0 auto auto 0;
    display: block;
    overflow: visible;
  }

  canvas {
    cursor: crosshair;
  }

  canvas.pointing {
    cursor: pointer;
  }

  .overlay {
    pointer-events: none;
  }

  .selected-ring {
    fill: none;
    stroke: var(--accent);
    stroke-width: 2.5;
  }

  .hover-ring {
    fill: none;
    stroke: var(--text);
    stroke-width: 1.5;
  }

  @media (width < 720px) {
    section {
      padding: var(--space-4);
    }
  }
</style>
