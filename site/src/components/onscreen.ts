import type { Attachment } from 'svelte/attachments';

/**
 * Calls `shown` once any of the element has been on screen, so a section
 * fetches a large file only when the reader reaches it. Where there is no
 * IntersectionObserver (jsdom), it calls at once.
 */
export function onScreen(shown: () => void): Attachment<HTMLElement> {
  return (node) => {
    if (typeof IntersectionObserver === 'undefined') {
      shown();
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        shown();
        observer.disconnect();
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  };
}
