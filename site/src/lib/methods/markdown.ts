// The small Markdown the methods page is written in, parsed to a tree that
// Svelte renders node by node: nothing is ever inserted as HTML, so neither
// the prose nor a figure computed from the data can inject markup.
//
// A section file is `# Title`, then blocks separated by blank lines: a
// paragraph, a `## ` subheading, a `- ` list whose items may continue on
// indented lines, or a line holding only `{{name}}`, a figure drawn as a
// block. Inline: `code`, *emphasis*, **strong**, [text](href) and
// `{{name}}`, a figure written into the sentence.

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'em'; children: Inline[] }
  | { type: 'strong'; children: Inline[] }
  | { type: 'link'; href: string; children: Inline[] }
  | { type: 'figure'; name: string };

export type Block =
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'heading'; id: string; children: Inline[] }
  | { type: 'list'; items: Inline[][] }
  | { type: 'figure'; name: string };

export interface Section {
  id: string;
  title: string;
  blocks: Block[];
}

const FIGURE_NAME = /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)*$/;

/** Appends text, merging it into a text node just before. */
function pushText(out: Inline[], t: string) {
  if (t === '') return;
  const last = out[out.length - 1];
  if (last?.type === 'text') last.text += t;
  else out.push({ type: 'text', text: t });
}

/**
 * The link `[text](href)` starting at `src[start]`, or null when there is
 * none. A backtick in the text opens a code span that runs to the next
 * backtick, so a `]` inside it does not end the text, and a backtick with
 * no partner means no link. Each character is looked at once, so a failed
 * scan costs no more than the rest of the source.
 */
function scanLink(src: string, start: number): { text: string; href: string; end: number } | null {
  let j = start + 1;
  while (j < src.length && src[j] !== ']') {
    if (src[j] === '`') {
      const close = src.indexOf('`', j + 1);
      if (close === -1) return null;
      j = close + 1;
    } else {
      j++;
    }
  }
  if (j >= src.length || j === start + 1 || src[j + 1] !== '(') return null;
  const hrefStart = j + 2;
  let k = hrefStart;
  while (k < src.length && src[k] !== ')' && !/\s/.test(src[k] as string)) k++;
  if (k === hrefStart || src[k] !== ')') return null;
  return { text: src.slice(start + 1, j), href: src.slice(hrefStart, k), end: k + 1 };
}

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    if (rest.startsWith('`')) {
      const end = src.indexOf('`', i + 1);
      if (end > i + 1) {
        out.push({ type: 'code', text: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    } else if (rest.startsWith('{{')) {
      const end = src.indexOf('}}', i + 2);
      const name = end === -1 ? '' : src.slice(i + 2, end);
      if (FIGURE_NAME.test(name)) {
        out.push({ type: 'figure', name });
        i = end + 2;
        continue;
      }
    } else if (rest.startsWith('**')) {
      const end = src.indexOf('**', i + 2);
      if (end > i + 2) {
        out.push({ type: 'strong', children: parseInline(src.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    } else if (rest.startsWith('*')) {
      const end = src.indexOf('*', i + 1);
      if (end > i + 1 && src[i + 1] !== ' ') {
        out.push({ type: 'em', children: parseInline(src.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    } else if (rest.startsWith('[')) {
      const link = scanLink(src, i);
      if (link) {
        out.push({ type: 'link', href: link.href, children: parseInline(link.text) });
        i = link.end;
        continue;
      }
    }
    // Plain text runs to the next character that may open markup.
    const next = src.slice(i + 1).search(/[`{*[]/);
    const stop = next === -1 ? src.length : i + 1 + next;
    pushText(out, src.slice(i, stop));
    i = stop;
  }
  return out;
}

/** A subheading's id: the section's id, then the heading's words. */
function slug(sectionId: string, title: string): string {
  const words = title
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${sectionId}-${words}`;
}

const HTML = /<[A-Za-z/!]/;
const BLOCK_FIGURE = /^\{\{([^}]*)\}\}$/;

export function parseSection(id: string, source: string): Section {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  let n = 0;
  while (n < lines.length && (lines[n] as string).trim() === '') n++;
  const first = /^# (.+)$/.exec(lines[n] ?? '');
  if (!first) throw new Error(`${id}: the first line must be "# <title>"`);
  const title = (first[1] as string).trim();

  const blocks: Block[] = [];
  let para: string[] = [];
  let items: string[][] | null = null;
  const flush = () => {
    if (para.length > 0) blocks.push({ type: 'paragraph', children: parseInline(para.join(' ')) });
    if (items) blocks.push({ type: 'list', items: items.map((it) => parseInline(it.join(' '))) });
    para = [];
    items = null;
  };

  for (let k = n + 1; k < lines.length; k++) {
    const raw = lines[k] as string;
    const line = raw.trim();
    const where = `${id}: line ${k + 1}`;
    if (HTML.test(raw.replace(/`[^`]*`/g, ''))) throw new Error(`${where}: HTML is not allowed`);
    if (line === '') {
      flush();
      continue;
    }
    if (/^#/.test(line)) {
      if (!line.startsWith('## ')) throw new Error(`${where}: only "## " subheadings are allowed in a section`);
      flush();
      const heading = line.slice(3).trim();
      blocks.push({ type: 'heading', id: slug(id, heading), children: parseInline(heading) });
      continue;
    }
    if (/^\d+[.)] /.test(line)) throw new Error(`${where}: numbered lists are not supported`);
    if (line.startsWith('- ')) {
      if (para.length > 0) flush();
      items ??= [];
      items.push([line.slice(2).trim()]);
      continue;
    }
    if (items && /^\s/.test(raw)) {
      (items[items.length - 1] as string[]).push(line);
      continue;
    }
    const figure = BLOCK_FIGURE.exec(line);
    if (figure && para.length === 0 && !items) {
      if (!FIGURE_NAME.test(figure[1] as string)) throw new Error(`${where}: "${line}" is not a figure name`);
      blocks.push({ type: 'figure', name: figure[1] as string });
      continue;
    }
    if (items) flush();
    para.push(line);
  }
  flush();
  return { id, title, blocks };
}
