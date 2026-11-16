import { describe, expect, it } from 'vitest';
import { type Inline, parseInline, parseSection } from './markdown';

const text = (t: string): Inline => ({ type: 'text', text: t });

describe('parseInline', () => {
  it('reads plain text as one text node', () => {
    expect(parseInline('a plain sentence.')).toEqual([text('a plain sentence.')]);
  });

  it('reads a code span verbatim, markers inside it included', () => {
    expect(parseInline('the `*_[x](y)_*` key')).toEqual([
      text('the '),
      { type: 'code', text: '*_[x](y)_*' },
      text(' key'),
    ]);
  });

  it('reads emphasis and strong emphasis', () => {
    expect(parseInline('*not* **disclosed**')).toEqual([
      { type: 'em', children: [text('not')] },
      text(' '),
      { type: 'strong', children: [text('disclosed')] },
    ]);
  });

  it('reads a link whose text holds a code span', () => {
    expect(parseInline('see [`data/tools.yaml`](https://example.org/t) now')).toEqual([
      text('see '),
      { type: 'link', href: 'https://example.org/t', children: [{ type: 'code', text: 'data/tools.yaml' }] },
      text(' now'),
    ]);
  });

  it('reads a figure', () => {
    expect(parseInline('{{prs.active}} pull requests')).toEqual([
      { type: 'figure', name: 'prs.active' },
      text(' pull requests'),
    ]);
  });

  it('keeps an unmatched marker as text', () => {
    expect(parseInline('a * b and `c and [d] and {{e')).toEqual([text('a * b and `c and [d] and {{e')]);
  });

  it('keeps a figure with a name it cannot hold as text', () => {
    expect(parseInline('{{<b>}}')).toEqual([text('{{<b>}}')]);
  });

  it('reads a link whose text holds a code span with a ] in it as one link', () => {
    expect(parseInline('[see `a]b` here](https://example.org/x)')).toEqual([
      {
        type: 'link',
        href: 'https://example.org/x',
        children: [text('see '), { type: 'code', text: 'a]b' }, text(' here')],
      },
    ]);
  });

  it('reads a link text with an unpaired backtick as text, not a link', () => {
    expect(parseInline('[a `b](https://example.org/x)')).toEqual([text('[a `b](https://example.org/x)')]);
  });

  it('gives up on a [ followed by many backticks and no ] in linear time', () => {
    const src = `[${'``'.repeat(20000)}`;
    const started = performance.now();
    const nodes = parseInline(src);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(nodes.map((n) => (n.type === 'text' ? n.text : '')).join('')).toBe(src);
  });
});

describe('parseSection', () => {
  it('takes the title from the first line and the rest as blocks', () => {
    const s = parseSection(
      'counted',
      [
        '# What is counted',
        '',
        'A paragraph',
        'over two lines.',
        '',
        '## Its limits',
        '',
        '- one item',
        '  that continues',
        '- another',
        '',
        '{{table.kinds}}',
        '',
      ].join('\n'),
    );
    expect(s).toEqual({
      id: 'counted',
      title: 'What is counted',
      blocks: [
        { type: 'paragraph', children: [text('A paragraph over two lines.')] },
        { type: 'heading', id: 'counted-its-limits', children: [text('Its limits')] },
        { type: 'list', items: [[text('one item that continues')], [text('another')]] },
        { type: 'figure', name: 'table.kinds' },
      ],
    });
  });

  it('keeps a figure inside a paragraph inline', () => {
    const s = parseSection('x', '# X\n\n{{prs.active}} of them.\n');
    expect(s.blocks).toEqual([
      { type: 'paragraph', children: [{ type: 'figure', name: 'prs.active' }, text(' of them.')] },
    ]);
  });

  it('starts a list right after a paragraph line', () => {
    const s = parseSection('x', '# X\n\nThe forms:\n- one\n- two\n');
    expect(s.blocks).toEqual([
      { type: 'paragraph', children: [text('The forms:')] },
      { type: 'list', items: [[text('one')], [text('two')]] },
    ]);
  });

  it('refuses a section without a title', () => {
    expect(() => parseSection('x', 'no title\n')).toThrow(/x: the first line must be "# <title>"/);
  });

  it('refuses markup the renderer does not draw', () => {
    expect(() => parseSection('x', '# X\n\n<b>raw</b>\n')).toThrow(/x: line 3: HTML is not allowed/);
    expect(() => parseSection('x', '# X\n\n### Deep\n')).toThrow(/x: line 3: only "## " subheadings/);
    expect(() => parseSection('x', '# X\n\n1. first\n')).toThrow(/x: line 3: numbered lists/);
  });
});
