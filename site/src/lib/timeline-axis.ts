// The time axis of one PR's timeline, its date ticks, and how the timeline
// writes moments and elapsed times.

import { DAY } from './filters';
import { formatDays } from './format';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

/** A moment to the minute: `14 Aug 2026 09:12 UTC`. */
export function formatMoment(t: number): string {
  const d = new Date(t * 1000);
  return `${formatDate(t)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

/** A day: `14 Aug 2026`. */
export function formatDate(t: number): string {
  const d = new Date(t * 1000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()] as string} ${d.getUTCFullYear()}`;
}

/** A day without its year, for an axis: `14 Aug`. */
export function formatDayMonth(t: number): string {
  const d = new Date(t * 1000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()] as string}`;
}

/** An elapsed time in seconds: minutes under an hour, else as the page writes durations. */
export function formatElapsed(seconds: number): string {
  if (seconds < 60) return 'under a minute';
  if (seconds < 3600) {
    const m = Math.round(seconds / 60);
    return `${m} minute${m === 1 ? '' : 's'}`;
  }
  return formatDays(seconds / DAY);
}

/** An elapsed time in seconds, short, for a label beside a mark: `<1 min`, `37 min`, `37 h`, `9.8 d`, `30 d`. */
export function formatElapsedShort(seconds: number): string {
  if (seconds < 60) return '<1 min';
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 2 * DAY) return `${Math.round(seconds / 3600)} h`;
  const days = seconds / DAY;
  return `${days < 10 ? days.toFixed(1).replace(/\.0$/, '') : Math.round(days)} d`;
}

/** About how wide a text of the page's 12px labels is, in pixels. */
export function labelWidth(s: string): number {
  return s.length * 7.2;
}

// The time axis. Real PRs are skewed: a first commit can come months before
// the opening, and fifty comments can fall in one afternoon. Time runs
// linearly, at one scale for the whole line, except in two places, each
// drawn so the reader sees it: a quiet stretch that dwarfs the rest of the
// line, such as a first commit months before the opening, is cut out when the
// rest is crowded, leaving a gap of fixed width labelled with its length; and
// where marks in one row would overlap, the axis stretches just enough to
// set them a step apart.

export interface AxisItem {
  at: number;
  /** Items in one row must not overlap; items in different rows may share an x. */
  row: number;
}

export interface AxisOptions {
  /** The width to fill, in pixels. */
  available: number;
  /** The least distance between two items of one row. */
  sep: number;
  /** The width a cut stretch is drawn at. */
  breakWidth: number;
  /** The shortest stretch that may be cut, in seconds; 6 hours by default. */
  minBreak?: number;
  /** A stretch is cut only if it is this many times as long as the rest of the line's time; 3 by default. */
  dominance?: number;
}

/** A stretch of time cut out of the axis, and where its gap is drawn. */
export interface AxisCut {
  from: number;
  to: number;
  x0: number;
  x1: number;
}

/** A run of the axis stretched to keep marks apart: the times it covers, where, and how many marks are in it. */
export interface AxisStretch extends AxisCut {
  count: number;
}

export interface TimeAxis {
  /** The width drawn, at least `available`. */
  width: number;
  /** The width there was to fill: a line wider scrolls. */
  available: number;
  /** Each item's x, aligned with the items given. */
  xs: number[];
  /** Any time's x: linear between the items, across a cut too, clamped at the ends. */
  x(t: number): number;
  /**
   * The time at an x, the inverse of `x`, never before the first item's time nor after the last's: a moment spread
   * over several marks' width is that moment throughout.
   */
  time(x: number): number;
  cuts: AxisCut[];
  stretches: AxisStretch[];
  /** The linear scale, pixels per second. */
  scale: number;
  /** The first and last items' times. */
  from: number;
  to: number;
}

interface Placed {
  xs: number[];
  /** Each group's first x and its last, aligned with the groups. */
  starts: number[];
  ends: number[];
  /** Each step into a group (from the one before) wider than its time gives. */
  stretched: boolean[];
  width: number;
}

/** Times of the axis's groups (items at one moment), ascending, and each item's group. */
function groupsOf(items: readonly AxisItem[], order: readonly number[]): { times: number[]; groupOf: number[] } {
  const times: number[] = [];
  const groupOf: number[] = new Array<number>(items.length);
  for (const i of order) {
    const t = (items[i] as AxisItem).at;
    if (times.length === 0 || (times.at(-1) as number) !== t) times.push(t);
    groupOf[i] = times.length - 1;
  }
  return { times, groupOf };
}

export function timeAxis(items: readonly AxisItem[], opts: AxisOptions): TimeAxis {
  const { available, sep, breakWidth } = opts;
  const minBreak = opts.minBreak ?? 6 * 3600;
  const dominance = opts.dominance ?? 3;
  const order = items.map((_, i) => i).sort((a, b) => (items[a] as AxisItem).at - (items[b] as AxisItem).at || a - b);
  const { times, groupOf } = groupsOf(items, order);
  const gaps = times.map((t, g) => (g === 0 ? 0 : t - (times[g - 1] as number)));

  const place = (scale: number, cut: ReadonlySet<number>): Placed => {
    const xs = new Array<number>(items.length).fill(0);
    const starts: number[] = [];
    const ends: number[] = [];
    const stretched: boolean[] = [];
    const lastInRow = new Map<number, number>();
    let k = 0;
    for (let g = 0; g < times.length; g++) {
      const prevEnd = g === 0 ? 0 : (ends[g - 1] as number);
      const step = g === 0 ? 0 : cut.has(g) ? breakWidth : (gaps[g] as number) * scale;
      let x = prevEnd + step;
      const members: number[] = [];
      while (k < order.length && groupOf[order[k] as number] === g) members.push(order[k++] as number);
      for (const i of members) {
        const before = lastInRow.get((items[i] as AxisItem).row);
        if (before !== undefined) x = Math.max(x, before + sep);
      }
      stretched.push(g > 0 && !cut.has(g) && x - prevEnd > step + 0.5);
      starts.push(x);
      const slots = new Map<number, number>();
      let groupEnd = x;
      for (const i of members) {
        const row = (items[i] as AxisItem).row;
        const slot = slots.get(row) ?? 0;
        slots.set(row, slot + 1);
        xs[i] = x + slot * sep;
        lastInRow.set(row, xs[i] as number);
        groupEnd = Math.max(groupEnd, xs[i] as number);
      }
      ends.push(groupEnd);
    }
    return { xs, starts, ends, stretched, width: ends.at(-1) ?? 0 };
  };

  const solve = (cut: ReadonlySet<number>): number => {
    const linear = gaps.reduce((sum, gap, g) => (g === 0 || cut.has(g) ? sum : sum + gap), 0);
    if (linear <= 0) return 0;
    const least = place(0, cut).width;
    // When the marks alone fill the space, the line grows past it, keeping a
    // quarter for time to show.
    const target = Math.max(available, least * 1.25);
    let lo = 0;
    let hi = target / linear;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (place(mid, cut).width < target) lo = mid;
      else hi = mid;
    }
    return hi;
  };

  // The longest stretch still uncut is cut while it dominates the time left
  // on the line and leaves the rest too little room for its marks, each a
  // step apart; a merely long wait, the kind the reader came to see, keeps
  // its true length.
  const cut = new Set<number>();
  let scale = solve(cut);
  let placed = place(scale, cut);
  while (placed.stretched.some(Boolean)) {
    let longest = -1;
    let rest = 0;
    gaps.forEach((gap, g) => {
      if (g === 0 || cut.has(g)) return;
      rest += gap;
      if (longest === -1 || gap > (gaps[longest] as number)) longest = g;
    });
    const gap = gaps[longest] ?? 0;
    const squeezed = (rest - gap) * scale < items.length * sep;
    if (longest === -1 || gap < minBreak || gap < dominance * (rest - gap) || !squeezed) break;
    cut.add(longest);
    scale = solve(cut);
    placed = place(scale, cut);
  }

  const { xs, starts, ends, stretched } = placed;
  const cuts: AxisCut[] = [...cut]
    .sort((a, b) => a - b)
    .map((g) => ({ from: times[g - 1] as number, to: times[g] as number, x0: ends[g - 1] as number, x1: starts[g] as number }));

  // A stretch runs over consecutive stretched steps and any moment holding
  // two marks of one row.
  const counts = times.map(() => 0);
  for (const g of groupOf) counts[g] = (counts[g] as number) + 1;
  const stretches: AxisStretch[] = [];
  let open: AxisStretch | null = null;
  for (let g = 0; g < times.length; g++) {
    const into = stretched[g] === true;
    const within = (ends[g] as number) > (starts[g] as number);
    if (into && open === null) {
      open = { from: times[g - 1] as number, to: times[g] as number, x0: starts[g - 1] as number, x1: ends[g] as number, count: counts[g - 1] as number };
    }
    if (!into && within && open === null) {
      open = { from: times[g] as number, to: times[g] as number, x0: starts[g] as number, x1: ends[g] as number, count: 0 };
    }
    if (open !== null && (into || within)) {
      open.to = times[g] as number;
      open.x1 = ends[g] as number;
      open.count += counts[g] as number;
    }
    const continues = stretched[g + 1] === true;
    if (open !== null && !continues) {
      stretches.push(open);
      open = null;
    }
  }

  // The scale is solved to a hair over the width; that hair is not a scroll.
  const width = placed.width < available + 0.01 ? available : placed.width;
  // The knots of the map from time to x: each group's first x.
  const x = (t: number): number => {
    if (times.length === 0) return 0;
    if (t <= (times[0] as number)) return starts[0] as number;
    if (t >= (times.at(-1) as number)) return starts.at(-1) as number;
    let lo = 0;
    let hi = times.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >>> 1;
      if ((times[mid] as number) <= t) lo = mid;
      else hi = mid;
    }
    const t0 = times[lo] as number;
    const t1 = times[hi] as number;
    const x0 = ends[lo] as number;
    const x1 = starts[hi] as number;
    return t === t0 ? (starts[lo] as number) : x0 + ((t - t0) / (t1 - t0)) * (x1 - x0);
  };

  // The group whose spread holds `at` is that moment throughout; between one
  // group's last x and the next one's first, time runs linearly.
  const time = (at: number): number => {
    if (times.length === 0) return 0;
    let g = 0;
    let hi = times.length;
    while (hi - g > 1) {
      const mid = (g + hi) >>> 1;
      if ((starts[mid] as number) <= at) g = mid;
      else hi = mid;
    }
    const x0 = ends[g] as number;
    const t0 = times[g] as number;
    if (at <= x0 || g === times.length - 1) return t0;
    const x1 = starts[g + 1] as number;
    const t1 = times[g + 1] as number;
    return x1 <= x0 ? t0 : Math.min(t1, t0 + ((at - x0) / (x1 - x0)) * (t1 - t0));
  };

  return { width, available, xs, x, time, cuts, stretches, scale, from: times[0] ?? 0, to: times.at(-1) ?? 0 };
}

export interface AxisTick {
  /** In the axis's pixels. */
  at: number;
  /** Epoch seconds. */
  time: number;
  label: string;
  /** The label names a day, not only a time of day. */
  dated: boolean;
  /** Which end of the label sits at `at`: its start at the line's start, its end at the line's end. */
  anchor: 'start' | 'middle' | 'end';
}

const MINUTE_STEPS = [60, 5 * 60, 15 * 60, 30 * 60];
const HOUR_STEPS = [3600, 3 * 3600, 6 * 3600, 12 * 3600];
const DAY_STEPS = [DAY, 2 * DAY, 7 * DAY, 14 * DAY];
const MONTH_STEPS = [1, 3, 6, 12];
// 5 Jan 1970 was a Monday: a week's ticks fall on Mondays, as the page's weeks begin.
const MONDAY = 4 * DAY;

/** A line wider than the page has a dated tick at least this often, so no screenful lacks a date. */
export const DATED_EVERY = 900;
/** A screenful is at least this wide where the page shows that much of the line, as a 390-pixel phone does. */
export const DATED_LEAST = 236;

function monthStarts(from: number, to: number, every: number): number[] {
  const d = new Date(from * 1000);
  const year = d.getUTCFullYear();
  const out: number[] = [];
  // Date.UTC carries a month past December into the years after.
  for (let m = Math.ceil((d.getUTCMonth() + 1) / every) * every; ; m += every) {
    const t = Date.UTC(year, m, 1) / 1000;
    if (t > to) return out;
    out.push(t);
  }
}

const clock = (t: number) => {
  const d = new Date(t * 1000);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};
const yearOf = (t: number) => new Date(t * 1000).getUTCFullYear();
const dayOf = (t: number) => Math.floor(t / DAY);

/** How a tick writes its time: a time of day, a month, a day, or a day and its time. */
type Form = 'clock' | 'month' | 'date' | 'dateClock';

/** A tick's label: its time in its form, naming the year when asked. */
function writeTick(t: number, form: Form, withYear: boolean): string {
  if (form === 'clock') return clock(t);
  const d = new Date(t * 1000);
  const month = `${MONTHS[d.getUTCMonth()] as string}${withYear ? ` ${d.getUTCFullYear()}` : ''}`;
  if (form === 'month') return month;
  return form === 'date' ? `${d.getUTCDate()} ${month}` : `${d.getUTCDate()} ${month} ${clock(t)}`;
}

/** The widest label a fill tick of each form can have. */
const WIDEST = { dateClock: labelWidth('13 Oct 2026 18:05'), date: labelWidth('13 Oct 2026') };

/**
 * Date ticks along the line, labels at least 8 pixels apart: minutes,
 * hours, days, weeks from a Monday or months, whichever is the finest step
 * at least `minGap` pixels long at the linear scale. None falls inside a cut.
 *
 * The line's start always has a tick giving its full date, year and, on a
 * line of hours or minutes, time of day, unless on a line wider than the page
 * that time leaves no room for a date a screenful on. After it a tick names
 * its day where the day changes and its year where the year changes. The far
 * side of each cut is dated too where the label before it leaves room; the
 * layout otherwise gives the date in the cut's note.
 *
 * On a line wider than the page, every window as wide as the page shows of it
 * holds a dated tick wherever a date fits: where the round times leave a
 * screenful undated, a tick is added as far along as its label fits, giving
 * the date and time there, or the date alone. The page shows the width the
 * line was given and `margin` past each end, so the line's last screenful
 * reaches a margin less far. A screenful is the width given, at most
 * `DATED_EVERY` and at least `DATED_LEAST`, but no wider than the page shows.
 *
 * Where no date fits within a screenful of the dated tick before, the next is
 * the cut's far side: a date a screenful on that falls in a cut goes back to
 * the cut's near side, 64 pixels sooner, and may not clear the label before.
 * After the start's "13 Oct 2026", 79 pixels from its tick, a date with its
 * year needs 8 pixels more and half its own 79, so on a view narrower than
 * 191 pixels the page can show up to 191 pixels of line between the start's
 * tick and the next dated one. After any other dated tick, whose label
 * reaches at most 61 pixels past it, that needs a view narrower than 173
 * pixels and a date naming another year than the label before.
 *
 * The ticks are made in one pass along the line, and each is labelled once,
 * from its own time, when it is placed. A placed tick is never moved, and
 * the only one ever taken back is a time of day, which names neither a day
 * nor a year, so no label after it depends on it.
 */
export function axisTicks(axis: TimeAxis, minGap: number, margin = 0): AxisTick[] {
  const { from, to, scale } = axis;
  let times: number[] = [];
  let unit: 'clock' | 'day' | 'month' = 'day';
  if (to > from && scale > 0) {
    const fine = [...MINUTE_STEPS, ...HOUR_STEPS].find((s) => s * scale >= minGap);
    const day = DAY_STEPS.find((s) => s * scale >= minGap);
    if (fine !== undefined || day !== undefined) {
      const step = (fine ?? day) as number;
      const offset = step >= 7 * DAY ? MONDAY : 0;
      for (let t = Math.ceil((from - offset) / step) * step + offset; t <= to; t += step) times.push(t);
      unit = fine !== undefined ? 'clock' : 'day';
    } else {
      times = monthStarts(from, to, MONTH_STEPS.find((k) => k * 30 * DAY * scale >= minGap) ?? 12);
      unit = 'month';
    }
  }
  const clocked = (t: number) => unit === 'clock' && t % DAY !== 0;
  const scrolls = axis.width > axis.available + 1;
  const view = axis.available + 2 * margin;
  const every = Math.min(DATED_EVERY, Math.max(DATED_LEAST, axis.available), view);
  // The window at the line's end reaches only a margin past it.
  const last = Math.min(every, view - margin);
  // Where the dated tick after the start goes when nothing else is in its
  // way: a screenful on, or the cut's near side when that falls in a cut.
  const firstFill = (() => {
    const at = Math.min(every, axis.width);
    return axis.cuts.find((c) => at > c.x0 && at < c.x1)?.x0 ?? at;
  })();
  // The start gives its time of day where a date with its year still fits
  // after it there.
  const startClock = (() => {
    if (!clocked(from)) return false;
    const room = firstFill + WIDEST.date / 2 > axis.width ? firstFill - WIDEST.date : firstFill - WIDEST.date / 2;
    return !scrolls || labelWidth(writeTick(from, 'dateClock', true)) + 8 <= room;
  })();

  const make = (at: number, time: number, form: Form, withYear: boolean): AxisTick => {
    const label = writeTick(time, form, withYear);
    const w = labelWidth(label);
    const anchor = at - w / 2 < 0 ? 'start' : at + w / 2 > axis.width ? 'end' : 'middle';
    return { at, time, label, dated: form !== 'clock', anchor };
  };
  const left = (t: AxisTick) => t.at - labelWidth(t.label) * { start: 0, middle: 0.5, end: 1 }[t.anchor];
  const right = (t: AxisTick) => left(t) + labelWidth(t.label);
  const clear = (a: AxisTick, b: AxisTick) => right(a) + 8 <= left(b);

  const ticks: AxisTick[] = [make(axis.x(from), from, startClock ? 'dateClock' : 'date', true)];
  let dated = ticks[0] as AxisTick;
  const push = (t: AxisTick) => {
    ticks.push(t);
    if (t.dated) dated = t;
  };
  // A dated tick names its year where the dated tick before it is of another year.
  const datedTick = (at: number, t: number, form: Form, after: AxisTick = dated) => make(at, t, form, yearOf(t) !== yearOf(after.time));

  const far = axis.cuts.map((c) => ({ at: c.x1, time: c.to, far: true }));
  let farDone = 0;
  // A cut's far side's labels, its time of day first where it has one.
  const farTicks = (f: (typeof far)[number], after: AxisTick) =>
    (clocked(f.time) ? (['dateClock', 'date'] as const) : (['date'] as const)).map((form) => datedTick(f.at, f.time, form, after));
  // The far sides still to come, each in its widest label or its shortest,
  // labelled after `after`. Labelled after a later dated tick, as they will
  // be, they can only be narrower.
  const farAhead = (keep: 'widest' | 'shortest' | 'none', after: AxisTick) =>
    keep === 'none' ? [] : far.slice(farDone).map((f) => farTicks(f, after).at(keep === 'widest' ? 0 : -1) as AxisTick);

  const round = (at: number, t: number): AxisTick => {
    if (unit === 'month') return datedTick(at, t, 'month');
    if (unit === 'day') return datedTick(at, t, 'date');
    if (dayOf(t) !== dayOf(dated.time)) return datedTick(at, t, t % DAY === 0 ? 'date' : 'dateClock');
    if (scrolls && at - dated.at >= (every * 2) / 3) return datedTick(at, t, 'dateClock');
    return make(at, t, 'clock', false);
  };

  // The dated tick that keeps the screenful after the last dated one: as far
  // along as a screenful allows, short of a cut, clear of the label before
  // it and of those it should leave room for after it, the round tick `next`
  // and the far sides to come. Its place is settled first and its label is
  // then written from the time there; the room left after it is reckoned
  // with the labels after it at their widest. Where it cannot fit, it gives
  // up `next`'s room, then the times of day before it give way, then the far
  // sides' times of day, then their room, and then it moves back, or else on.
  const fill = (next: AxisTick | null, until: number): AxisTick | null => {
    const levels = [
      ...(next === null ? [] : [{ next, keep: 'widest' as const }]),
      ...(['widest', 'shortest', 'none'] as const).map((keep) => ({ next: null, keep })),
    ];
    for (const level of levels) {
      for (;;) {
        const prev = ticks.at(-1) as AxisTick;
        const after = [...(level.next === null ? [] : [level.next]), ...farAhead(level.keep, dated)];
        let reach = 0;
        for (const form of ['dateClock', 'date'] as const) {
          let at = Math.min(dated.at + every, axis.width, ...after.map((t) => left(t) - 8 - WIDEST[form] / 2));
          const cut = axis.cuts.find((c) => at > c.x0 && at < c.x1);
          if (cut) at = cut.x0;
          reach = at;
          const tick = datedTick(at, axis.time(at), form);
          if (clear(prev, tick) && after.every((t) => clear(tick, t))) return tick;
        }
        // Last of all, the furthest place back from there that a date fits:
        // an earlier one can be shorter, without a year the later names, or,
        // near the line's end, centred rather than ending at its tick. Failing
        // that, the nearest place on, short of `until`.
        if (prev.dated && level === levels.at(-1)) {
          const date = (at: number) => datedTick(at, axis.time(at), 'date');
          const fits = (at: number) => !axis.cuts.some((c) => at > c.x0 && at < c.x1) && clear(prev, date(at));
          for (let at = reach - 0.5; at > prev.at; at -= 0.5) if (fits(at)) return date(at);
          for (let at = reach + 0.5; at < until && at <= axis.width; at += 0.5) if (fits(at)) return date(at);
        }
        if (prev.dated) break;
        ticks.pop();
      }
    }
    return null;
  };

  const rounds = times.filter((t) => t > from && !axis.cuts.some((c) => t > c.from && t < c.to));
  const queue = [...rounds.map((t) => ({ at: axis.x(t), time: t, far: false })), ...far].sort(
    (a, b) => a.at - b.at || Number(b.far) - Number(a.far),
  );
  for (const c of [...queue, null]) {
    const until = c === null ? axis.width : c.at;
    while (scrolls && until - dated.at > (c === null ? last : every)) {
      const tick = fill(c === null || c.far ? null : round(c.at, c.time), c === null ? Infinity : c.at);
      if (tick === null) break;
      push(tick);
    }
    if (c === null) break;
    const prev = ticks.at(-1) as AxisTick;
    if (c.far) {
      const tick = farTicks(c, dated).find((t) => clear(prev, t));
      farDone++;
      if (tick) push(tick);
      continue;
    }
    const tick = round(c.at, c.time);
    if (clear(prev, tick) && farAhead('widest', tick.dated ? tick : dated).every((f) => clear(tick, f))) push(tick);
  }
  return ticks;
}
