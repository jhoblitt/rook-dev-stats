<!--
  One PR's timeline: its legend, the line with every mark, each mark a link
  to its page on GitHub, the three spans beneath, the commits, and the events
  as a table, each with who made it where the data says. Marks are reached by keyboard as one stop: the arrow keys move
  along them in time order, Enter opens one. The line scrolls sideways when
  its marks need more room than the page has.
-->
<script lang="ts">
  import { TIMELINE_COLOURS as C } from '../../lib/colours';
  import {
    LAYOUT,
    ROWS,
    type PrTimeline,
    describeTimeline,
    markName,
    markWhat,
    reopenedText,
    timelineLayout,
    timelineLegend,
    whoText,
  } from '../../lib/timeline';
  import { formatDayMonth, formatMoment } from '../../lib/timeline-axis';
  import { focusSibling, measureWidth } from '../charts/measure';
  import Person from '../Person.svelte';
  import Glyph from './Glyph.svelte';

  interface Props {
    timeline: PrTimeline;
  }

  let { timeline: tl }: Props = $props();
  const uid = $props.id();
  const L = LAYOUT;
  // The width of the column naming the rows, beside the line.
  const NAMES = 88;

  // Before the first measurement, and in jsdom, a desktop width.
  let measured = $state(0);
  const layout = $derived(timelineLayout(tl, measured > 0 ? measured : 960));
  const legend = $derived(timelineLegend(tl));
  const legendRows = $derived(
    ROWS.map((r) => ({ ...r, items: legend.filter((l) => l.row === r.id) })).filter((r) => r.items.length > 0),
  );

  let active = $state<number | null>(null);
  let focused = $state<number | null>(null);
  const tabStop = $derived(Math.min(layout.marks.length - 1, focused ?? 0));

  function onkeydown(e: KeyboardEvent, i: number) {
    const n = layout.marks.length;
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: n - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const k = Math.min(n - 1, Math.max(0, next));
    focused = k;
    focusSibling(e.currentTarget, k);
  }

  let scroller = $state<HTMLElement | null>(null);
  let scrollLeft = $state(0);
  // Bring a mark reached by keyboard into view in a line wider than the page.
  function reveal(i: number) {
    const m = layout.marks[i];
    if (!m || !scroller) return;
    const view = scroller.clientWidth;
    if (m.x < scroller.scrollLeft + 24 || m.x > scroller.scrollLeft + view - 24) scroller.scrollLeft = m.x - view / 2;
  }

  let tipWidth = $state(0);
  const tip = $derived.by(() => {
    if (active === null) return null;
    const m = layout.marks[active];
    if (!m) return null;
    const x = m.x - scrollLeft;
    const view = measured > 0 ? measured : layout.width;
    const left = x + 14 + tipWidth <= view ? x + 14 : Math.max(0, x - 14 - tipWidth);
    return { m, left, top: m.y + 10 };
  });

  const commitsShown = 12;
  let allCommits = $state(false);
  const commits = $derived(allCommits ? tl.commits : tl.commits.slice(0, commitsShown));
  const washed = $derived(layout.closed.filter((c) => c.washed));
</script>

<figure class="timeline" aria-labelledby="{uid}-title" aria-describedby="{uid}-summary">
  <h3 id="{uid}-title">The life of #{tl.number}</h3>
  <p class="pr-line">
    <span class="title">{tl.title}</span>
    <span class="facts">{tl.base} · {tl.commitCount} commit{tl.commitCount === 1 ? '' : 's'} · {tl.disclosure}</span>
  </p>
  <p class="note">
    Time runs evenly along the line{#if layout.cuts.length > 0}, except where a long quiet stretch is cut out (shaded,
      with its length beneath){/if}{#if layout.stretches.length > 0}{layout.cuts.length > 0 ? ' and' : ', except'} where
      marks crowd together and are spread apart (a bar on the axis, with the real time it covers beneath){/if}.{tl.closedStretches.length > 0 ? ' Each closing that was reopened says how long the PR stayed closed.' : ''}
    Each mark links to its page on GitHub.
  </p>
  <p id="{uid}-summary" class="visually-hidden">{describeTimeline(tl)}</p>

  <div class="legend" role="group" aria-label="Legend">
    {#each legendRows as row (row.id)}
      <div class="legend-row">
        <span class="legend-name">{row.label}</span>
        <ul>
          {#each row.items as item (item.kind)}
            <li>
              <svg width="16" height="16" viewBox="-8 -8 16 16" aria-hidden="true">
                <Glyph glyph={item.glyph} colour={item.colour} r={item.small ? L.r * 0.8 : L.r} />
              </svg>{item.label}
            </li>
          {/each}
          {#if row.id === 'life'}
            {#if layout.before}
              <li><svg width="20" height="16" aria-hidden="true"><line class="before" x1="2" x2="18" y1="8" y2="8" /></svg>before the PR opened</li>
            {/if}
            {#if washed.length > 0}
              <li>
                <svg width="20" height="16" aria-hidden="true">
                  <rect x="0" y="0" width="20" height="16" class="closed-wash" style:fill={C.closed} />
                  <line class="closed-line" x1="2" x2="18" y1="8" y2="8" style:stroke={C.closed} />
                </svg>time spent closed, its length beneath
              </li>
            {/if}
            {#if layout.cuts.length > 0}
              <li>
                <svg width="20" height="16" aria-hidden="true">
                  <rect x="2" y="0" width="16" height="16" class="cut-wash" style:fill={C.axisNote} />
                  <path class="slash" d="M6,12L10,4M10,12L14,4" />
                </svg>a quiet stretch cut out
              </li>
            {/if}
            {#if layout.stretches.length > 0}
              <li><svg width="20" height="16" aria-hidden="true"><rect x="2" y="6.5" width="16" height="3" class="stretch" /></svg>crowded marks spread apart</li>
            {/if}
          {/if}
        </ul>
      </div>
    {/each}
  </div>

  {#if measured > 0 && layout.width > measured + 1}
    <p class="note">This PR’s marks need more room than the page has: scroll the line sideways.</p>
  {/if}
  <div class="frame">
    <svg class="row-names" width={NAMES} height={layout.height} aria-hidden="true">
      {#each ROWS as row (row.id)}
        <text x={NAMES - 6} y={L.rowY[row.id]} dy="0.32em">{row.label}</text>
      {/each}
    </svg>
    <div class="scroll" bind:this={scroller} onscroll={() => (scrollLeft = scroller?.scrollLeft ?? 0)} {@attach measureWidth((w) => (measured = w))}>
      <div class="canvas" style:width="{layout.width}px" style:height="{layout.height}px">
        <svg width={layout.width} height={layout.height} aria-hidden="true">
          {#each washed as c, i (i)}
            <rect class="closed-wash" x={c.x0 - 2} y="2" width={c.x1 - c.x0 + 4} height={L.rowY.life + 12} style:fill={C.closed} />
          {/each}
          {#each layout.cuts as c, i (i)}
            <rect class="cut-wash" x={c.x0 + 4} y="2" width={c.x1 - c.x0 - 8} height={L.axisY - 2} style:fill={C.axisNote} />
          {/each}
          {#each ROWS as row (row.id)}
            <line class="guide" x1="0" x2={layout.width} y1={L.rowY[row.id]} y2={L.rowY[row.id]} />
          {/each}
          {#if active !== null && layout.marks[active]}
            <line class="crosshair" x1={layout.marks[active]?.x} x2={layout.marks[active]?.x} y1="2" y2={L.axisY} />
          {/if}

          {#if layout.before}
            <line class="before" x1={layout.before.x0} x2={layout.before.x1} y1={L.rowY.life} y2={L.rowY.life} />
          {/if}
          {#each layout.open as s, i (i)}
            <line class="life" x1={s.x0} x2={s.x1} y1={L.rowY.life} y2={L.rowY.life} style:stroke={C.lifecycle} />
          {/each}
          {#each washed as c, i (i)}
            <line class="closed-line" x1={c.x0} x2={c.x1} y1={L.rowY.life} y2={L.rowY.life} style:stroke={C.closed} />
            {#if Math.abs(c.labelX - (c.x0 + c.x1) / 2) > 2}
              <!-- Moved aside from its wash: a leader keeps it with the wash. -->
              <path class="leader" d="M{(c.x0 + c.x1) / 2},{L.rowY.life + 4}L{c.labelX},{L.closedY - 10}" />
            {/if}
            <text class="closed-label" x={c.labelX} y={L.closedY}>{c.label}</text>
          {/each}

          <line class="axis" x1="0" x2={layout.width} y1={L.axisY} y2={L.axisY} />
          {#each layout.stretches as s, i (i)}
            {#if s.x1 - s.x0 >= 3}
              <rect class="stretch" x={s.x0} y={L.axisY - 1.5} width={s.x1 - s.x0} height="3" />
            {/if}
            {#if s.label}
              <path class="stretch-bracket" d="M{s.x0},{L.noteY - 18}V{L.noteY - 14}H{s.x1}V{L.noteY - 18}" />
              <text class="axis-note" x={(s.x0 + s.x1) / 2} y={L.noteY}>{s.label}</text>
            {/if}
          {/each}
          {#each layout.cuts as c, i (i)}
            {@const mid = (c.x0 + c.x1) / 2}
            {#each [L.rowY.life, L.axisY] as y (y)}
              <rect class="gap" x={mid - 6} y={y - 8} width="12" height="16" />
              <path class="slash" d="M{mid - 5},{y + 5}L{mid - 1},{y - 5}M{mid + 1},{y + 5}L{mid + 5},{y - 5}" />
            {/each}
            <text class="axis-note" x={c.labelX} y={L.noteY}>{c.label}</text>
          {/each}
          {#each layout.ticks as t (t.at)}
            <line class="tick" x1={t.at} x2={t.at} y1={L.axisY} y2={L.axisY + 4} />
            <text class="tick-label" class:dated={t.dated} x={t.at} y={L.tickY} style:text-anchor={t.anchor}>{t.label}</text>
          {/each}

          {#each layout.labels as l (l.text)}
            <text class="point-label" x={l.x} y={L.labelY}>{l.text}</text>
          {/each}
          {#each layout.marks as m, i (i)}
            <Glyph glyph={m.style.glyph} colour={m.style.colour} r={m.style.small ? L.r * 0.8 : L.r} x={m.x} y={m.y} />
          {/each}

          {#each layout.spans as s (s.span.key)}
            <path class="bracket" d="M{s.x0},{s.y - 5}V{s.y}H{s.x1}V{s.y - 5}" />
            <text class="span-label" x={s.textX} y={s.y + 15}>{s.text}</text>
          {/each}
        </svg>
        <div class="hits" role="group" aria-label="The marks on the line, in time order">
          {#each layout.marks as m, i (i)}
            {#if m.mark.href !== null}
              <a
                class="hit"
                href={m.mark.href}
                target="_blank"
                rel="noopener noreferrer"
                style:left="{m.x0}px"
                style:width="{m.x1 - m.x0}px"
                style:top="{m.y - L.hit / 2}px"
                style:height="{L.hit}px"
                tabindex={i === tabStop ? 0 : -1}
                aria-label={markName(m.mark)}
                onpointerenter={() => (active = i)}
                onpointerleave={() => (active = null)}
                onfocus={() => {
                  active = focused = i;
                  reveal(i);
                }}
                onblur={() => (active = null)}
                onkeydown={(e) => onkeydown(e, i)}
              ></a>
            {:else}
              <span
                class="hit"
                role="link"
                aria-disabled="true"
                style:left="{m.x0}px"
                style:width="{m.x1 - m.x0}px"
                style:top="{m.y - L.hit / 2}px"
                style:height="{L.hit}px"
                tabindex={i === tabStop ? 0 : -1}
                aria-label={markName(m.mark)}
                onpointerenter={() => (active = i)}
                onpointerleave={() => (active = null)}
                onfocus={() => {
                  active = focused = i;
                  reveal(i);
                }}
                onblur={() => (active = null)}
                onkeydown={(e) => onkeydown(e, i)}
              ></span>
            {/if}
          {/each}
        </div>
      </div>
    </div>
    {#if tip}
      <div class="tip" style:left="{NAMES + tip.left}px" style:top="{tip.top}px" {@attach measureWidth((w) => (tipWidth = w))} aria-hidden="true">
        <p class="tip-what">
          <svg width="16" height="16" viewBox="-8 -8 16 16"><Glyph glyph={tip.m.style.glyph} colour={tip.m.style.colour} r={L.r} /></svg>
          {markWhat(tip.m.mark)}
        </p>
        {#if tip.m.mark.who !== null}<p class="tip-who">by {whoText(tip.m.mark.who)}</p>{/if}
        <p class="tip-when">{formatMoment(tip.m.mark.at)}</p>
        {#if tip.m.mark.href === null}<p class="tip-when">address not recorded</p>{/if}
      </div>
    {/if}
  </div>

  <dl class="spans">
    {#each tl.spans as s (s.key)}
      <div><dt>{s.title}</dt><dd>{s.length}</dd></div>
    {/each}
  </dl>
  <p class="reopened"><strong>{reopenedText(tl)}</strong></p>
  {#if tl.firstCommitNote}<p class="unknown">{tl.firstCommitNote} It is left off the line.</p>{/if}
  {#if tl.lastCommitNote}<p class="unknown">{tl.lastCommitNote} It is left off the line.</p>{/if}

  <div class="commits">
    <h4>Commits ({tl.commits.length})</h4>
    {#if tl.commits.length === 0}
      <p class="unknown">No commits were recorded.</p>
    {:else}
      <ol>
        {#each commits as c (c.sha)}
          <li>
            {#if c.href}
              <a href={c.href} target="_blank" rel="noopener noreferrer" aria-label="Commit {c.short}, committed {formatMoment(c.committed)}"><code>{c.short}</code></a>
            {:else}
              <code>{c.short}</code>
            {/if}
            <span class="when">{c.committed >= 0 ? formatDayMonth(c.committed) : ''}</span>
          </li>
        {/each}
      </ol>
      {#if tl.commits.length > commitsShown}
        <button type="button" class="more" aria-expanded={allCommits} onclick={() => (allCommits = !allCommits)}>
          {allCommits ? `show the first ${commitsShown}` : `show all ${tl.commits.length} commits`}
        </button>
      {/if}
    {/if}
  </div>

  <details>
    <summary>Show the events as a table</summary>
    <div class="table-scroll">
      <table>
        <caption class="visually-hidden">The events of #{tl.number}, in time order</caption>
        <thead>
          <tr><th scope="col">When (UTC)</th><th scope="col">What</th><th scope="col">Who</th><th scope="col">On GitHub</th></tr>
        </thead>
        <tbody>
          {#each layout.marks as m, i (i)}
            <tr>
              <td>{formatMoment(m.mark.at).replace(' UTC', '')}</td>
              <th scope="row">{markWhat(m.mark)}</th>
              <td class="who">
                {#if m.mark.who?.by === 'person'}
                  <Person handle={m.mark.who.handle} bot={m.mark.who.bot} />{#if m.mark.who.author}, the author{/if}
                {:else if m.mark.who?.by === 'bot'}
                  a bot
                {/if}
              </td>
              <td>
                {#if m.mark.href !== null}
                  <a href={m.mark.href} target="_blank" rel="noopener noreferrer" aria-label="{markName(m.mark)}, on GitHub">open</a>
                {:else}
                  not recorded
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </details>
</figure>

<style>
  .timeline {
    margin: 0;
    min-width: 0;
  }

  h3 {
    margin: 0 0 var(--space-2);
    font-size: var(--text-base);
    font-weight: 600;
  }

  h4 {
    margin: 0 0 var(--space-2);
    font-size: var(--text-sm);
    font-weight: 600;
  }

  .pr-line {
    display: flex;
    flex-wrap: wrap;
    gap: 0 var(--space-3);
    margin: 0 0 var(--space-2);
  }

  .pr-line .facts {
    color: var(--text-muted);
  }

  .note,
  .unknown {
    margin: 0 0 var(--space-2);
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  .legend {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0 0 var(--space-3);
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  .legend-row {
    display: flex;
    gap: var(--space-3);
    align-items: baseline;
  }

  .legend-name {
    flex: none;
    width: 6.5rem;
    color: var(--text);
  }

  .legend ul {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-4);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .legend li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .frame {
    position: relative;
    display: flex;
  }

  .row-names {
    flex: none;
  }

  .row-names text {
    fill: var(--text-muted);
    font-size: 11px;
    text-anchor: end;
  }

  .scroll {
    flex: 1;
    min-width: 0;
    overflow-x: auto;
    overflow-y: hidden;
  }

  .canvas {
    position: relative;
  }

  .canvas svg {
    display: block;
  }

  .hits {
    position: absolute;
    inset: 0;
  }

  .hit {
    position: absolute;
    display: block;
    border-radius: var(--radius-sm);
  }

  .hit:focus {
    outline: none;
  }

  .hit:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: -2px;
  }

  a.hit:hover {
    background: var(--accent-wash);
  }

  .guide {
    stroke: var(--grid);
    stroke-width: 1;
    shape-rendering: crispEdges;
  }

  .crosshair {
    stroke: var(--text-faint);
    stroke-width: 1;
    shape-rendering: crispEdges;
  }

  .before {
    stroke: var(--text-faint);
    stroke-width: 1;
  }

  .life {
    stroke-width: 2;
    stroke-linecap: round;
  }

  .closed-line {
    stroke-width: 2;
    stroke-dasharray: 4 3;
  }

  .closed-wash {
    fill-opacity: 0.12;
  }

  .cut-wash {
    fill-opacity: 0.7;
  }

  .gap {
    fill: var(--surface);
  }

  .slash {
    fill: none;
    stroke: var(--text-muted);
    stroke-width: 1.5;
  }

  .axis {
    stroke: var(--baseline);
    stroke-width: 1;
    shape-rendering: crispEdges;
  }

  .closed-label {
    fill: var(--text-muted);
    font-size: 11px;
    text-anchor: middle;
  }

  .leader,
  .stretch-bracket {
    fill: none;
    stroke: var(--text-faint);
    stroke-width: 1;
  }

  .stretch {
    fill: var(--text-faint);
    fill-opacity: 0.7;
  }

  .tick {
    stroke: var(--baseline);
    stroke-width: 1;
  }

  .tick-label,
  .axis-note,
  .span-label,
  .point-label {
    font-size: 12px;
    text-anchor: middle;
  }

  .tick-label {
    fill: var(--text-faint);
    font-variant-numeric: tabular-nums;
  }

  .tick-label.dated {
    fill: var(--text-muted);
  }

  .axis-note {
    fill: var(--text-muted);
    font-style: italic;
  }

  .point-label {
    fill: var(--text);
  }

  .bracket {
    fill: none;
    stroke: var(--text-faint);
    stroke-width: 1;
  }

  .span-label {
    fill: var(--text-muted);
  }

  .tip {
    position: absolute;
    z-index: 2;
    width: max-content;
    max-width: min(22rem, 90%);
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

  .tip p {
    margin: 0;
  }

  .tip-what {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-weight: 600;
  }

  .tip-when {
    color: var(--text-muted);
  }

  .spans {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-6);
    margin: var(--space-3) 0 var(--space-2);
  }

  @media (width < 560px) {
    .legend-row {
      flex-direction: column;
      gap: 0;
    }
  }

  .spans dt {
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  .spans dd {
    margin: 0;
    font-weight: 600;
  }

  .reopened {
    margin: 0 0 var(--space-3);
  }

  .reopened strong {
    font-weight: 600;
  }

  .commits {
    margin: var(--space-3) 0;
  }

  .commits ol {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-4);
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: var(--text-sm);
  }

  .commits .when {
    color: var(--text-muted);
  }

  .more {
    margin-top: var(--space-2);
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--page);
    color: var(--accent);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }

  details {
    margin-top: var(--space-2);
    font-size: var(--text-sm);
  }

  summary {
    cursor: pointer;
    color: var(--accent);
  }

  .table-scroll {
    overflow-x: auto;
    max-height: 24rem;
    margin-top: var(--space-2);
  }

  table {
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
  }

  th,
  td {
    padding: var(--space-1) var(--space-3);
    border-bottom: 1px solid var(--grid);
    text-align: start;
    white-space: nowrap;
  }

  th[scope='row'] {
    font-weight: 400;
  }

  thead th {
    position: sticky;
    top: 0;
    background: var(--surface);
    color: var(--text-muted);
    font-weight: 600;
  }
</style>
