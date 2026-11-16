// One PR's timeline: its first commit, its opening, every event by kind, its
// last commit and its final disposition, the stretches it spent closed and
// the three spans the design defines; and where each goes on the page. The
// time axis is timeline-axis.ts, the marks' shapes timeline-glyphs.ts. The
// component only draws what these compute.

import { TIMELINE_COLOURS as C } from './colours';
import { type Commit, type Dataset, PR_STATE, type TableYear, locateEvent, locateRow } from './data';
import { DAY, DISCLOSED, NOT_DISCLOSED, baseNote } from './filters';
import { formatCount, formatDays } from './format';
import { type Handle, isBot, personHandle } from './handles';
import { commitUrl, eventUrl, prUrl } from './links';
import { spanTitle } from './review';
import {
  type AxisCut,
  type AxisStretch,
  type AxisTick,
  axisTicks,
  formatElapsed,
  formatDate,
  formatElapsedShort,
  formatMoment,
  labelWidth,
  timeAxis,
} from './timeline-axis';
import type { Glyph } from './timeline-glyphs';

/** The rows of the timeline, top to bottom; the PR's own line is the last. */
export const ROWS = [
  { id: 'reviews', label: 'Reviews' },
  { id: 'comments', label: 'Comments' },
  { id: 'commands', label: 'Bot commands' },
  { id: 'life', label: 'The PR' },
] as const;
export type TimelineRow = (typeof ROWS)[number]['id'];

export interface MarkStyle {
  label: string;
  row: TimelineRow;
  glyph: Glyph;
  colour: string;
  /** Drawn smaller, as the author's own replies in review threads are. */
  small?: boolean;
}

/**
 * How each kind of mark is drawn: an event kind of meta's, or a point taken
 * from the PR's columns. Within a row no two kinds share a shape, and a
 * hollow shape is the PR's author acting where a filled one is someone else.
 * The order is the legend's.
 */
export const MARK_STYLES: Readonly<Record<string, MarkStyle>> = {
  review_approved: { label: 'Review approving', row: 'reviews', glyph: 'check', colour: C.byOther },
  review_changes: { label: 'Review requesting changes', row: 'reviews', glyph: 'cross', colour: C.byOther },
  review_commented: { label: 'Review commenting', row: 'reviews', glyph: 'circle', colour: C.byOther },
  bot_review: { label: 'Review by a bot', row: 'reviews', glyph: 'diamond', colour: C.byBot },
  review_author: { label: 'Reply by the author in a review thread', row: 'reviews', glyph: 'ring', colour: C.author, small: true },
  comment_other: { label: 'Comment by another person', row: 'comments', glyph: 'triangle', colour: C.byOther },
  comment_author: { label: 'Comment by the author', row: 'comments', glyph: 'hollowTriangle', colour: C.author },
  bot_account: { label: 'Comment by a bot account', row: 'comments', glyph: 'square', colour: C.byBot },
  command_other: { label: 'Bot command by another person', row: 'commands', glyph: 'square', colour: C.command },
  command_author: { label: 'Bot command by the author', row: 'commands', glyph: 'hollowSquare', colour: C.command },
  first_commit: { label: 'First commit', row: 'life', glyph: 'circle', colour: C.lifecycle },
  opened: { label: 'Opened', row: 'life', glyph: 'diamond', colour: C.lifecycle },
  ready: { label: 'Marked ready for review', row: 'life', glyph: 'hollowDiamond', colour: C.lifecycle },
  draft: { label: 'Converted to draft', row: 'life', glyph: 'hollowDown', colour: C.lifecycle },
  force_push: { label: 'Force-push', row: 'life', glyph: 'rewind', colour: C.lifecycle },
  last_commit: { label: 'Last commit', row: 'life', glyph: 'target', colour: C.lifecycle },
  closed: { label: 'Closed', row: 'life', glyph: 'ring', colour: C.closed },
  reopened: { label: 'Reopened', row: 'life', glyph: 'half', colour: C.lifecycle },
  merged: { label: 'Merged', row: 'life', glyph: 'star', colour: C.merged },
  open_now: { label: 'Still open at the last fetch', row: 'life', glyph: 'arrow', colour: C.open },
};

/**
 * A kind a later rollup adds before this page knows it is drawn on the PR's
 * line, in faint ink, in the one shape that row does not use.
 */
export function markStyle(kind: string): MarkStyle {
  return MARK_STYLES[kind] ?? { label: kind.replaceAll('_', ' '), row: 'life', glyph: 'cross', colour: C.quiet };
}

export interface TimelineMark {
  /** An event kind of meta's, or `first_commit`, `opened`, `last_commit` or `open_now`. */
  kind: string;
  /** Epoch seconds. */
  at: number;
  /** The command's name, for a bot command. */
  detail: string | null;
  /** Its page on GitHub; null when the data did not record the address. */
  href: string | null;
  /** The dataset event it draws; null for a point taken from the PR's columns. */
  event: number | null;
  /** Who acted, as far as the data says; null when it names no one. */
  who: MarkWho | null;
  /**
   * For a close the PR was reopened from, and for that reopening: how long it
   * stayed closed, as written ("under a minute", "30 days"); else null.
   */
  closedFor: string | null;
}

/**
 * Who made a mark: a person by GitHub handle, the PR's author among them, or
 * a bot account, which the data names no one for.
 */
export type MarkWho = { by: 'person'; handle: Handle; author: boolean; bot: boolean } | { by: 'bot' };

/** Who made a mark, in words: the handle's text, saying when it is the author's or a bot account's; or "a bot". */
export function whoText(who: MarkWho): string {
  if (who.by === 'bot') return 'a bot';
  return `${who.handle.text}${who.author ? ', the author' : ''}${who.bot ? ', a bot account' : ''}`;
}

export type SpanKey = 'firstCommitToOpened' | 'openedToLastCommit' | 'afterLastCommit';

export interface TimelineSpan {
  key: SpanKey;
  title: string;
  /** Where the bracket beneath the line runs, epoch seconds; equal when it cannot be measured. */
  from: number;
  to: number;
  /** Null when unknown. */
  days: number | null;
  /** Its length as written: a duration, with "so far" while the PR is open, or "unknown". */
  length: string;
  /** Its title and length. */
  text: string;
}

export interface TimelineCommit {
  sha: string;
  short: string;
  authored: number;
  committed: number;
  href: string | null;
}

export type Disposition = { state: 'merged' | 'closed'; at: number } | { state: 'open'; at: number };

/** How many seconds after a merge a close is taken for the merge's own. */
const MERGE_CLOSE = 5;

/** A stretch from a close to the reopening that ended it, in epoch seconds. */
export interface ClosedStretch {
  from: number;
  to: number;
}

export interface PrTimeline {
  number: number;
  /** The PR's title, as text. */
  title: string;
  /** How many commits it has, from the PR's columns. */
  commitCount: number;
  /** Its disclosure class, in words: "AI use not disclosed", "AI use disclosed in a trailer", … */
  disclosure: string;
  repo: string;
  url: string;
  base: string;
  /** What the base is, when the `main` target holds it under another name; else null. */
  baseNote: string | null;
  created: number;
  /** Merged or closed unmerged at the last such event, or open as of the last fetch. */
  disposition: Disposition;
  firstCommit: number | null;
  lastCommit: number | null;
  /** Why the first or last commit is left off the line; null when it is drawn. */
  firstCommitNote: string | null;
  lastCommitNote: string | null;
  /** In time order. */
  marks: TimelineMark[];
  /** Each stretch from a close to the reopening that ended it. */
  closedStretches: ClosedStretch[];
  /** How many times the PR was reopened. */
  reopened: number;
  spans: TimelineSpan[];
  commits: TimelineCommit[];
}

/** The first event of `row` and the one after its last: a PR's events are contiguous. */
export function eventRange(data: Dataset, row: number): [number, number] {
  const pr = data.events.pr;
  const lower = (target: number) => {
    let lo = 0;
    let hi = pr.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((pr[mid] as number) < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  return [lower(row), lower(row + 1)];
}

/** The dataset row of a PR number, or -1. */
export function rowOf(data: Dataset, number: number): number {
  return data.prs.number.indexOf(number);
}

/** What a mark is, as the tooltip and the events table say it: its kind, its command, how long a close lasted. */
export function markWhat(m: TimelineMark): string {
  if (m.closedFor !== null && m.kind === 'closed') return `Closed for ${m.closedFor}`;
  if (m.closedFor !== null && m.kind === 'reopened') return `Reopened after ${m.closedFor} closed`;
  return markStyle(m.kind).label + (m.detail === null ? '' : `: ${m.detail}`);
}

/**
 * A mark's accessible name: what it is, who made it when the data says, and
 * when. A bot's mark already says so in what it is.
 */
export function markName(m: TimelineMark): string {
  const who = m.who === null || m.who.by === 'bot' ? '' : ` (${whoText(m.who)})`;
  return `${markWhat(m)}${who}, ${formatMoment(m.at)}${m.href === null ? ', address not recorded' : ''}`;
}

/** The event kinds made by the person an event's `actor` names. */
const BY_ACTOR = ['comment_other', 'review_approved', 'review_changes', 'review_commented'];
/** The event kinds made by the PR's author, which carry no actor. */
const BY_AUTHOR = ['comment_author', 'command_author', 'review_author'];
/** The event kinds made by a bot account, which carry no actor either. */
const BY_BOT = ['bot_account', 'bot_review'];

const DISCLOSURE_WORDS: Readonly<Record<string, string>> = {
  none: NOT_DISCLOSED,
  description: `${DISCLOSED} in the description`,
  coauthor: `${DISCLOSED} as a co-author`,
  trailer: `${DISCLOSED} in a trailer`,
};

function commitNote(which: 'first' | 'last', commits: readonly Commit[], created: number): string {
  if (commits.length === 0) return `The ${which} commit is unknown: no commits were recorded.`;
  if (which === 'first' && commits.every((c) => c[1] > created)) {
    return 'The first commit is unknown: its author date is after the opening, so the history was rewritten.';
  }
  return `The ${which} commit is unknown.`;
}

/**
 * The timeline of dataset row `row`, whose year's table is `table`. A merge
 * is one mark: the close GitHub records with it is not in the data.
 */
export function prTimeline(data: Dataset, row: number, table: TableYear): PrTimeline {
  const p = data.prs;
  const meta = data.meta;
  const number = p.number[row] as number;
  const url = prUrl(meta.repo, number);
  const created = p.created[row] as number;
  const index = locateRow(data, row).index;
  const commits = table.commits[index] ?? [];
  const first = p.first_commit[row] as number;
  const last = p.last_commit[row] as number;
  const state = p.state[row] as number;
  const commitsUrl = `${url}/commits`;

  const authorIndex = p.author[row] as number;
  // Whether a mark is the author's follows from its kind, never from
  // comparing indexes: an event that names an actor is by the data's rule
  // not the author's. A deleted account's comments and reviews all name the
  // pooled `ghost` entry, so one on a PR by `ghost` is not known to be its
  // author's, and one on a PR credited to a name from its commits is not
  // known to be that person's either.
  const person = (index: number, author: boolean): MarkWho => ({
    by: 'person',
    handle: personHandle(meta, index),
    author,
    bot: isBot(meta, index),
  });
  // A bot command by someone other than the author, and every lifecycle
  // event but the opening, name no one: the data does not record who.
  const whoMade = (kind: string, e: number): MarkWho | null => {
    if (BY_AUTHOR.includes(kind)) return person(authorIndex, true);
    if (BY_BOT.includes(kind)) return { by: 'bot' };
    const actor = data.events.actor[e] as number;
    return BY_ACTOR.includes(kind) && actor >= 0 ? person(actor, false) : null;
  };

  const derived = (kind: string, at: number, href: string | null): TimelineMark => ({
    kind,
    at,
    detail: null,
    href,
    event: null,
    who: kind === 'opened' ? person(authorIndex, true) : null,
    closedFor: null,
  });
  const commitAt = (field: 1 | 2, t: number) => {
    const c = commits.find((c) => c[field] === t);
    return c ? commitUrl(meta.repo, number, c[0]) : commitsUrl;
  };

  const marks: TimelineMark[] = [];
  if (first >= 0) marks.push(derived('first_commit', first, commitAt(1, first)));
  marks.push(derived('opened', created, url));
  if (last >= 0) marks.push(derived('last_commit', last, commitAt(2, last)));

  const [start, end] = eventRange(data, row);
  const closedStretches: ClosedStretch[] = [];
  let closing: TimelineMark | null = null;
  let merged: TimelineMark | null = null;
  let lastClose: TimelineMark | null = null;
  for (let e = start; e < end; e++) {
    const kind = meta.event_kinds[data.events.kind[e] as number] ?? '';
    const at = data.events.at[e] as number;
    // GitHub records a close with every merge. The rollup leaves out one at
    // the merge's second, but not one a second later; it is the merge's own
    // and is drawn as the merge alone.
    if (kind === 'closed' && merged !== null && at - merged.at <= MERGE_CLOSE) continue;
    const sub = data.events.sub[e] as number;
    const ref = table.refs[locateEvent(data, e).index] ?? '';
    const isCommand = kind === 'command_author' || kind === 'command_other';
    const mark: TimelineMark = {
      kind,
      at,
      detail: isCommand ? (meta.commands[sub]?.name ?? null) : null,
      href: eventUrl(meta.repo, number, kind, ref),
      event: e,
      who: whoMade(kind, e),
      closedFor: null,
    };
    marks.push(mark);
    if (kind === 'closed') {
      closing ??= mark;
      lastClose = mark;
    } else if (kind === 'reopened') {
      const from = closing?.at ?? at;
      const closedFor = formatElapsed(at - from);
      closedStretches.push({ from, to: at });
      if (closing) closing.closedFor = closedFor;
      mark.closedFor = closedFor;
      closing = null;
      lastClose = null;
    } else if (kind === 'merged') {
      merged = mark;
    }
  }

  let disposition: Disposition;
  if (state === PR_STATE.open) {
    disposition = { state: 'open', at: meta.fetched_through };
    marks.push(derived('open_now', meta.fetched_through, url));
  } else {
    const kind = state === PR_STATE.merged ? 'merged' : 'closed';
    // A merged PR ends at its merge; one closed unmerged at the close it was not reopened from.
    const ending = kind === 'merged' ? merged : lastClose;
    if (ending !== null) {
      disposition = { state: kind, at: ending.at };
    } else {
      const at = p.closed[row] as number;
      disposition = { state: kind, at };
      marks.push(derived(kind, at, url));
    }
  }
  // A stable sort: at one moment, the points from the columns keep their
  // place before the events, and the events their order in the data.
  marks.sort((a, b) => a.at - b.at);

  const base = meta.bases[p.base[row] as number] ?? '';
  // A PR is worded as a backport only when it links the original it
  // backports: off the development branch alone, it may be a feature
  // branch's, or a backport that does not say what it copies.
  const backport = (table.backport_of[index] ?? 0) > 0;
  const open = disposition.state === 'open';
  const span = (key: SpanKey, from: number, to: number, days: number | null, soFar: boolean): TimelineSpan => {
    const title = spanTitle(key, backport);
    const length = days === null ? 'unknown' : `${formatDays(days)}${soFar ? ' so far' : ''}`;
    return { key, title, from, to, days, length, text: `${title}: ${length}` };
  };
  const knownFirst = first >= 0 && first <= created;
  const spans = [
    knownFirst ? span('firstCommitToOpened', first, created, (created - first) / DAY, false) : span('firstCommitToOpened', created, created, null, false),
    last >= 0
      ? span('openedToLastCommit', created, Math.max(created, last), Math.max(0, last - created) / DAY, open)
      : span('openedToLastCommit', created, created, null, false),
    last >= 0
      ? span('afterLastCommit', last, Math.max(last, disposition.at), Math.max(0, disposition.at - last) / DAY, open)
      : span('afterLastCommit', disposition.at, disposition.at, null, false),
  ];

  return {
    number,
    title: table.titles[index] ?? '',
    commitCount: p.commits[row] as number,
    disclosure: DISCLOSURE_WORDS[meta.disclosure[p.disclosure[row] as number] ?? ''] ?? DISCLOSED,
    repo: meta.repo,
    url,
    base,
    baseNote: baseNote(base),
    created,
    disposition,
    firstCommit: first >= 0 ? first : null,
    lastCommit: last >= 0 ? last : null,
    firstCommitNote: first >= 0 ? null : commitNote('first', commits, created),
    lastCommitNote: last >= 0 ? null : commitNote('last', commits, created),
    marks,
    closedStretches,
    reopened: p.reopened[row] as number,
    spans,
    commits: commits.map(([sha, authored, committed]) => ({
      sha,
      short: sha.slice(0, 7),
      authored,
      committed,
      href: commitUrl(meta.repo, number, sha),
    })),
  };
}

export interface TimelineLegendItem {
  kind: string;
  row: TimelineRow;
  label: string;
  glyph: Glyph;
  colour: string;
  small: boolean;
}

/** One entry per kind of mark on the line, row by row from the top, each row in a fixed order. */
export function timelineLegend(tl: PrTimeline): TimelineLegendItem[] {
  const present = new Set(tl.marks.map((m) => m.kind));
  const known = Object.keys(MARK_STYLES);
  const unknown = [...present].filter((k) => !known.includes(k));
  return ROWS.flatMap(({ id }) =>
    [...known, ...unknown]
      .filter((kind) => present.has(kind) && markStyle(kind).row === id)
      .map((kind) => {
        const s = markStyle(kind);
        return { kind, row: id, label: s.label, glyph: s.glyph, colour: s.colour, small: s.small === true };
      }),
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${formatCount(n)} ${n === 1 ? one : many}`;

/** "a", "a and b", "a, b and c". */
function inWords(items: readonly string[]): string {
  return items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1) as string}`;
}

/** How many times the PR was reopened, and how long each closed stretch lasted, as the summary under the line says it. */
export function reopenedText(tl: PrTimeline): string {
  if (tl.reopened === 0) return 'Never closed and reopened.';
  const lengths = tl.closedStretches.map((s) => formatElapsed(s.to - s.from));
  const each = lengths.length === 0 ? '' : `: for ${inWords(lengths)}`;
  return `Closed and reopened ${plural(tl.reopened, 'time')}${each}.`;
}

/** The timeline's text alternative: its course, its spans, and its events counted by kind. */
export function describeTimeline(tl: PrTimeline): string {
  const d = tl.disposition;
  const ended =
    d.state === 'open'
      ? `still open at the last fetch, ${formatMoment(d.at)}`
      : `${d.state === 'merged' ? 'merged' : 'closed unmerged'} ${formatMoment(d.at)}`;
  const counts = new Map<string, number>();
  for (const m of tl.marks) if (m.event !== null) counts.set(m.kind, (counts.get(m.kind) ?? 0) + 1);
  const events = [...counts].map(([kind, n]) => `${formatCount(n)} ${markStyle(kind).label.toLowerCase()}`).join(', ');
  return [
    `#${tl.number}, opened ${formatMoment(tl.created)}, ${ended}.`,
    ...(tl.firstCommitNote ? [tl.firstCommitNote] : []),
    ...(tl.lastCommitNote ? [tl.lastCommitNote] : []),
    `${tl.spans.map((s) => s.text).join('; ')}.`,
    counts.size === 0 ? 'No events.' : `${plural([...counts.values()].reduce((a, b) => a + b, 0), 'event')}: ${events}.`,
    reopenedText(tl),
  ].join(' ');
}

/** The timeline's geometry, in pixels: the rows top to bottom, then the axis, then the spans. */
export const LAYOUT = {
  /** A mark's radius, and the least distance between two marks of a row. */
  r: 5,
  sep: 12,
  /** Room at either end of the line for a mark's half. */
  pad: 16,
  /** The width a cut stretch is drawn at. */
  cut: 64,
  /** A mark's hit target is at most this wide, and this tall. */
  hit: 26,
  rowY: { reviews: 18, comments: 50, commands: 82, life: 126 },
  /** The baseline of the labels over the PR's line. */
  labelY: 106,
  /** The baseline of a closed stretch's length, under the PR's line. */
  closedY: 145,
  axisY: 150,
  tickY: 166,
  noteY: 186,
  spanY: 208,
  spanRow: 34,
} as const;

export interface PlacedMark {
  mark: TimelineMark;
  style: MarkStyle;
  x: number;
  y: number;
  /** Its hit target's left and right edges: up to half way to its neighbours in its row. */
  x0: number;
  x1: number;
}

export interface PlacedSpan {
  span: TimelineSpan;
  x0: number;
  x1: number;
  /** The bracket's height; its text is under it, centred on `textX`. */
  y: number;
  text: string;
  textX: number;
}

/**
 * A stretch the PR spent closed. One of an hour or more is washed, and its
 * length is always printed: on the wash, or moved beside it when another
 * label is in the way. A shorter one is only its pair of marks, whose names
 * say how long it lasted.
 */
export interface PlacedClosed {
  from: number;
  to: number;
  x0: number;
  x1: number;
  washed: boolean;
  /** "closed 30 d"; null when not washed. */
  label: string | null;
  /** The label's centre. */
  labelX: number;
}

/** A closed stretch shorter than this is drawn as its pair of marks, with no wash. */
export const WASHED_CLOSE = 3600;

export interface TimelineLayout {
  width: number;
  height: number;
  marks: PlacedMark[];
  /** The stretch before the PR opened, drawn thin. */
  before: { x0: number; x1: number } | null;
  /** The PR's line while it was open. */
  open: { x0: number; x1: number }[];
  /** While it was closed, before a reopening. */
  closed: PlacedClosed[];
  /** Each cut, with its note centred at `labelX`: its length, and its far side's date when no tick gives it. */
  cuts: (AxisCut & { label: string; labelX: number })[];
  /** Each stretched run, with its real length when there is room to print it. */
  stretches: (AxisStretch & { label: string | null })[];
  ticks: AxisTick[];
  /** The names of the first commit, the opening, the last commit and the disposition, where they fit over the line. */
  labels: { x: number; text: string }[];
  spans: PlacedSpan[];
}

const SPAN_NAMES: Record<SpanKey, string> = {
  firstCommitToOpened: 'before opening',
  openedToLastCommit: 'opened to last commit',
  afterLastCommit: 'after the last commit',
};

/** Where everything on the timeline goes, filling `available` pixels or, when crowded, more. */
export function timelineLayout(tl: PrTimeline, available: number): TimelineLayout {
  const L = LAYOUT;
  const rowOf = (kind: string) => ROWS.findIndex((r) => r.id === markStyle(kind).row);
  const axis = timeAxis(
    tl.marks.map((m) => ({ at: m.at, row: rowOf(m.kind) })),
    { available: Math.max(1, available - 2 * L.pad), sep: L.sep, breakWidth: L.cut },
  );
  let width = axis.width + 2 * L.pad;
  const X = (t: number) => L.pad + axis.x(t);

  const marks: PlacedMark[] = tl.marks.map((mark, i) => {
    const style = markStyle(mark.kind);
    const x = L.pad + (axis.xs[i] as number);
    return { mark, style, x, y: L.rowY[style.row], x0: x, x1: x };
  });
  const byRow = new Map<number, PlacedMark[]>();
  for (const m of marks) byRow.set(m.y, [...(byRow.get(m.y) ?? []), m]);
  for (const row of byRow.values()) {
    row.sort((a, b) => a.x - b.x);
    row.forEach((m, k) => {
      const half = L.hit / 2;
      const prev = row[k - 1];
      const next = row[k + 1];
      m.x0 = m.x - (prev ? Math.min(half, (m.x - prev.x) / 2) : half);
      m.x1 = m.x + (next ? Math.min(half, (next.x - m.x) / 2) : half);
    });
  }

  const xOf = (kind: string, at: number) => marks.find((m) => m.mark.kind === kind && m.mark.at === at)?.x;
  const d = tl.disposition;
  const start = xOf('opened', tl.created) ?? X(tl.created);
  const end = xOf(d.state === 'open' ? 'open_now' : d.state, d.at) ?? X(d.at);
  // Every washed stretch's length is printed under the line, never dropped:
  // centred on its wash, moved aside from a cut's marker or the label before
  // it, kept inside the line's end where it can be, and the line widened
  // only when the labels cannot otherwise fit.
  const markers = axis.cuts.map((c) => L.pad + (c.x0 + c.x1) / 2);
  const rightOfMarkers = (left: number, w: number) => {
    for (const m of markers) if (left < m + 10 && left + w > m - 10) left = m + 10;
    return left;
  };
  const leftOfMarkers = (left: number, w: number) => {
    for (const m of [...markers].reverse()) if (left < m + 10 && left + w > m - 10) left = m - 10 - w;
    return left;
  };
  const closed: PlacedClosed[] = tl.closedStretches.map((s) => {
    const x0 = xOf('closed', s.from) ?? X(s.from);
    const x1 = xOf('reopened', s.to) ?? X(s.to);
    const washed = s.to - s.from >= WASHED_CLOSE;
    const label = washed ? `closed ${formatElapsedShort(s.to - s.from)}` : null;
    return { ...s, x0, x1, washed, label, labelX: (x0 + x1) / 2 };
  });
  const labelled = closed.filter((c) => c.label !== null);
  const half = (c: PlacedClosed) => labelWidth(c.label as string) / 2;
  let right = 0;
  for (const c of labelled) {
    const left = rightOfMarkers(Math.max(c.labelX - half(c), right + 6, 4), 2 * half(c));
    c.labelX = left + half(c);
    right = left + 2 * half(c);
  }
  let limit = width - 4;
  for (const c of [...labelled].reverse()) {
    if (c.labelX + half(c) > limit) c.labelX = leftOfMarkers(limit - 2 * half(c), 2 * half(c)) + half(c);
    limit = c.labelX - half(c) - 6;
  }
  right = 0;
  for (const c of labelled) {
    const left = rightOfMarkers(Math.max(c.labelX - half(c), right + 6, 4), 2 * half(c));
    c.labelX = left + half(c);
    right = left + 2 * half(c);
  }
  width = Math.max(width, right + 4);
  const open: { x0: number; x1: number }[] = [];
  let from = start;
  for (const c of closed) {
    if (!c.washed) continue;
    if (c.x0 > from) open.push({ x0: from, x1: c.x0 });
    from = Math.max(from, c.x1);
  }
  if (end > from) open.push({ x0: from, x1: end });
  const firstX = tl.firstCommit !== null && tl.firstCommit < tl.created ? xOf('first_commit', tl.firstCommit) : undefined;

  // A cut's length and a stretch's real time share the row under the date
  // ticks; a stretch's says it was spread out, so it is not read as a date,
  // and gives way to a cut's.
  // A cut's far side is dated by a tick; where the start's label leaves it
  // no room, the cut's note gives the date.
  // The page shows the line's pads too, so a screenful is that much wider than the axis.
  const ticks = axisTicks(axis, 72, L.pad).map((t) => ({ ...t, at: t.at + L.pad }));
  // A note centred on its cut, kept inside the line.
  const cuts = axis.cuts.map((c) => {
    const dated = ticks.some((t) => t.dated && t.time === c.to);
    const label = `${formatElapsed(c.to - c.from)}${dated ? '' : `, to ${formatDate(c.to)}`}`;
    const w = labelWidth(label);
    const mid = L.pad + (c.x0 + c.x1) / 2;
    const labelX = Math.min(Math.max(mid, w / 2 + 4), width - w / 2 - 4);
    return { ...c, x0: c.x0 + L.pad, x1: c.x1 + L.pad, label, labelX };
  });
  const cutLabels = cuts.map((c) => {
    const w = labelWidth(c.label);
    return { x0: c.labelX - w / 2, x1: c.labelX + w / 2 };
  });
  const stretches = axis.stretches.map((s) => {
    const text = `${formatElapsed(s.to - s.from)} spread out`;
    const [x0, x1] = [s.x0 + L.pad, s.x1 + L.pad];
    const w = labelWidth(text);
    const [t0, t1] = [(x0 + x1 - w) / 2, (x0 + x1 + w) / 2];
    const fits = x1 - x0 >= w + 8 && cutLabels.every((c) => t1 + 8 <= c.x0 || t0 >= c.x1 + 8);
    return { ...s, x0, x1, label: fits ? text : null };
  });

  // The four points the reader looks for first are named over the line,
  // the opening and the disposition before the commits, where they fit.
  const ending = { merged: 'merged', closed: 'closed unmerged', open: 'still open' }[d.state];
  const candidates: { x: number | undefined; text: string }[] = [
    { x: start, text: 'opened' },
    { x: end, text: ending },
    { x: firstX, text: 'first commit' },
    { x: tl.lastCommit === null ? undefined : xOf('last_commit', tl.lastCommit), text: 'last commit' },
  ];
  const labels: { x: number; text: string }[] = [];
  for (const c of candidates) {
    if (c.x === undefined) continue;
    const w = labelWidth(c.text);
    const x = Math.min(Math.max(c.x, w / 2 + 4), width - w / 2 - 4);
    const clear = labels.every((l) => Math.abs(l.x - x) >= (labelWidth(l.text) + w) / 2 + 8);
    if (clear) labels.push({ x, text: c.text });
  }

  // Each span's bracket goes in the first row beneath where neither it nor
  // its text overlaps those already there; brackets may share an end, as
  // consecutive spans do.
  type Taken = { x0: number; x1: number; t0: number; t1: number };
  const rows: Taken[][] = [];
  const spans: PlacedSpan[] = [];
  for (const span of tl.spans) {
    if (span.days === null) continue;
    const x0 = X(span.from);
    const x1 = X(span.to);
    const text = `${SPAN_NAMES[span.key]}: ${span.length}`;
    const w = labelWidth(text);
    const mid = Math.min(Math.max((x0 + x1) / 2, w / 2 + 4), width - w / 2 - 4);
    const mine = { x0, x1, t0: mid - w / 2, t1: mid + w / 2 };
    const fits = (row: Taken[]) =>
      row.every((o) => (mine.x1 <= o.x0 + 1 || mine.x0 >= o.x1 - 1) && (mine.t1 + 12 <= o.t0 || mine.t0 >= o.t1 + 12));
    let row = rows.findIndex(fits);
    if (row === -1) row = rows.push([]) - 1;
    rows[row]?.push(mine);
    spans.push({ span, x0, x1, y: L.spanY + row * L.spanRow, text, textX: mid });
  }

  return {
    width,
    height: L.spanY + Math.max(1, rows.length) * L.spanRow,
    marks,
    before: firstX === undefined ? null : { x0: firstX, x1: start },
    open,
    closed,
    cuts,
    stretches,
    ticks,
    labels,
    spans,
  };
}
