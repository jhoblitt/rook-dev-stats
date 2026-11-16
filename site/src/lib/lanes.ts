// The lanes: the line of one PR's timeline drawn for many PRs at once, one
// per row, against the calendar or against the time since each opened.

import { scaleLog } from 'd3-scale';
import { type Dataset, PR_STATE } from './data';
import { DAY } from './filters';
import { formatCount } from './format';
import { HOUR, TICK_SPACING, type Tick, durationTicks, logDays, spaceTicks } from './plot';
import type { Period } from './stats/buckets';
import { eventRange } from './timeline';
import { axisTicks, formatDate, formatMoment, timeAxis } from './timeline-axis';

/** The most lanes drawn: a canvas draws more, but a reader cannot tell more rows apart. */
export const LANE_CAP = 200;

export type LaneMode = 'calendar' | 'sinceOpening';

export interface Lane {
  /** The dataset row. */
  row: number;
  number: number;
  created: number;
  /** The first commit when it came before the opening; else null. */
  firstCommit: number | null;
  /** When it was merged or closed, or the last fetch while it is open. */
  end: number;
  state: 'merged' | 'closed' | 'open';
  /** Each stretch from a close to the reopening that ended it. */
  closed: { from: number; to: number }[];
  /** When someone commented, reviewed without approving, or ran a bot command. */
  activity: number[];
  /** When a person other than the author approved. */
  approvals: number[];
  reopened: number;
}

const LIFECYCLE = ['ready', 'draft', 'force_push', 'closed', 'reopened', 'merged'];
const STATES = { [PR_STATE.open]: 'open', [PR_STATE.merged]: 'merged', [PR_STATE.closed]: 'closed' } as const;

/** Rows by opening, newest first; at one moment, the higher number first. */
export function byOpening(data: Dataset, rows: ArrayLike<number>): number[] {
  const created = data.prs.created;
  const number = data.prs.number;
  return Array.from(rows).sort(
    (a, b) => (created[b] as number) - (created[a] as number) || (number[b] as number) - (number[a] as number),
  );
}

function lane(data: Dataset, row: number): Lane {
  const p = data.prs;
  const meta = data.meta;
  const created = p.created[row] as number;
  const first = p.first_commit[row] as number;
  const state = STATES[p.state[row] as 0 | 1 | 2];
  const closed: Lane['closed'] = [];
  const activity: number[] = [];
  const approvals: number[] = [];
  let closedAt: number | null = null;
  const [start, end] = eventRange(data, row);
  for (let e = start; e < end; e++) {
    const kind = meta.event_kinds[data.events.kind[e] as number] ?? '';
    const t = data.events.at[e] as number;
    if (kind === 'closed') closedAt ??= t;
    else if (kind === 'reopened') {
      closed.push({ from: closedAt ?? t, to: t });
      closedAt = null;
    } else if (kind === 'review_approved') approvals.push(t);
    else if (!LIFECYCLE.includes(kind)) activity.push(t);
  }
  return {
    row,
    number: p.number[row] as number,
    created,
    firstCommit: first >= 0 && first < created ? first : null,
    end: state === 'open' ? meta.fetched_through : (p.closed[row] as number),
    state,
    closed,
    activity,
    approvals,
    reopened: p.reopened[row] as number,
  };
}

/** The lanes of the first `cap` rows of `order`, and how many rows there were. */
export function laneModel(data: Dataset, order: ArrayLike<number>, cap = LANE_CAP): { lanes: Lane[]; total: number } {
  const rows = Array.from(order).slice(0, cap);
  return { lanes: rows.map((r) => lane(data, r)), total: order.length };
}

/** How far apart the lanes are, in pixels: few lanes are drawn taller than many. */
export function lanePitch(n: number): number {
  if (n <= 30) return 14;
  if (n <= 80) return 9;
  return 6;
}

/** The lane at `y` pixels below the first lane's top, or null. */
export function laneAt(y: number, pitch: number, n: number): number | null {
  const i = Math.floor(y / pitch);
  return y < 0 || i >= n ? null : i;
}

/**
 * The stretch the calendar shows: never outside the period, and within it
 * only the stretch the lanes take up.
 */
export interface CalendarSpan extends Period {
  /**
   * Whether a moment at `end` is drawn: it is where `end` is a lane's, and
   * not where it is the period's end, which the period leaves out.
   */
  endDrawn: boolean;
}

/** The least the calendar shows, in seconds, when the lanes take up less or no time. */
export const LEAST_SPAN = 3600;
/**
 * The pixels left after the lanes' latest end, so the mark there (merged,
 * closed unmerged, still open) is drawn whole. Their earliest opening, at the
 * left edge, has no mark.
 */
const END_ROOM = 4;

/**
 * The calendar's stretch: from the later of the period's start and the
 * earliest opening among the lanes to the earlier of the period's end and
 * their latest end (a merge, a close, or the last fetch while still open),
 * and `END_ROOM` pixels of time after it where the period has them. A
 * stretch shorter than `LEAST_SPAN` is widened to it around its middle,
 * within the period. With no lanes it is the period.
 */
export function calendarSpan(lanes: readonly Lane[], period: Period, width: number): CalendarSpan {
  if (lanes.length === 0) return { ...period, endDrawn: false };
  let start = Math.max(period.start, Math.min(...lanes.map((l) => l.created)));
  let to = Math.min(period.end, Math.max(...lanes.map((l) => l.end)));
  if (to - start < LEAST_SPAN) {
    to = Math.min(period.end, (Math.max(start, to) + start) / 2 + LEAST_SPAN / 2);
    start = Math.max(period.start, to - LEAST_SPAN);
    to = Math.min(period.end, start + LEAST_SPAN);
  }
  const end = Math.min(period.end, to + ((to - start) * END_ROOM) / Math.max(1, width - END_ROOM));
  return { start, end, endDrawn: end < period.end };
}

export interface LaneTick extends Tick {
  /** Which end of the label sits at `at`: its start at the plot's left edge, its end at its right. */
  anchor: 'start' | 'middle' | 'end';
}

export interface LaneScale {
  /** A time of a lane, in pixels; null where the mode does not draw it. */
  x(lane: Lane, t: number): number | null;
  ticks: LaneTick[];
}

/**
 * The calendar runs over `span` (`calendarSpan`), with the ticks of a PR's
 * timeline: hours, days or months, as its length gives them. What lies
 * outside it is not drawn (`laneView`). Since opening, every lane starts at
 * its own opening on the page's log duration scale, from an hour to the
 * longest lane, so a PR's first days are not crushed by the long-lived ones;
 * what came before the opening is not drawn there.
 */
export function laneScale(mode: LaneMode, lanes: readonly Lane[], width: number, span: CalendarSpan): LaneScale {
  if (mode === 'calendar') {
    const axis = timeAxis(
      [
        { at: span.start, row: 0 },
        { at: span.end, row: 0 },
      ],
      { available: width, sep: 0, breakWidth: 0 },
    );
    // A tick at the period's end would name the day after it.
    const ticks = axisTicks(axis, TICK_SPACING)
      .filter((t) => span.endDrawn || t.time < span.end)
      .map(({ at, label, anchor }) => ({ at, label, anchor }));
    return { x: (_, t) => axis.x(t), ticks };
  }
  const longest = Math.max(0, ...lanes.map((l) => (l.end - l.created) / DAY));
  const [lo, hi] = logDays(longest);
  const s = scaleLog().domain([lo, hi]).range([0, width]).clamp(true);
  const ticks = spaceTicks(
    durationTicks(lo, hi).map((d) => ({ at: s(d.days), label: d.label })),
    56,
  );
  return {
    x: (l, t) => (t < l.created ? null : s(Math.max(HOUR, (t - l.created) / DAY))),
    // A label at either edge is set inside it, not cut by it.
    ticks: ticks.map((t) => ({ ...t, anchor: t.at < 32 ? 'start' : t.at > width - 32 ? 'end' : 'middle' })),
  };
}

/** The calendar's stretch in words: its day, or its first day to its last. */
export function spanText(span: CalendarSpan): string {
  const first = formatDate(span.start);
  const last = formatDate(span.endDrawn ? span.end : span.end - 1);
  return first === last ? first : `${first} to ${last}`;
}

/** What the calendar covers, when it is less than the period; else null. */
export function spanNote(span: CalendarSpan, period: Period): string | null {
  if (span.start <= period.start && span.end >= period.end) return null;
  return `The calendar runs over the part of the period these PRs take up, ${spanText(span)}.`;
}

export interface Span {
  from: number;
  to: number;
}

/** What a mode draws of a lane: on the calendar, only what lies within its stretch. */
export interface LaneView {
  /** Before the opening, from the first commit. */
  beforeOpening: Span | null;
  open: Span[];
  /** Closed, before a reopening. */
  closed: Span[];
  activity: number[];
  approvals: number[];
  /** When it was merged or closed unmerged, or the last fetch while it is open; null where that is not drawn. */
  ending: number | null;
  /** Its life began earlier than the calendar shows: its first commit, or its opening, came before its start. */
  before: boolean;
  /** Its life went on later than the calendar shows: its merge, close, or last fetch while open came after its end. */
  after: boolean;
}

const ALL_TIME: CalendarSpan = { start: -Infinity, end: Infinity, endDrawn: false };

/**
 * A lane as `mode` draws it: on the calendar, only what lies within `span`,
 * each span of the lane cut at its edges, and whether the lane's life goes on
 * past either edge; since opening, its whole life.
 */
export function laneView(mode: LaneMode, lane: Lane, span: CalendarSpan): LaneView {
  const { start, end, endDrawn } = mode === 'calendar' ? span : ALL_TIME;
  const inside = (t: number) => t >= start && (t < end || (endDrawn && t === end));
  // A span of no length, a PR closed the moment it opened, is kept where it is inside.
  const cut = (from: number, to: number): Span | null => {
    const lo = Math.max(from, start);
    const hi = Math.min(to, end);
    return lo < hi || (from === to && inside(from)) ? { from: lo, to: hi } : null;
  };
  const open: Span[] = [];
  const closed: Span[] = [];
  const keep = (spans: Span[], s: Span | null) => {
    if (s !== null) spans.push(s);
  };
  let from = lane.created;
  for (const c of lane.closed) {
    keep(open, cut(from, c.from));
    keep(closed, cut(c.from, c.to));
    from = c.to;
  }
  keep(open, cut(from, lane.end));
  return {
    beforeOpening: lane.firstCommit === null ? null : cut(lane.firstCommit, lane.created),
    open,
    closed,
    activity: lane.activity.filter(inside),
    approvals: lane.approvals.filter(inside),
    ending: inside(lane.end) ? lane.end : null,
    before: (lane.firstCommit ?? lane.created) < start,
    after: lane.end > end || (lane.end === end && !endDrawn),
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${formatCount(n)} ${n === 1 ? one : many}`;
const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${formatCount(n)} times`);
const ENDING = { merged: 'merged', closed: 'closed unmerged', open: 'still open at the last fetch,' } as const;

/** A lane's accessible description: what its mode draws of it, in time order. */
export function describeLane(lane: Lane, view: LaneView, mode: LaneMode): string {
  const parts: string[] = [];
  if (view.before) parts.push('its life goes on earlier than shown');
  else if (view.beforeOpening !== null && mode === 'calendar') parts.push(`first commit ${formatMoment(view.beforeOpening.from)}`);
  if (view.open[0]?.from === lane.created) parts.push(`opened ${formatMoment(lane.created)}`);
  if (view.closed.length > 0) parts.push(`closed before a reopening ${times(view.closed.length)}`);
  parts.push(plural(view.activity.length, 'comment, review or bot command', 'comments, reviews or bot commands'));
  parts.push(plural(view.approvals.length, 'approval'));
  if (view.ending !== null) parts.push(`${ENDING[lane.state]} ${formatMoment(view.ending)}`);
  if (view.after) parts.push('its life goes on later than shown');
  return `${mode === 'calendar' ? 'As the calendar shows it' : 'Its whole life, from its opening'}: ${parts.join('; ')}.`;
}

/**
 * The lanes' text alternative: how many, in what order, from which PR to
 * which, what is drawn of them, and what had become of them by the last
 * fetch, which on the calendar may lie outside what it shows.
 */
export function describeLanes(
  lanes: readonly Lane[],
  views: readonly LaneView[],
  total: number,
  orderName: string,
  mode: LaneMode,
  span: CalendarSpan,
): string {
  const first = lanes[0];
  const last = lanes.at(-1);
  if (first === undefined || last === undefined) return '';
  const count = (s: Lane['state']) => lanes.filter((l) => l.state === s).length;
  const reopened = lanes.filter((l) => l.reopened > 0).length;
  const how = total > lanes.length ? `${formatCount(lanes.length)} of ${formatCount(total)} PRs` : plural(lanes.length, 'PR');
  const calendar = mode === 'calendar';
  const what = calendar
    ? `The timelines of ${how}, one per row, ${orderName}, each drawn only within the calendar shown, ${spanText(span)}, inside the period`
    : `The whole timelines of ${how}, one per row, ${orderName}, each from its opening, whatever the period`;
  const before = views.filter((v) => v.before).length;
  const edges = calendar
    ? `${formatCount(before)} ${before === 1 ? 'goes' : 'go'} on earlier than shown and ${formatCount(views.filter((v) => v.after).length)} later. `
    : '';
  return (
    `${what}: from #${first.number}, opened ${formatDate(first.created)}, to #${last.number}, opened ${formatDate(last.created)}. ` +
    edges +
    `What became of them by the last fetch${calendar ? ', shown or not' : ''}: ` +
    `${formatCount(count('merged'))} merged, ${formatCount(count('closed'))} closed unmerged, ${formatCount(count('open'))} still open; ` +
    `${reopened === 0 ? 'none was' : `${formatCount(reopened)} ${reopened === 1 ? 'was' : 'were'}`} ever closed and reopened.`
  );
}

/**
 * The line over the lanes: which PRs they show, in `rowsName` (the PR
 * table's own words for its rows), how many, and in what order. Shown
 * whatever the count. `newest` is whether the order is newest opened first,
 * so that a cut keeps the most recently opened.
 */
export function lanesLine(shown: number, total: number, rowsName: string, orderName: string, newest: boolean): string {
  const prs = plural(total, 'PR');
  if (shown >= total) return `${prs} ${rowsName}, ${orderName}.`;
  if (newest) return `The ${formatCount(shown)} most recently opened of ${prs} ${rowsName}, ${orderName}.`;
  return `The first ${formatCount(shown)} ${orderName}, of ${prs} ${rowsName}.`;
}

