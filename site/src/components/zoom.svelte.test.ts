// @vitest-environment jsdom
// Dragging across a chart of the report sets the report's period: the filter
// bar, the address and every section follow, and the status line says the
// new period once. jsdom lays nothing out, so every plot is 640px wide and a
// pointer's clientX is its x in the plot.
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { get } from 'svelte/store';
import { beforeAll, describe, expect, it } from 'vitest';
import App from '../App.svelte';
import { fixturePage } from '../lib/__fixtures__/page';
import { DAY, dayStart } from '../lib/filters';
import { timeColumns } from '../lib/plot';
import { buckets } from '../lib/stats/buckets';
import { periodZoom } from '../lib/zoom';

beforeAll(() => {
  window.matchMedia = (query: string) =>
    ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;
});

const HINT = 'Drag across a chart to zoom to that range';
const status = () => document.querySelector('p.loading') as HTMLElement;
const point = (x: number) => ({ clientX: x, clientY: 100, pointerId: 1, isPrimary: true, button: 0 });

async function drag(target: Element, from: number, to: number) {
  await fireEvent.pointerDown(target, point(from));
  await fireEvent.pointerMove(target, point(to));
  await fireEvent.pointerUp(target, point(to));
  await fireEvent.click(target, { detail: 1 });
  await tick();
}

/** The fixture's whole window, as the charts draw it: a week a column. */
const weeks = buckets({ start: dayStart('2026-05-15') as number, end: (dayStart('2026-11-15') as number) + DAY }).starts;
const cols = timeColumns(640, weeks.length);
const column = (monday: string) => weeks.indexOf(dayStart(monday) as number);

function brushOf(figure: RegExp): Element {
  return screen.getByRole('figure', { name: figure }).querySelector('.brush') as Element;
}

describe('zooming the report from a chart', () => {
  it('sets the period from a drag across the first chart, which the address and the filter bar follow', async () => {
    const { props, loc } = await fixturePage('#/?week=2026-06-08');
    render(App, props);
    const from = screen.getByLabelText('From') as HTMLInputElement;
    expect(from.value).toBe('2026-05-15');
    await drag(brushOf(/^PRs opened, merged and closed unmerged, per /), cols.centre(column('2026-06-29')), cols.centre(column('2026-07-20')));
    expect(loc.hash()).toBe('#/?target=main&from=2026-06-29&to=2026-07-26');
    expect(from.value).toBe('2026-06-29');
    expect((screen.getByLabelText('To') as HTMLInputElement).value).toBe('2026-07-26');
    // The week chosen before is outside the new period, so it is cleared, as any change of the period clears it.
    expect(get(props.page.selection).week).toBeNull();
  });

  it('says the new period once on the status line, until the next change', async () => {
    const { props } = await fixturePage('');
    render(App, props);
    expect(status().textContent).toBe('');
    await drag(brushOf(/^Open PRs at the end of each /), cols.centre(column('2026-06-01')), cols.centre(column('2026-06-22')));
    expect(status().textContent).toBe('The period is now 2026-06-01 to 2026-06-28.');
    props.page.selection.update((s) => ({ ...s, pr: 1 }));
    await tick();
    expect(status().textContent).toBe('');
  });

  it('zooms from a drag across the dot plot, snapped to the weeks it spans', async () => {
    const { props } = await fixturePage('');
    render(App, props);
    const dots = screen.getByRole('region', { name: 'Each PR' }).querySelector('.brush') as Element;
    // The dot plot runs from 68px to 624px across the whole window, 2026-05-15 to the end of 2026-11-15.
    const x = (day: string) => 68 + (((dayStart(day) as number) - (dayStart('2026-05-15') as number)) / (185 * DAY)) * 556;
    await drag(dots, x('2026-08-05'), x('2026-08-19'));
    expect(get(props.page.selection).filters).toMatchObject({ from: '2026-08-03', to: '2026-08-23' });
  });

  it('zooms out on a double-click, around the centre, clamped to the data', async () => {
    const { props } = await fixturePage('#/?from=2026-06-01&to=2026-06-28');
    render(App, props);
    const brush = brushOf(/^Human and bot reviews per /);
    await fireEvent.click(brush, { detail: 1 });
    await fireEvent.click(brush, { detail: 2 });
    await fireEvent.dblClick(brush, { clientX: 300, clientY: 100 });
    await tick();
    expect(get(props.page.selection).filters).toMatchObject({ from: '2026-05-18', to: '2026-07-12' });
    expect(status().textContent).toBe('The period is now 2026-05-18 to 2026-07-12.');
  });

  it('gives the hint once, under the first chart', async () => {
    const { props } = await fixturePage('');
    render(App, props);
    const hints = screen.getAllByText(HINT);
    expect(hints).toHaveLength(1);
    expect(within(screen.getByRole('figure', { name: /^PRs opened, merged and closed unmerged, per / })).getByText(HINT)).toBeTruthy();
  });

  it('shares one zoom between the charts and the status line', async () => {
    const { props } = await fixturePage('');
    render(App, props);
    periodZoom(props.page).to({ from: '2026-09-07', to: '2026-09-20' });
    await tick();
    expect(status().textContent).toBe('The period is now 2026-09-07 to 2026-09-20.');
  });
});
