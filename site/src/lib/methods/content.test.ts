// Checks on the methods page's text itself: every section file is shown and
// parses, every figure it names exists, every link leads somewhere, and no
// number about the data is typed into the prose.

import { describe, expect, it } from 'vitest';
import type { Block, Inline } from './markdown';
import { INLINE_FIGURES, TABLE_FIGURES } from './present';
import { ORDER, fileOf, sectionFiles, sections } from './sections';

const files = sectionFiles();
const all = sections();

function inlines(blocks: Block[]): Inline[] {
  const out: Inline[] = [];
  const walk = (list: Inline[]) => {
    for (const n of list) {
      out.push(n);
      if (n.type === 'em' || n.type === 'strong' || n.type === 'link') walk(n.children);
    }
  };
  for (const b of blocks) {
    if (b.type === 'paragraph' || b.type === 'heading') walk(b.children);
    if (b.type === 'list') b.items.forEach(walk);
  }
  return out;
}

/**
 * The numbers each section may type, and why each is not a number about the
 * data. Anything else with a digit in the prose fails: a figure about the
 * data is a `{{name}}` computed when the page is shown. Code spans and link
 * addresses are not prose and are not read.
 */
const TYPED: Record<string, Record<string, string>> = {
  checking: { '5': 'how long after a merge a close is taken for the merge: a rule of the code, mergeCloseLag' },
  counted: { '53': 'the longest period counted by week: a rule of the code, stepFor' },
  commands: { '80': 'the most characters a kept comment text may have: a rule of the code, maxCommentText' },
  privacy: {
    '80': 'the most characters a kept comment text may have: a rule of the code',
    '200': 'the characters a kept candidate line is cut at: a rule of the code, maxCandidate',
  },
  outcomes: {
    '90': 'the 90th percentile, the name of a statistic',
    '70%': 'the form of a "not reached" label, as an example',
    '00:00': 'the hour an ISO week starts',
    '53': 'the longest period shown by week: a rule of the code, stepFor',
  },
  kind: {
    '10': 'the most closing issues a fetch reads of a pull request: a rule of the code, the closingIssuesReferences query',
    '20': 'the most labels a fetch reads of each closing issue: a rule of the code, the closingIssuesReferences query',
  },
  tables: {
    '5': 'the fewest pull requests a label must be on for check to require it: a rule of the code, minLabelPRs',
    '0.5%': 'the most the record counts may differ from GitHub’s: a rule of the code',
  },
  'review-capacity': { '53': 'the longest period shown by week: a rule of the code, stepFor' },
  'disclosure-comparison': { '90': 'the 90th percentile, the name of a statistic' },
  disclosure: {
    '2026-04-24': 'the day rook/rook added its AI guidelines and the template’s box: a fact about the world, dated',
    '2026-07-27': 'the day the guidelines began to permit AI trailers: a fact about the world, dated',
  },
};

/** The numbers written in a section's prose, outside code spans, link addresses and figures. */
function typedNumbers(source: string): string[] {
  const prose = source
    .replace(/`[^`]*`/g, ' ')
    .replace(/\]\([^)]*\)/g, '] ')
    .replace(/\{\{[^}]*\}\}/g, ' ');
  return prose.match(/\d+(?:[.,:-]\d+)*%?/g) ?? [];
}

describe('the section files', () => {
  it('shows every written section, and has a file for each', () => {
    const shown = ORDER.filter((e): e is string => typeof e === 'string');
    expect(Object.keys(files).sort()).toEqual(shown.map(fileOf).sort());
    expect(all.map((s) => s.id)).toEqual(shown);
  });

  it('has no section still waiting to be written', () => {
    expect(ORDER.filter((e) => typeof e !== 'string')).toEqual([]);
  });

  it('gives every section and subheading its own id', () => {
    const ids = all.flatMap((s) => [s.id, ...s.blocks.flatMap((b) => (b.type === 'heading' ? [b.id] : []))]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('names only figures that exist, a table only on a line of its own', () => {
    for (const s of all) {
      for (const b of s.blocks) if (b.type === 'figure') expect(TABLE_FIGURES, `${s.id}: ${b.name}`).toHaveProperty([b.name]);
      for (const n of inlines(s.blocks)) {
        if (n.type === 'figure') expect(INLINE_FIGURES, `${s.id}: ${n.name}`).toHaveProperty([n.name]);
      }
    }
  });

  it('links only to https addresses and to sections and subheadings on the page', () => {
    const ids = new Set(all.flatMap((s) => [s.id, ...s.blocks.flatMap((b) => (b.type === 'heading' ? [b.id] : []))]));
    for (const s of all) {
      for (const n of inlines(s.blocks)) {
        if (n.type !== 'link') continue;
        if (n.href.startsWith('#')) expect(ids, `${s.id}: ${n.href}`).toContain(n.href.slice(1));
        else expect(n.href, s.id).toMatch(/^https:\/\/github\.com\//);
      }
    }
  });

  it('links each hand-edited table to its file on GitHub', () => {
    const tables = files[fileOf('tables')] as string;
    for (const f of ['tools', 'bots', 'commands', 'labels', 'kinds']) {
      expect(tables).toContain(`(https://github.com/jhoblitt/rook-dev-stats/blob/main/data/${f}.yaml)`);
    }
  });
});

describe('typed numbers', () => {
  it.each(Object.keys(files).map((path) => [path]))('%s types no number about the data', (path) => {
    const id = path.replace(/^.*\/|\.md$/g, '');
    const allowed = TYPED[id] ?? {};
    const unexplained = typedNumbers(files[path] as string).filter((n) => !(n in allowed));
    expect(unexplained).toEqual([]);
  });

  it('finds a number typed into prose, and not one in code, a link address or a figure', () => {
    expect(typedNumbers('There were 1,234 PRs and 40% of them, on 2026-01-02.')).toEqual(['1,234', '40%', '2026-01-02']);
    expect(typedNumbers('`v19.2` [a link](https://x/2) {{prs.active}}')).toEqual([]);
    expect(typedNumbers('[PR #7](https://x/7)')).toEqual(['7']);
  });

  it('allows no number a section does not type', () => {
    for (const [id, allowed] of Object.entries(TYPED)) {
      const typed = new Set(typedNumbers(files[fileOf(id)] as string));
      for (const n of Object.keys(allowed)) expect(typed, `${id}: ${n}`).toContain(n);
    }
  });
});
