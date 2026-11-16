// Moving to the section of the report an address names. The section may not
// be drawn yet: a cold load draws none until its years arrive. Once it is,
// the figures above it still change height as they draw and as files
// arrive, so the page holds the section where it put it until the reader
// moves: a wheel, a touch, a key or a press, or a scroll the page did not
// cause. After that nothing moves the page until the address names a
// section again.

import { getContext, setContext } from 'svelte';

export interface Landing {
  /** Move to the element with this id, at once or as soon as it is drawn, and hold it there. */
  land(id: string): void;
  /** Stop holding the page, and stop waiting for an element to move to. */
  release(): void;
}

const INTENT = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;

export function createLanding(win: Window): Landing {
  const doc = win.document;
  let waiting: MutationObserver | null = null;
  let resizes: ResizeObserver | null = null;
  // Where the element was left, and how tall the page was then.
  let held: { el: HTMLElement; top: number; height: number } | null = null;

  const pageHeight = () => doc.documentElement.scrollHeight;
  const topOf = (el: HTMLElement) => el.getBoundingClientRect().top;

  function release() {
    waiting?.disconnect();
    waiting = null;
    resizes?.disconnect();
    resizes = null;
    held = null;
    for (const type of INTENT) win.removeEventListener(type, release, true);
    win.removeEventListener('scroll', scrolled);
  }

  function put(el: HTMLElement) {
    el.scrollIntoView({ block: 'start' });
    held = { el, top: topOf(el), height: pageHeight() };
  }

  // Something on the page changed size: put the element back if it moved.
  function keep() {
    if (held === null) return;
    if (!held.el.isConnected) return release();
    if (Math.abs(topOf(held.el) - held.top) > 1) put(held.el);
    else held.height = pageHeight();
  }

  // A scroll that moved the element while the page kept its height was not
  // the page making up for a figure: the reader dragged the scroll bar.
  function scrolled() {
    if (held === null || pageHeight() !== held.height) return;
    if (Math.abs(topOf(held.el) - held.top) > 1) release();
  }

  function arrive(el: HTMLElement) {
    put(el);
    el.focus({ preventScroll: true });
    win.addEventListener('scroll', scrolled, { passive: true });
    // jsdom has none, and draws nothing to make up for.
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(keep);
    observer.observe(doc.body);
    for (const sibling of el.parentElement?.children ?? []) observer.observe(sibling);
    resizes = observer;
  }

  function land(id: string) {
    release();
    // A reader who moves while the section is still to come stays where they are.
    for (const type of INTENT) win.addEventListener(type, release, { capture: true, passive: true });
    const el = doc.getElementById(id);
    if (el !== null) return arrive(el);
    const observer = new MutationObserver(() => {
      const drawn = doc.getElementById(id);
      if (drawn === null) return;
      observer.disconnect();
      waiting = null;
      arrive(drawn);
    });
    observer.observe(doc.body, { childList: true, subtree: true });
    waiting = observer;
  }

  return { land, release };
}

const KEY = Symbol('landing');

export function setLanding(landing: Landing): void {
  setContext(KEY, landing);
}

/** The report's landing, or undefined for a section drawn outside the report, as in a component's own spec. */
export function getLanding(): Landing | undefined {
  return getContext<Landing | undefined>(KEY);
}
