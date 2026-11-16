// The ids a link to the methods page may name: each section's and each of
// its subheadings'. The URL state accepts no other, so an address naming a
// section that no longer exists lands at the top of the page.

import { sections } from './sections';

let ids: ReadonlySet<string> | null = null;

export function methodsAnchors(): ReadonlySet<string> {
  ids ??= new Set(
    sections().flatMap((s) => [s.id, ...s.blocks.flatMap((b) => (b.type === 'heading' ? [b.id] : []))]),
  );
  return ids;
}

export function isMethodsAnchor(id: string): boolean {
  return methodsAnchors().has(id);
}
