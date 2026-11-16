import type { Attachment } from 'svelte/attachments';

/**
 * Reports an element's border-box width as it changes. Where there is no
 * ResizeObserver (jsdom), it reports nothing and the caller keeps its default.
 */
export function measureWidth(set: (width: number) => void): Attachment<HTMLElement> {
  return (node) => {
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) set(entry.borderBoxSize[0]?.inlineSize ?? entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  };
}

/** Moves the focus to the `index`-th hit target among the focused one's siblings. */
export function focusSibling(current: EventTarget | null, index: number) {
  const target = (current as Element | null)?.parentElement?.children[index];
  if (target instanceof SVGElement || target instanceof HTMLElement) target.focus();
}
