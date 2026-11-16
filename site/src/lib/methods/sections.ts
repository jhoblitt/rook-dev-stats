// The methods page's sections, in the order the page shows them. Each is a
// Markdown file under src/content/methods/ named by its id, which is also
// the section's anchor, so other pages can link to it: keep ids stable.

import { type Section, parseSection } from './markdown';

/**
 * A slot reserved for a section whose subject is still being built: it holds
 * its place in the order and is not shown until its file is written.
 */
interface Pending {
  id: string;
  pending: string;
}

export const ORDER: readonly (string | Pending)[] = [
  'counted',
  'kind',
  'people',
  'responses',
  'commands',
  'people-tables',
  'commits',
  'outcomes',
  'review-capacity',
  'disclosure',
  'disclosure-comparison',
  'privacy',
  'tables',
  'limits',
  'checking',
];

/** The Markdown of every section file, by path. */
const FILES: Record<string, string> = import.meta.glob('../../content/methods/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});

export const fileOf = (id: string) => `../../content/methods/${id}.md`;

/** The sections to show, parsed, in order. Throws when a written section has no file. */
export function sections(files: Record<string, string> = FILES): Section[] {
  return ORDER.flatMap((entry) => {
    if (typeof entry !== 'string') return [];
    const source = files[fileOf(entry)];
    if (source === undefined) throw new Error(`the methods section "${entry}" has no file ${fileOf(entry)}`);
    return [parseSection(entry, source)];
  });
}

/** The section files, by path, for checks on the text itself. */
export function sectionFiles(): Record<string, string> {
  return FILES;
}
