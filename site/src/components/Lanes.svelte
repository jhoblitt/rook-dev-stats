<!--
  The lanes: up to 200 PRs of the selection, one per row, each its timeline's
  line, against the calendar, cut to the stretch of the period they take up,
  or the time since it opened, whole. Drawn on a canvas, which neither a
  screen reader nor a keyboard can enter, so a text alternative says what it
  shows and every lane is also a link in the list under it, described by what
  is drawn of it. Hovering a lane names its PR; choosing one opens its
  timeline.
-->
<script lang="ts">
  import { TIMELINE_COLOURS as C } from '../lib/colours';
  import { periodRange } from '../lib/filters';
  import { formatCount } from '../lib/format';
  import {
    type Lane,
    type LaneMode,
    type LaneView,
    byOpening,
    calendarSpan,
    describeLane,
    describeLanes,
    laneAt,
    laneModel,
    lanePitch,
    laneScale,
    laneView,
    lanesLine,
    spanNote,
  } from '../lib/lanes';
  import { getPage, sectionsBusy, sectionsStale } from '../lib/page';
  import { PLOT_LEFT as LEFT, PLOT_RIGHT as RIGHT } from '../lib/plot';
  import { hashFromState } from '../lib/state';
  import { formatDate } from '../lib/timeline-axis';
  import ChartFrame from './charts/ChartFrame.svelte';
  import { measureWidth } from './charts/measure';
  import SectionHead from './SectionHead.svelte';

  interface Props {
    /**
     * The dataset rows to draw, in the order to draw them; the first 200 are
     * shown. By default the selection, newest opened first.
     */
    order?: ArrayLike<number> | undefined;
    /** How `order` is ordered, in words: "newest opened first". */
    orderName?: string;
    /** Whether `order` is newest opened first. */
    newest?: boolean;
    /** Which PRs `order` holds, in words: "opened in the week of 2026-05-18". */
    rowsName?: string;
  }

  let {
    order,
    orderName = 'newest opened first',
    newest = true,
    rowsName = 'open at some point in the period',
  }: Props = $props();
  const { selection, view, meta, data } = getPage();

  const dataset = $derived($view.dataset);
  const filters = $derived($view.filters);
  const period = $derived(periodRange(filters));
  const selected = $derived($view.rows);
  const rows = $derived(order ?? byOpening(dataset, selected));
  const model = $derived(laneModel(dataset, rows));
  const lanes = $derived(model.lanes);
  const empty = $derived(lanes.length === 0);

  let mode = $state<LaneMode>('calendar');
  let measured = $state(0);
  const TOP = 4;
  const width = $derived(measured > 0 ? measured : 960);
  // The plot's edges are those of every chart over the period.
  const plotWidth = $derived(Math.max(100, width - LEFT - RIGHT));
  const pitch = $derived(lanePitch(lanes.length));
  const height = $derived(TOP + lanes.length * pitch + 4);
  // The calendar never goes outside the period, and within it shows only the stretch the lanes take up.
  const span = $derived(calendarSpan(lanes, period, plotWidth));
  const scale = $derived(laneScale(mode, lanes, plotWidth, span));
  const views = $derived(lanes.map((l) => laneView(mode, l, span)));
  const selectedLane = $derived(lanes.findIndex((l) => l.number === $selection.pr));

  let canvas = $state<HTMLCanvasElement | null>(null);
  // Bumped when the theme or the device pixel ratio changes, so the canvas
  // redraws in the new colours or at the new resolution.
  let redraw = $state(0);
  $effect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => redraw++);
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => redraw++;
    media.addEventListener('change', onChange);
    return () => {
      observer.disconnect();
      media.removeEventListener('change', onChange);
    };
  });
  $effect(() => {
    void redraw;
    // A query for the current ratio stops matching when it changes, as when
    // the window moves to another screen or the page is zoomed.
    const media = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    const onChange = () => redraw++;
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  });

  /** The canvas's colours, custom properties resolved in the current theme, through a probe removed afterwards. */
  function resolved(host: HTMLElement, colours: readonly string[]): Map<string, string> {
    const probe = document.createElement('span');
    host.appendChild(probe);
    const out = new Map<string, string>();
    for (const c of colours) {
      probe.style.color = c;
      out.set(c, getComputedStyle(probe).color);
    }
    probe.remove();
    return out;
  }

  function draw(ctx: CanvasRenderingContext2D, host: HTMLElement) {
    const palette = resolved(host, ['var(--grid)', ...Object.values(C)]);
    const colour = (c: string) => palette.get(c) ?? c;
    const at = (lane: Lane, t: number) => {
      const x = scale.x(lane, t);
      return x === null ? null : LEFT + x;
    };
    ctx.clearRect(0, 0, width, height);
    ctx.lineWidth = 1;
    ctx.strokeStyle = colour('var(--grid)');
    for (const t of scale.ticks) {
      ctx.beginPath();
      ctx.moveTo(Math.round(LEFT + t.at) + 0.5, 0);
      ctx.lineTo(Math.round(LEFT + t.at) + 0.5, height);
      ctx.stroke();
    }
    // On the calendar nothing is drawn past its edges, not even a mark inside
    // them whose width would reach over one.
    ctx.save();
    if (mode === 'calendar') {
      ctx.beginPath();
      ctx.rect(LEFT, 0, plotWidth, height);
      ctx.clip();
    }
    const line = (x0: number | null, x1: number | null, y: number, w: number, c: string, dash: number[] = []) => {
      if (x0 === null || x1 === null) return;
      ctx.setLineDash(dash);
      ctx.lineWidth = w;
      ctx.strokeStyle = c;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(Math.max(x1, x0 + 1), y);
      ctx.stroke();
      ctx.setLineDash([]);
    };
    const thick = pitch >= 9 ? 2 : 1.5;
    lanes.forEach((lane, i) => {
      const view = views[i];
      if (view === undefined) return;
      const y = TOP + i * pitch + pitch / 2;
      const half = pitch / 2 - 0.5;
      const r = Math.max(1.5, Math.min(3.5, half));
      if (view.beforeOpening !== null) line(at(lane, view.beforeOpening.from), at(lane, view.beforeOpening.to), y, 1, colour(C.quiet));
      for (const s of view.open) line(at(lane, s.from), at(lane, s.to), y, thick, colour(C.author));
      for (const s of view.closed) line(at(lane, s.from), at(lane, s.to), y, thick, colour(C.closed), [2, 2]);
      // A chevron at an edge, pointing out of the calendar, where the life goes on past what it shows.
      const edge = (x: number, out: -1 | 1) => {
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = colour(C.lifecycle);
        ctx.beginPath();
        ctx.moveTo(x - out * r, y - r);
        ctx.lineTo(x, y);
        ctx.lineTo(x - out * r, y + r);
        ctx.stroke();
      };
      if (view.before) edge(LEFT + 1.5, -1);
      if (view.after) edge(LEFT + plotWidth - 1.5, 1);
      const stroke = (t: number, h: number, w: number, c: string) => {
        const x = at(lane, t);
        if (x === null) return;
        ctx.fillStyle = c;
        ctx.fillRect(x - w / 2, y - h, w, 2 * h);
      };
      for (const t of view.activity) stroke(t, half * 0.6, 1, colour(C.quiet));
      for (const t of view.approvals) stroke(t, half, 1.5, colour(C.lifecycle));
      const x = view.ending === null ? null : at(lane, view.ending);
      if (x === null) return;
      if (lane.state === 'merged') {
        ctx.fillStyle = colour(C.merged);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 2 * Math.PI);
        ctx.fill();
      } else if (lane.state === 'closed') {
        ctx.fillStyle = colour(C.closed);
        ctx.fillRect(x - 1, y - half, 2, 2 * half);
      } else {
        ctx.fillStyle = colour(C.open);
        ctx.beginPath();
        ctx.moveTo(x - r, y - r);
        ctx.lineTo(x + r, y);
        ctx.lineTo(x - r, y + r);
        ctx.closePath();
        ctx.fill();
      }
    });
    ctx.restore();
  }

  $effect(() => {
    void redraw;
    if (!canvas || measured === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx, canvas.parentElement ?? canvas);
  });

  let hovered = $state<number | null>(null);
  let pointerX = $state(0);
  function onpointermove(e: PointerEvent) {
    hovered = laneAt(e.offsetY - TOP, pitch, lanes.length);
    pointerX = e.offsetX;
  }

  // The chosen PR's section brings the reader to itself.
  function choose(number: number) {
    selection.update((s) => ({ ...s, pr: number }));
  }

  // From the click's own place, so a tap on a touch screen, which moves no
  // pointer first, chooses its lane too.
  function onclick(e: MouseEvent) {
    const i = laneAt(e.offsetY - TOP, pitch, lanes.length);
    const lane = i === null ? undefined : lanes[i];
    if (lane) choose(lane.number);
  }

  const ENDED = { merged: 'merged', closed: 'closed unmerged', open: 'still open' } as const;
  const hrefFor = (number: number) => hashFromState({ ...$selection, pr: number }, meta);
  const summary = $derived(describeLanes(lanes, views, model.total, orderName, mode, span));
  const covers = $derived(spanNote(span, period));
  const uid = $props.id();
  let listed = $state(false);
  const note = $derived(lanesLine(lanes.length, model.total, rowsName, orderName, newest));
</script>

<section id="timelines" tabindex="-1" aria-labelledby="timelines-heading" aria-busy={sectionsBusy($view, $data) ? 'true' : undefined}>
  <SectionHead name="timelines">
    <h2 id="timelines-heading">Timelines</h2>
  </SectionHead>

  <ChartFrame
    title="Each PR’s timeline, one per row"
    {note}
    {summary}
    {empty}
  >
    <fieldset class="mode">
      <legend>Time axis</legend>
      <label><input type="radio" name="lane-mode" value="calendar" bind:group={mode} /> Calendar</label>
      <label><input type="radio" name="lane-mode" value="sinceOpening" bind:group={mode} /> Days since opening</label>
    </fieldset>
    <ul class="legend" aria-label="Legend">
      <li><svg width="20" height="12" aria-hidden="true"><line x1="1" x2="19" y1="6" y2="6" stroke-width="2" style:stroke={C.author} /></svg>open</li>
      <li>
        <svg width="20" height="12" aria-hidden="true"><line x1="1" x2="19" y1="6" y2="6" stroke-width="2" stroke-dasharray="2 2" style:stroke={C.closed} /></svg>closed, before a reopening
      </li>
      {#if mode === 'calendar'}
        <li><svg width="20" height="12" aria-hidden="true"><line x1="1" x2="19" y1="6" y2="6" style:stroke={C.quiet} /></svg>before opening, from the first commit</li>
      {/if}
      <li><svg width="12" height="12" aria-hidden="true"><rect x="5.5" y="3" width="1" height="6" style:fill={C.quiet} /></svg>a comment, review or bot command</li>
      <li><svg width="12" height="12" aria-hidden="true"><rect x="5" y="0" width="2" height="12" style:fill={C.lifecycle} /></svg>an approval</li>
      <li><svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="3.5" style:fill={C.merged} /></svg>merged</li>
      <li><svg width="12" height="12" aria-hidden="true"><rect x="5" y="1" width="2" height="10" style:fill={C.closed} /></svg>closed unmerged</li>
      <li><svg width="12" height="12" aria-hidden="true"><path d="M2.5,2.5L9.5,6L2.5,9.5Z" style:fill={C.open} /></svg>still open</li>
      {#if mode === 'calendar'}
        <li>
          <svg width="20" height="12" aria-hidden="true"
            ><line x1="3" x2="19" y1="6" y2="6" stroke-width="2" style:stroke={C.author} /><path
              d="M5.5,2.5L2,6L5.5,9.5"
              fill="none"
              stroke-width="1.5"
              style:stroke={C.lifecycle}
            /></svg
          >its life goes on earlier than shown
        </li>
        <li>
          <svg width="20" height="12" aria-hidden="true"
            ><line x1="1" x2="17" y1="6" y2="6" stroke-width="2" style:stroke={C.author} /><path
              d="M14.5,2.5L18,6L14.5,9.5"
              fill="none"
              stroke-width="1.5"
              style:stroke={C.lifecycle}
            /></svg
          >its life goes on later than shown
        </li>
      {/if}
    </ul>
    {#if mode === 'calendar' && covers !== null}
      <p class="mode-note">{covers}</p>
    {:else if mode === 'sinceOpening'}
      <p class="mode-note">
        Each row starts when its PR opened, on a log scale from an hour, and runs to its end, whatever the period; what came before the
        opening is not drawn.
      </p>
    {/if}

    <div class="plot" {@attach measureWidth((w) => (measured = w))}>
      <!-- As wide as the plot, from its left edge; a label at either edge is set inside it. -->
      <svg class="axis" style:margin-left="{LEFT}px" width={plotWidth} height="20" aria-hidden="true">
        <g class="axis-x">
          {#each scale.ticks as t (t.at)}
            <text x={t.at} y="14" text-anchor={t.anchor}>{t.label}</text>
          {/each}
        </g>
      </svg>
      <div
        class="lanes"
        style:height="{height}px"
        role="img"
        aria-label="{formatCount(lanes.length)} lanes, one per PR; each is a link in the list below."
      >
        <!-- The pointer's way in; the keyboard's is the list of links below. -->
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <canvas
          bind:this={canvas}
          style:width="{width}px"
          style:height="{height}px"
          aria-hidden="true"
          {onpointermove}
          onpointerleave={() => (hovered = null)}
          {onclick}
        ></canvas>
        {#if selectedLane !== -1}
          <div class="selected" style:top="{TOP + selectedLane * pitch}px" style:height="{pitch}px" aria-hidden="true"></div>
        {/if}
        {#if hovered !== null && lanes[hovered]}
          {@const lane = lanes[hovered] as Lane}
          <div class="hover" style:top="{TOP + hovered * pitch}px" style:height="{pitch}px" aria-hidden="true"></div>
          <div
            class="tip"
            style:top="{TOP + hovered * pitch + pitch + 4}px"
            style:left="{Math.min(Math.max(0, pointerX - 60), width - 180)}px"
            aria-hidden="true"
          >
            <strong>#{lane.number}</strong> · opened {formatDate(lane.created)} · {ENDED[lane.state]}
          </div>
        {/if}
      </div>
    </div>

    <details class="numbers" bind:open={listed}>
      <summary>The {formatCount(lanes.length)} PRs in the lanes, as links, in their order</summary>
      <ol aria-label="The PRs in the lanes, in their order">
        {#each lanes as lane, i (lane.row)}
          <li>
            <a
              href={hrefFor(lane.number)}
              aria-current={lane.number === $selection.pr ? 'true' : undefined}
              aria-describedby={listed ? `${uid}-lane-${lane.row}` : undefined}
              onclick={(e) => {
                e.preventDefault();
                choose(lane.number);
              }}>#{lane.number}</a
            >
            <!-- Written only while the list is open, the only time a reader can reach it, so a redraw does not pay for 200 of them. -->
            {#if listed}<span id="{uid}-lane-{lane.row}" class="visually-hidden">{describeLane(lane, views[i] as LaneView, mode)}</span>{/if}
          </li>
        {/each}
      </ol>
    </details>
  </ChartFrame>
</section>

<style>
  section {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-5);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }

  h2 {
    margin: 0;
  }

  .mode {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-4);
    margin: 0 0 var(--space-2);
    padding: 0;
    border: 0;
    font-size: var(--text-sm);
  }

  .mode legend {
    float: left;
    margin-right: var(--space-2);
    padding: 0;
    color: var(--text-muted);
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

  .mode-note {
    margin: 0 0 var(--space-2);
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  .plot {
    position: relative;
  }

  .axis {
    display: block;
  }

  .axis text {
    fill: var(--text-faint);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  .lanes {
    position: relative;
  }

  canvas {
    display: block;
    cursor: pointer;
  }

  .selected,
  .hover {
    position: absolute;
    left: 0;
    right: 0;
    pointer-events: none;
  }

  .selected {
    background: var(--accent-wash);
    box-shadow: inset 2px 0 0 var(--accent);
  }

  .hover {
    background: var(--accent-wash);
  }

  .tip {
    position: absolute;
    z-index: 2;
    width: max-content;
    padding: var(--space-1) var(--space-3);
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    box-shadow: 0 6px 20px rgb(0 0 0 / 0.18);
    font-size: var(--text-sm);
    pointer-events: none;
  }

  .numbers {
    margin-top: var(--space-3);
    font-size: var(--text-sm);
  }

  .numbers summary {
    cursor: pointer;
    color: var(--accent);
  }

  .numbers ol {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-3);
    margin: var(--space-2) 0 0;
    padding: 0;
    list-style: none;
    font-variant-numeric: tabular-nums;
  }

  .numbers a[aria-current] {
    font-weight: 700;
  }

  @media (width < 720px) {
    section {
      padding: var(--space-4);
    }
  }
</style>
