import { describe, expect, it } from 'vitest';
import { at } from './stats/testing';
import {
  DATED_EVERY,
  DATED_LEAST,
  type AxisTick,
  labelWidth,
  type AxisCut,
  type AxisItem,
  axisTicks,
  formatElapsed,
  formatElapsedShort,
  formatMoment,
  timeAxis,
} from './timeline-axis';

describe('formatMoment and formatElapsed', () => {
  it('writes a moment to the minute, in UTC', () => {
    expect(formatMoment(at('2026-08-14T09:12:59Z'))).toBe('14 Aug 2026 09:12 UTC');
  });

  it('writes an elapsed time short, for a label beside a mark', () => {
    expect(formatElapsedShort(0)).toBe('<1 min');
    expect(formatElapsedShort(37 * 60)).toBe('37 min');
    expect(formatElapsedShort(37 * 3600)).toBe('37 h');
    expect(formatElapsedShort(9.8 * 86400)).toBe('9.8 d');
    expect(formatElapsedShort(30 * 86400)).toBe('30 d');
  });

  it('writes an elapsed time in minutes under an hour, else as the page writes durations', () => {
    expect(formatElapsed(20)).toBe('under a minute');
    expect(formatElapsed(40 * 60)).toBe('40 minutes');
    expect(formatElapsed(3 * 3600)).toBe('3 hours');
    expect(formatElapsed(12 * 86400)).toBe('12 days');
  });
});

describe('timeAxis', () => {
  const OPTS = { available: 1000, sep: 10, breakWidth: 50 };
  const items = (list: [number, number][]): AxisItem[] => list.map(([t, row]) => ({ at: t, row }));

  it('is linear in time where nothing crowds', () => {
    const axis = timeAxis(items([[0, 0], [100, 1], [400, 0], [1000, 2]]), OPTS);
    expect(axis.width).toBe(1000);
    expect(axis.xs).toEqual([0, 100, 400, 1000]);
    expect(axis.cuts).toEqual([]);
    expect(axis.stretches).toEqual([]);
    expect(axis.x(700)).toBe(700);
  });

  it('keeps marks at one moment in different rows together, and spreads those in one row', () => {
    const axis = timeAxis(items([[0, 0], [0, 1], [0, 1], [1000, 0]]), OPTS);
    expect(axis.xs[0]).toBe(axis.xs[1]);
    expect((axis.xs[2] as number) - (axis.xs[1] as number)).toBe(10);
    expect(axis.stretches).toHaveLength(1);
    expect(axis.stretches[0]).toMatchObject({ from: 0, to: 0, count: 3 });
  });

  it('cuts a long quiet stretch out of a crowded timeline and labels it', () => {
    const day = 86400;
    // A first commit a year before a busy day: thirty events an hour apart.
    const busy = Array.from({ length: 30 }, (_, i): [number, number] => [365 * day + i * 3600, 0]);
    const axis = timeAxis(items([[0, 3], ...busy]), OPTS);
    expect(axis.cuts).toEqual([{ from: 0, to: 365 * day, x0: 0, x1: 50 }]);
    expect(axis.width).toBe(1000);
    const xs = axis.xs.slice(1);
    const gaps = xs.slice(1).map((x, i) => x - (xs[i] as number));
    // The busy day takes the rest of the width, an hour per even step.
    for (const g of gaps) expect(g).toBeCloseTo(950 / 29, 6);
    expect(axis.stretches).toEqual([]);
  });

  it('keeps a long wait at its length when it does not dwarf the rest of the line', () => {
    const day = 86400;
    // A burst on each of three days, 20 and 60 days apart: crowded, but no stretch is three times the rest.
    const burst = (t: number) => Array.from({ length: 5 }, (_, i): [number, number] => [t + i, 0]);
    const axis = timeAxis(items([...burst(0), ...burst(20 * day), ...burst(80 * day)]), OPTS);
    expect(axis.stretches.length).toBe(3);
    expect(axis.cuts).toEqual([]);
  });

  it('cuts only the stretch that dwarfs the rest, one at a time', () => {
    const day = 86400;
    const busy = Array.from({ length: 30 }, (_, i): [number, number] => [400 * day + i * 60, 0]);
    // A first commit 400 days out, then a 3-day and a 9-day wait around a busy half hour.
    const axis = timeAxis(items([[0, 3], [397 * day, 3], ...busy, [409 * day, 3]]), OPTS);
    expect(axis.cuts.map((c) => [c.from, c.to])).toEqual([[0, 397 * day]]);
  });

  it('stops cutting once the rest of the line has room for its marks', () => {
    // #73432: a first commit 1,552 days before an opening and a draft at one
    // moment, a last commit 3 days on, a command and a force-push within two
    // hours of it, and still open 9.7 days later.
    const day = 86400;
    const last = 2.96 * day;
    const axis = timeAxis(
      items([
        [-1552 * day, 3],
        [0, 3],
        [0, 3],
        [last, 3],
        [last + 52 * 60, 2],
        [last + 123 * 60, 3],
        [12.7 * day, 3],
      ]),
      OPTS,
    );
    expect(axis.cuts.map((c) => [c.from, c.to])).toEqual([[-1552 * day, 0]]);
  });

  it('does not cut a long stretch when nothing crowds', () => {
    const day = 86400;
    const axis = timeAxis(items([[0, 3], [10 * day, 3], [12 * day, 0]]), OPTS);
    expect(axis.cuts).toEqual([]);
    expect(axis.xs.map(Math.round)).toEqual([0, 833, 1000]);
  });

  it('grows wider than the space when the marks alone need more, keeping each a step apart', () => {
    const many = Array.from({ length: 200 }, (_, i): [number, number] => [i, i % 2]);
    const axis = timeAxis(items(many), OPTS);
    expect(axis.width).toBeGreaterThan(1000);
    for (let i = 2; i < 200; i++) expect((axis.xs[i] as number) - (axis.xs[i - 2] as number)).toBeGreaterThanOrEqual(10 - 1e-9);
    // Evenly spaced, they need no stretch: the line stays linear, only longer.
    expect(axis.stretches).toEqual([]);
  });

  it('stretches a burst just enough to set its marks a step apart, and says where', () => {
    const burst = Array.from({ length: 10 }, (_, i): [number, number] => [i, 0]);
    const axis = timeAxis(items([...burst, [1000, 0]]), OPTS);
    expect(axis.width).toBe(1000);
    expect(axis.xs.slice(0, 10).map((x) => Math.round(x))).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90]);
    expect(axis.stretches).toEqual([{ from: 0, to: 9, x0: 0, x1: 90, count: 10 }]);
    // Past the burst, time is linear again: the last step is its 991 seconds at the scale.
    expect((axis.xs[10] as number) - 90).toBeCloseTo(991 * axis.scale, 6);
  });

  it('maps a time inside a cut proportionally across the cut, and any time monotonically', () => {
    const day = 86400;
    const busy = Array.from({ length: 30 }, (_, i): [number, number] => [365 * day + i * 3600, 0]);
    const axis = timeAxis(items([[0, 3], ...busy]), OPTS);
    expect(axis.x(182.5 * day)).toBeCloseTo(25, 6);
    let prev = -Infinity;
    for (let t = -day; t < 367 * day; t += day / 3) {
      const x = axis.x(t);
      expect(x).toBeGreaterThanOrEqual(prev);
      prev = x;
    }
  });

  it('reads the last moment’s time across its whole spread, never a time past it', () => {
    // A comment, then a day later fifty commands at one second, spread a step
    // apart: the last moment covers most of the line.
    const day = 86400;
    const axis = timeAxis(items([[0, 0], ...Array.from({ length: 50 }, (): [number, number] => [day, 0])]), OPTS);
    const [first, last] = [axis.xs[1] as number, axis.xs.at(-1) as number];
    expect(last - first).toBe(49 * 10);
    expect(axis.time(first)).toBe(day);
    expect(axis.time((first + last) / 2)).toBe(day);
    expect(axis.time(last)).toBe(day);
    expect(axis.time(first / 2)).toBeCloseTo(day / 2, 6);
  });

  it('lays out a lone item at the start', () => {
    const axis = timeAxis(items([[500, 0]]), OPTS);
    expect(axis.xs).toEqual([0]);
    expect(axis.width).toBe(1000);
  });
});

describe('axisTicks', () => {
  const day = 86400;
  const start = at('2026-08-03T00:00:00Z');
  const OPTS = { available: 1000, sep: 10, breakWidth: 50 };

  it('marks midnights when a day is wide enough for a label, the first with its year', () => {
    const axis = timeAxis([{ at: start, row: 0 }, { at: start + 10 * day, row: 0 }], OPTS);
    const ticks = axisTicks(axis, 64);
    expect(ticks.map((t) => t.label)).toEqual([
      '3 Aug 2026',
      '4 Aug',
      '5 Aug',
      '6 Aug',
      '7 Aug',
      '8 Aug',
      '9 Aug',
      '10 Aug',
      '11 Aug',
      '12 Aug',
      '13 Aug',
    ]);
    expect(ticks.map((t) => Math.round(t.at))).toEqual([0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]);
  });

  it('steps by hours within a day, the line’s start giving its date and time, a new day its date', () => {
    const axis = timeAxis([{ at: start + 6 * 3600, row: 0 }, { at: start + 30 * 3600, row: 0 }], OPTS);
    // 09:00 is left out, its label under the start's.
    expect(axisTicks(axis, 64).map((t) => t.label)).toEqual([
      '3 Aug 2026 06:00',
      '12:00',
      '15:00',
      '18:00',
      '21:00',
      '4 Aug',
      '03:00',
      '06:00',
    ]);
  });

  it('steps by minutes on a line of minutes, so a six-minute PR has ticks', () => {
    // #69032 lasted six minutes; its line is 968 pixels.
    const t0 = at('2026-08-03T09:00:00Z');
    const axis = timeAxis([{ at: t0, row: 3 }, { at: t0 + 360, row: 3 }], { ...OPTS, available: 968 });
    const ticks = axisTicks(axis, 72);
    expect(ticks.map((t) => t.label)).toEqual(['3 Aug 2026 09:00', '09:01', '09:02', '09:03', '09:04', '09:05', '09:06']);
    expect(ticks[0]?.anchor).toBe('start');
    expect(ticks.at(-1)?.anchor).toBe('end');
  });

  it('dates the line’s start with its year, with a cut or without', () => {
    const plain = timeAxis([{ at: start, row: 0 }, { at: start + 3 * day, row: 0 }], OPTS);
    expect(axisTicks(plain, 72)[0]).toMatchObject({ at: 0, label: '3 Aug 2026', dated: true });
    // A first commit a year before a busy day: the first round tick would fall in the cut.
    const busy = Array.from({ length: 30 }, (_, i) => ({ at: start + 365 * day + 3600 + i * 3600, row: 0 }));
    const cut = timeAxis([{ at: start + 3600, row: 3 }, ...busy], OPTS);
    expect(cut.cuts).toHaveLength(1);
    const first = axisTicks(cut, 72)[0];
    expect(first).toMatchObject({ at: 0, label: '3 Aug 2026 01:00', dated: true });
    // The busy day is in 2027: its first day tick names the new year.
    expect(axisTicks(cut, 72).find((t) => t.time > (cut.cuts[0] as AxisCut).to && t.dated)?.label).toMatch(/2027/);
  });

  /** Two labels' extents overlap: ticks' labels must not. */
  function overlaps(ticks: readonly AxisTick[]): boolean {
    const spans = ticks.map((t) => {
      const w = labelWidth(t.label);
      return t.anchor === 'start' ? [t.at, t.at + w] : t.anchor === 'end' ? [t.at - w, t.at] : [t.at - w / 2, t.at + w / 2];
    });
    return spans.some((s, i) => i > 0 && (s[0] as number) < ((spans[i - 1] as number[])[1] as number));
  }

  // A screenful is the width given, at most DATED_EVERY and at least
  // DATED_LEAST. The line starts at midnight, or at 10:07 so that the start's
  // label, with its time, is long.
  it.each([
    { available: 1000, screen: DATED_EVERY, offset: 0, begins: '00:00' },
    { available: 1000, screen: DATED_EVERY, offset: 10 * 3600 + 7 * 60, begins: '10:07' },
    { available: 236, screen: 236, offset: 0, begins: '00:00' },
    { available: 236, screen: 236, offset: 10 * 3600 + 7 * 60, begins: '10:07' },
  ])('dates a tick in every $screen-pixel screenful of a line too long for a $available-pixel page, starting at $begins', ({ available, screen, offset }) => {
    // 600 marks of one row in bursts over three days: a line of about 7,000 pixels.
    const items: AxisItem[] = [];
    for (let b = 0; b < 30; b++) for (let i = 0; i < 20; i++) items.push({ at: start + offset + b * 3 * 3600 + i * 30, row: 0 });
    const axis = timeAxis(items, { ...OPTS, available });
    expect(axis.width).toBeGreaterThan(7000);
    const ticks = axisTicks(axis, 72);
    // Any screenful of the line (900 pixels, or the width given when less) holds a dated tick: no two dated ticks, nor
    // the last and the line's end, are further apart.
    const dated = [...ticks.filter((t) => t.dated).map((t) => t.at), axis.width];
    expect(dated[0]).toBe(0);
    for (let i = 1; i < dated.length; i++) {
      expect((dated[i] as number) - (dated[i - 1] as number), `after ${dated[i - 1]}`).toBeLessThanOrEqual(screen + 1e-9 * screen);
    }
    expect(overlaps(ticks)).toBe(false);
  });

  it('dates every window of a 206-pixel view onto a line too long for it', () => {
    // The view shows the 174 pixels the line is given and a 16-pixel margin
    // at each end. 600 marks in bursts over three days.
    const items: AxisItem[] = [];
    for (let b = 0; b < 30; b++) for (let i = 0; i < 20; i++) items.push({ at: start + 36420 + b * 3 * 3600 + i * 30, row: 0 });
    const axis = timeAxis(items, { ...OPTS, available: 174 });
    const ticks = axisTicks(axis, 72, 16);
    const dated = ticks.filter((t) => t.dated).map((t) => t.at);
    for (let x = -16; x + 206 <= axis.width + 16; x++) {
      expect(dated.some((at) => at >= x && at <= x + 206), `the window from ${x}`).toBe(true);
    }
    expect(ticks[0]?.label).toBe('3 Aug 2026 10:07');
    expect(overlaps(ticks)).toBe(false);
  });

  it('dates the end of a short line on a 166-pixel view where a date without its year fits', () => {
    // Evening marks on 30 November, then 1 December's in two other rows: the
    // line is 165 pixels, a little wider than the 134 it is given, and its end
    // needs a date.
    const t0 = at('2026-11-30T21:21:00Z');
    const items: AxisItem[] = [
      ...Array.from({ length: 9 }, (_, i) => ({ at: t0 + i * 900, row: 0 })),
      { at: at('2026-12-01T00:36:00Z'), row: 1 },
      { at: at('2026-12-01T00:36:00Z'), row: 1 },
      ...Array.from({ length: 3 }, (_, i) => ({ at: at('2026-12-01T05:36:00Z') + i * 900, row: 2 })),
    ];
    const axis = timeAxis(items, { ...OPTS, sep: 12, available: 134 });
    expect(axis.width).toBe(165);
    const ticks = axisTicks(axis, 72, 16);
    const dated = ticks.filter((t) => t.dated).map((t) => t.at);
    for (let x = -16; x + 166 <= axis.width + 16; x++) {
      expect(dated.some((at) => at >= x && at <= x + 166), `the window from ${x}`).toBe(true);
    }
    expect(ticks.find((t) => t.time >= at('2026-12-01T00:00:00Z'))?.label).toMatch(/^1 Dec/);
    expect(overlaps(ticks)).toBe(false);
  });

  it('dates the far side of a cut, displacing a round tick rather than leaving it undated', () => {
    // A busy morning to 15:00, a quiet year, and a busy morning: the year is
    // cut out mid-line, and the 15:00 tick, on three-hour steps, sits at the
    // cut's near side, where the far side's label would cover it.
    const busy = (t0: number) => Array.from({ length: 31 }, (_, i) => ({ at: t0 + i * 1800, row: 0 }));
    const axis = timeAxis([...busy(start), ...busy(start + 366 * day)], OPTS);
    const cut = axis.cuts[0] as AxisCut;
    expect(cut).toMatchObject({ from: start + 15 * 3600, to: start + 366 * day });
    const ticks = axisTicks(axis, 72);
    expect(ticks.find((t) => t.time === cut.to)).toMatchObject({ at: cut.x1, dated: true, label: '4 Aug 2027' });
    expect(ticks.some((t) => t.time === cut.from)).toBe(false);
    expect(ticks.some((t) => t.time === start + 12 * 3600)).toBe(true);
    expect(overlaps(ticks)).toBe(false);
  });

  it('names a new year after a cut even when the tick that first named it gives way', () => {
    // Busy until midnight on 31 December, then cut to March: the "1 Jan 2027"
    // tick at the cut's near side gives way to the far side's.
    const eve = at('2026-12-31T15:00:00Z');
    const march = at('2027-03-01T00:00:00Z');
    const busy = (t0: number) => Array.from({ length: 19 }, (_, i) => ({ at: t0 + i * 1800, row: 0 }));
    const axis = timeAxis([...busy(eve), ...busy(march)], OPTS);
    expect(axis.cuts[0]).toMatchObject({ from: at('2027-01-01T00:00:00Z'), to: march });
    const labels = axisTicks(axis, 72).map((t) => t.label);
    expect(labels.some((l) => l.includes('2027'))).toBe(true);
    expect(labels).toContain('1 Mar 2027');
  });

  it('leaves a cut’s far side to the cut’s note when the start’s label covers it', () => {
    const busy = Array.from({ length: 30 }, (_, i) => ({ at: start + 365 * day + 3600 + i * 3600, row: 0 }));
    const axis = timeAxis([{ at: start + 3600, row: 3 }, ...busy], OPTS);
    const cut = axis.cuts[0] as AxisCut;
    expect(axisTicks(axis, 72).some((t) => t.time === cut.to)).toBe(false);
  });

  it('dates the ticks across a last moment’s spread with that moment', () => {
    // A comment, then a day later fifty commands at one second: on a phone the
    // spread of the commands scrolls, and each screenful of it is dated.
    const t0 = at('2026-08-03T10:07:00Z');
    const items: AxisItem[] = [{ at: t0, row: 0 }, ...Array.from({ length: 50 }, () => ({ at: t0 + day, row: 0 }))];
    const axis = timeAxis(items, { available: 236, sep: 12, breakWidth: 64 });
    const spread = axisTicks(axis, 72).filter((t) => t.at >= (axis.xs[1] as number));
    expect(spread.length).toBeGreaterThan(1);
    for (const t of spread) expect(t).toMatchObject({ time: t0 + day, label: '4 Aug 10:07' });
  });

  it('writes a fill tick’s date from where the tick ends up, when it gives way to the round tick after it', () => {
    // Six-hourly marks for ten days, one mark a year on, and a busy morning:
    // no wait dwarfs the rest, so nothing is cut, and at 280 pixels the line
    // scrolls on month ticks. The tick filling the screenful after the tenth
    // day gives way to "Jul" and is drawn back in the spring.
    const series = (t0: number, n: number, step: number) => Array.from({ length: n }, (_, i) => ({ at: t0 + i * step, row: 0 }));
    const items = [
      ...series(at('2027-01-01T00:00:00Z'), 40, 6 * 3600),
      { at: at('2028-02-23T00:00:00Z'), row: 0 },
      ...series(at('2028-09-10T00:00:00Z'), 77, 300),
    ];
    const axis = timeAxis(items, { available: 280, sep: 12, breakWidth: 64 });
    expect(axis.cuts).toEqual([]);
    const ticks = axisTicks(axis, 72);
    const fill = ticks.find((t) => t.time > at('2027-01-11T00:00:00Z') && t.time < at('2027-07-01T00:00:00Z')) as AxisTick;
    expect(ticks[ticks.indexOf(fill) + 1]?.label).toBe('Jul');
    expect(fill.time).toBe(axis.time(fill.at));
    for (const t of ticks) expect(writings(t.time), `"${t.label}" at ${t.at}`).toContain(t.label);
  });

  it('leaves out the ticks inside a cut', () => {
    const busy = Array.from({ length: 30 }, (_, i) => ({ at: start + 365 * day + i * 3600, row: 0 }));
    const axis = timeAxis([{ at: start, row: 3 }, ...busy], OPTS);
    const ticks = axisTicks(axis, 64);
    const cut = axis.cuts[0] as AxisCut;
    expect(ticks.length).toBeGreaterThan(3);
    expect(ticks.every((t) => t.time <= cut.from || t.time >= cut.to)).toBe(true);
  });
});

// The ways a tick may write its time: a clock, a month, a day, a day and a
// clock, each of the last three with its year or without. Written here, apart
// from the code under test, so a label is checked against its time and not
// against how the code built it.
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n: number) => String(n).padStart(2, '0');
function writings(t: number): string[] {
  const d = new Date(t * 1000);
  const hm = `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
  const y = d.getUTCFullYear();
  const mon = MON[d.getUTCMonth()] as string;
  const date = `${d.getUTCDate()} ${mon}`;
  return [hm, mon, `${mon} ${y}`, date, `${date} ${y}`, `${date} ${hm}`, `${date} ${y} ${hm}`];
}

/**
 * Every way a set of ticks breaks the axis's promises; empty when it keeps them. `margin` is the room the page draws
 * past each end of the line.
 */
function broken(axis: ReturnType<typeof timeAxis>, ticks: readonly AxisTick[], margin = 0): string[] {
  const out: string[] = [];
  const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 16);
  let prev: AxisTick | null = null;
  let dated: AxisTick | null = null;
  const spans = ticks.map((t) => {
    const w = labelWidth(t.label);
    return t.anchor === 'start' ? [t.at, t.at + w] : t.anchor === 'end' ? [t.at - w, t.at] : [t.at - w / 2, t.at + w / 2];
  }) as [number, number][];
  ticks.forEach((t, i) => {
    const say = (what: string) => out.push(`"${t.label}" at ${t.at.toFixed(1)} (${iso(t.time)}): ${what}`);
    if (!writings(t.time).includes(t.label)) say('the label does not write the tick’s time');
    if (t.time < axis.from || t.time > axis.to) say(`the time is off the line, ${iso(axis.from)} to ${iso(axis.to)}`);
    if (Math.abs(axis.time(t.at) - t.time) > 1) say(`the axis puts ${iso(axis.time(t.at))} there`);
    if (prev !== null && (t.at <= prev.at || t.time < prev.time)) say(`it does not follow "${prev.label}"`);
    const [l, r] = spans[i] as [number, number];
    if (l < -0.01 || r > axis.width + 0.01) say('the label runs off the line');
    if (i > 0 && l < (spans[i - 1] as [number, number])[1] + 8 - 0.01) say(`the label is within 8 pixels of "${prev?.label}"`);
    const year = /\b\d{4}\b/.exec(t.label);
    const isDated = /[A-Z]/.test(t.label);
    if (isDated !== t.dated) say(`dated is ${t.dated}`);
    if (isDated && year === null && (dated === null || new Date(dated.time * 1000).getUTCFullYear() !== new Date(t.time * 1000).getUTCFullYear()))
      say('a new year is not named');
    if (!isDated && (dated === null || Math.floor(dated.time / 86400) !== Math.floor(t.time / 86400))) say('a clock alone on a new day');
    if (isDated) dated = t;
    prev = t;
  });
  if (ticks[0]?.at !== 0 || !ticks[0]?.dated) out.push('the line’s start is not dated');
  if (axis.width > axis.available + 1) {
    // The page shows the width given and a margin past each end. Every window as wide as that view holds a dated tick:
    // no two are further apart than the view, nor the last further from the line's end than the view less a margin.
    // A wide page keeps its dates closer, the width given apart and at most DATED_EVERY.
    const view = axis.available + 2 * margin;
    const screen = Math.min(DATED_EVERY, Math.max(DATED_LEAST, axis.available), view);
    const end = Math.min(screen, view - margin);
    type Dated = { t: AxisTick; right: number };
    const dated: Dated[] = ticks.flatMap((t, i) => (t.dated ? [{ t, right: (spans[i] as [number, number])[1] }] : []));
    // Whether a date, written as briefly as it can be, fits at `at`, outside a cut, clear of the dated tick before it
    // with a pixel to spare, so that the half-pixel steps the axis tries cannot miss it.
    const fits = (before: Dated, at: number) => {
      if (at <= before.t.at || at > axis.width || axis.cuts.some((c) => at > c.x0 && at < c.x1)) return false;
      const d = new Date(axis.time(at) * 1000);
      const year = d.getUTCFullYear() === new Date(before.t.time * 1000).getUTCFullYear() ? '' : ` ${d.getUTCFullYear()}`;
      const w = labelWidth(`${d.getUTCDate()} ${MON[d.getUTCMonth()] as string}${year}`);
      const left = at - w / 2 < 0 ? at : at + w / 2 > axis.width ? at - w : at - w / 2;
      return left >= before.right + 9;
    };
    // Dated ticks further apart are allowed only where no date fits within reach of the one before, and then only as
    // far as the first place past it where one does.
    dated.forEach((before, i) => {
      const next = dated[i + 1]?.t.at ?? axis.width;
      const reach = i + 1 < dated.length ? screen : end;
      if (next - before.t.at <= reach + 0.01) return;
      const where = `${(next - before.t.at).toFixed(1)} pixels after "${before.t.label}" at ${before.t.at.toFixed(1)}, in a ${view}-pixel view`;
      for (let at = Math.min(before.t.at + reach, axis.width); at > before.t.at; at -= 0.5)
        if (fits(before, at)) return void out.push(`no dated tick for ${where}, though a date fits at ${at.toFixed(1)}`);
      for (let at = before.t.at + reach; at < next - 0.5; at += 0.5)
        if (fits(before, at)) return void out.push(`no dated tick for ${where}, though past reach one first fits at ${at.toFixed(1)}`);
    });
  }
  return out;
}

/** Every way `axis.time` leaves the line, falls back, or misses a mark's own time. */
function strays(axis: ReturnType<typeof timeAxis>, items: readonly AxisItem[]): string[] {
  const out: string[] = [];
  let last = -Infinity;
  for (let x = 0; x <= axis.width; x += 0.5) {
    const t = axis.time(x);
    if (t < axis.from || t > axis.to) out.push(`at ${x}: ${new Date(t * 1000).toISOString()} is off the line`);
    if (t < last) out.push(`at ${x}: earlier than at ${x - 0.5}`);
    last = t;
  }
  items.forEach((it, i) => {
    if (axis.time(axis.xs[i] as number) !== it.at) out.push(`mark ${i} at ${axis.xs[i]}: ${axis.time(axis.xs[i] as number)}, not ${it.at}`);
  });
  return out;
}

describe('the axis’s promises, over generated lines', () => {
  // Exhaustive over generated lines and widths; a loaded CI runner has taken more than the default five seconds.
  const SLOW = 30_000;

  // Widths given with no margin, and views 166, 206, 221 and 236 pixels wide,
  // the narrowest the page has been measured to show of the line, of which the
  // line is given all but a 16-pixel margin at each end.
  const WIDTHS = [
    ...[236, 280, 320, 600, 1000].map((available) => ({ available, margin: 0 })),
    ...[166, 206, 221, 236].map((view) => ({ available: view - 32, margin: 16 })),
  ];
  const SEP = 12;
  const OPTS = { sep: SEP, breakWidth: 64 };

  // mulberry32: the same lines on every run.
  function random(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const burst = (t0: number, n: number, step: number, row: number): AxisItem[] =>
    Array.from({ length: n }, (_, i) => ({ at: t0 + i * step, row }));

  const H = 3600;
  const D = 86400;
  const named: [string, AxisItem[]][] = [
    ['one moment, 200 marks of one row', burst(at('2026-08-03T10:07:00Z'), 200, 0, 0)],
    ['a mark, then 50 of one row at one moment', [{ at: at('2026-08-03T10:07:00Z'), row: 0 }, ...burst(at('2026-08-04T10:07:00Z'), 50, 0, 0)]],
    ['50 of one row at one moment, then a mark', [...burst(at('2026-08-03T10:07:00Z'), 50, 0, 0), { at: at('2026-08-04T10:07:00Z'), row: 0 }]],
    [
      'cuts at the start, the middle and the end',
      [
        { at: at('2025-01-10T09:13:00Z'), row: 3 },
        ...burst(at('2026-03-03T10:07:00Z'), 80, 60, 0),
        ...burst(at('2026-09-03T14:00:00Z'), 80, 60, 0),
        { at: at('2027-06-01T08:00:00Z'), row: 3 },
      ],
    ],
    ['a burst across midnight', burst(at('2026-08-03T23:20:00Z'), 300, 20, 0)],
    ['a burst across a new year', burst(at('2026-12-31T23:20:00Z'), 300, 20, 0)],
    ['a new year, then a cut of a year', [...burst(at('2026-12-31T23:40:00Z'), 14, 300, 0), ...burst(at('2028-01-04T10:00:00Z'), 200, 60, 0)]],
    ['a comment a day for a month', burst(at('2026-08-03T10:07:00Z'), 31, D, 1)],
    ['a burst a week for a year', Array.from({ length: 52 }, (_, w) => burst(at('2026-01-05T09:00:00Z') + w * 7 * D, 12, 60, w % 3)).flat()],
  ];

  function generated(seed: number): AxisItem[] {
    const rnd = random(seed);
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)] as T;
    const starts = ['2026-08-03T10:07:00Z', '2026-08-03T23:31:00Z', '2026-12-31T22:05:00Z', '2025-06-30T00:00:00Z'];
    let t = at(pick(starts)) + Math.floor(rnd() * 40) * 60;
    const items: AxisItem[] = [];
    const parts = 1 + Math.floor(rnd() * 6);
    for (let p = 0; p < parts; p++) {
      const row = Math.floor(rnd() * 4);
      if (rnd() < 0.2) {
        items.push(...burst(t, 2 + Math.floor(rnd() * 60), 0, row));
      } else {
        const step = pick([0, 1, 10, 30, 60, 300, 900, H, 6 * H, D]);
        const n = 1 + Math.floor(rnd() * (rnd() < 0.5 ? 10 : 150));
        items.push(...burst(t, n, step, row));
        t += (n - 1) * step;
      }
      t += pick([60, H, 6 * H, D, 30 * D, 200 * D, 400 * D]);
    }
    return items;
  }
  const lines: [string, AxisItem[]][] = [...named, ...Array.from({ length: 160 }, (_, s): [string, AxisItem[]] => [`seed ${s}`, generated(s)])];

  it('reads a time on the line at every place, rising with it, and each mark’s own time at its place', () => {
    const failures: string[] = [];
    for (const [name, items] of lines)
      for (const { available } of WIDTHS)
        for (const s of strays(timeAxis(items, { ...OPTS, available }), items).slice(0, 1)) failures.push(`${name} at ${available}: ${s}`);
    expect({ count: failures.length, first: failures.slice(0, 5) }).toEqual({ count: 0, first: [] });
  }, SLOW);

  it('labels every tick with its own time, dates every screenful, names each new year and overlaps no label', () => {
    const failures: string[] = [];
    const linesByWidth: Record<string, number> = {};
    for (const { available, margin } of WIDTHS)
      for (const [name, items] of lines) {
        const axis = timeAxis(items, { ...OPTS, available });
        const width = `${available}+2×${margin}`;
        for (const s of broken(axis, axisTicks(axis, 72, margin), margin).slice(0, 1)) {
          failures.push(`${name} at ${width}: ${s}`);
          linesByWidth[width] = (linesByWidth[width] ?? 0) + 1;
        }
      }
    expect({ count: failures.length, linesByWidth, first: failures.slice(0, 5) }).toEqual({ count: 0, linesByWidth: {}, first: [] });
  }, SLOW);
});
