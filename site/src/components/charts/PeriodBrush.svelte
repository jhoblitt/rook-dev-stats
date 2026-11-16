<!--
  Wraps a plot drawn over the period so that pressing inside it and dragging
  sideways sets the period to the buckets dragged over, as `dragRange` reads
  them. While dragging, a band runs from the press to the pointer, with the
  dates the period would take; Escape cancels the drag. A press that moves
  less than `DRAG_THRESHOLD` is left to the plot as a click, and the click
  that follows a drag is kept from it. A double-click widens the period; its
  second click is kept from the plot, so the plot sees one click. A vertical
  touch drag still scrolls the page. Without a zoom it only renders the plot.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { dayStart } from '../../lib/filters';
  import type { AppState } from '../../lib/state';
  import { formatDate } from '../../lib/timeline-axis';
  import { DRAG_THRESHOLD, type PeriodZoom, type ZoomAxis, dragRange } from '../../lib/zoom';

  interface Props {
    zoom?: PeriodZoom | undefined;
    axis: ZoomAxis;
    /** The plot area's top and bottom, in the plot's pixels: where a press starts a drag, and the band's height. */
    top: number;
    bottom: number;
    /** A drag is under way, for the plot to hide what follows the pointer. */
    dragging?: boolean;
    children: Snippet;
  }

  let { zoom, axis, top, bottom, dragging = $bindable(false), children }: Props = $props();

  let el = $state<HTMLDivElement>();
  let press: { x: number; id: number } | null = null;
  let drag = $state<{ a: number; b: number } | null>(null);
  // The click a finished or cancelled drag ends in is not the plot's.
  let swallow = false;
  // The state before a double-click's first click, which the double-click goes back to.
  let before: AppState | null = null;

  $effect(() => {
    dragging = drag !== null;
  });

  const xOf = (e: MouseEvent) => e.clientX - (el?.getBoundingClientRect().left ?? 0);
  const yOf = (e: MouseEvent) => e.clientY - (el?.getBoundingClientRect().top ?? 0);
  const edge = (x: number) => Math.min(axis.right, Math.max(axis.left, x));

  function end() {
    if (press !== null && el?.hasPointerCapture?.(press.id)) el.releasePointerCapture(press.id);
    press = null;
    drag = null;
  }

  function onpointerdown(e: PointerEvent) {
    swallow = false;
    if (!zoom || !e.isPrimary || e.button !== 0) return;
    const x = xOf(e);
    const y = yOf(e);
    if (x < axis.left || x > axis.right || y < top || y > bottom) return;
    press = { x, id: e.pointerId };
  }

  function onpointermove(e: PointerEvent) {
    if (press === null || e.pointerId !== press.id) return;
    const x = xOf(e);
    if (drag === null) {
      if (Math.abs(x - press.x) < DRAG_THRESHOLD) return;
      // Held from here, so a drag that leaves the plot still ends in it.
      el?.setPointerCapture?.(e.pointerId);
    }
    drag = { a: press.x, b: x };
  }

  function onpointerup(e: PointerEvent) {
    if (press === null || e.pointerId !== press.id) return;
    const a = press.x;
    const dragged = drag !== null;
    end();
    if (!dragged || !zoom) return;
    swallow = true;
    const range = dragRange(axis, a, xOf(e), zoom.days);
    if (range) zoom.to(range);
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || drag === null) return;
    e.preventDefault();
    swallow = true;
    end();
  }

  function onclickcapture(e: MouseEvent) {
    if (!zoom) return;
    if (swallow) {
      swallow = false;
      before = null;
      e.stopPropagation();
      return;
    }
    if (e.detail <= 1) before = zoom.current();
    else e.stopPropagation();
  }

  function ondblclick(e: MouseEvent) {
    if (!zoom) return;
    const x = xOf(e);
    if (x < axis.left || x > axis.right) return;
    e.preventDefault();
    zoom.out(before);
    before = null;
  }

  const band = $derived.by(() => {
    if (drag === null || !zoom) return null;
    const lo = edge(Math.min(drag.a, drag.b));
    const hi = edge(Math.max(drag.a, drag.b));
    const range = dragRange(axis, drag.a, drag.b, zoom.days);
    const day = (d: string) => formatDate(dayStart(d) as number);
    // The dates sit over the band's middle, kept inside the plot.
    const room = Math.min(90, (axis.right - axis.left) / 2);
    return {
      lo,
      hi,
      dates: range && `${day(range.from)} – ${day(range.to)}`,
      centre: Math.min(axis.right - room, Math.max(axis.left + room, (lo + hi) / 2)),
    };
  });
</script>

<svelte:window {onkeydown} />

<!-- The pointer's way to set the period; the keyboard's is the filter bar's From and To. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="brush"
  class:zoomable={zoom !== undefined}
  class:dragging={drag !== null}
  bind:this={el}
  {onpointerdown}
  {onpointermove}
  {onpointerup}
  onpointercancel={end}
  {onclickcapture}
  {ondblclick}
>
  {@render children()}
  {#if band}
    <div class="band" aria-hidden="true" style:left="{band.lo}px" style:width="{band.hi - band.lo}px" style:top="{top}px" style:height="{bottom - top}px"></div>
    {#if band.dates}
      <div class="band-dates" aria-hidden="true" style:left="{band.centre}px" style:top="{top + 4}px">{band.dates}</div>
    {/if}
  {/if}
</div>

<style>
  .brush {
    position: relative;
    height: 100%;
  }

  /* A sideways touch drag is the plot's; a vertical one scrolls the page. */
  .zoomable {
    touch-action: pan-y;
    user-select: none;
    -webkit-user-select: none;
  }

  .dragging,
  .dragging :global(*) {
    cursor: col-resize !important;
  }

  .band {
    position: absolute;
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    border-inline: 1px solid var(--accent);
    pointer-events: none;
  }

  .band-dates {
    position: absolute;
    transform: translateX(-50%);
    padding: 1px var(--space-2);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-size: var(--text-sm);
    white-space: nowrap;
    pointer-events: none;
  }
</style>
