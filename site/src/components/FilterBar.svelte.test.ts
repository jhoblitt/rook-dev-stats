// @vitest-environment jsdom
// The period controls pinned to the top of the viewport once the reader
// scrolls past them. jsdom lays nothing out, so where the Period row's place
// is in the viewport is set by hand, and a scroll event says it moved.
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import App from '../App.svelte';
import { fixturePage } from '../lib/__fixtures__/page';

let scrolled: Element[] = [];

beforeAll(() => {
  window.matchMedia = (query: string) =>
    ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this);
  };
});

beforeEach(() => {
  scrolled = [];
});

const period = () => screen.getByRole('group', { name: 'Period' });
const back = () => screen.queryByRole('button', { name: 'Filters' });

async function report(hash = '#/?target=main') {
  const { props, loc } = await fixturePage(hash);
  render(App, props);
  // The Period row's place in the filter bar: its top, where the viewport puts it, and its size.
  const place = period().closest<HTMLElement>('.filter-bar > *')!;
  let top = 120;
  place.getBoundingClientRect = () => new DOMRect(40, top, 600, 62);
  const scrollTo = async (t: number) => {
    top = t;
    window.dispatchEvent(new Event('scroll'));
    await tick();
  };
  return { loc, place, scrollTo };
}

/** Every control a reader sets the period with, by name, as the document holds them. */
function periodControls() {
  return {
    from: screen.getAllByLabelText('From'),
    to: screen.getAllByLabelText('To'),
    presets: within(period()).getAllByRole('button'),
  };
}

describe('the period controls, as the reader scrolls', () => {
  it('stay where they are, with no way back to the filters, until the reader scrolls past them', async () => {
    const { scrollTo } = await report();
    expect(back()).toBeNull();
    await scrollTo(1);
    expect(back()).toBeNull();
  });

  it('are pinned as the same controls, one set of them, once the reader scrolls past them', async () => {
    const { scrollTo } = await report();
    const before = periodControls();
    expect(before.from).toHaveLength(1);
    expect(before.to).toHaveLength(1);
    expect(before.presets.length).toBeGreaterThan(0);
    const to = before.to[0] as HTMLInputElement;
    to.focus();

    await scrollTo(-1);
    expect(back()).not.toBeNull();
    const pinned = periodControls();
    expect(pinned.from).toEqual(before.from);
    expect(pinned.to).toEqual(before.to);
    expect(pinned.presets).toEqual(before.presets);
    expect(screen.getAllByRole('group', { name: 'Period' })).toHaveLength(1);
    expect(document.activeElement).toBe(to);

    await scrollTo(10);
    expect(back()).toBeNull();
    expect(periodControls()).toEqual(before);
    expect(document.activeElement).toBe(to);
  });

  it('keep the Period row’s place in the filter bar the size it was while they are pinned', async () => {
    const { place, scrollTo } = await report();
    await scrollTo(-200);
    expect(place.style.getPropertyValue('--held-width')).toBe('600px');
    expect(place.style.getPropertyValue('--held-height')).toBe('62px');
    await scrollTo(0);
    expect(place.style.getPropertyValue('--held-height')).toBe('');
  });

  it('set the same period from where they are pinned', async () => {
    const { loc, scrollTo } = await report();
    await scrollTo(-200);
    const to = screen.getByLabelText('To') as HTMLInputElement;
    to.value = '2026-08-31';
    await fireEvent.change(to);
    expect(loc.hash()).toContain('to=2026-08-31');
    expect(to.value).toBe('2026-08-31');
  });

  it('offer, once pinned, a way back to the filter bar that moves there and focuses it', async () => {
    const { scrollTo } = await report();
    await scrollTo(-200);
    await fireEvent.click(back()!);
    const bar = screen.getByRole('region', { name: 'Filters' });
    expect(scrolled).toEqual([bar]);
    expect(document.activeElement).toBe(bar);
  });
});
