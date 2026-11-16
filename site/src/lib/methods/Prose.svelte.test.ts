// @vitest-environment jsdom
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { parseSection } from './markdown';
import Prose from './Prose.svelte';

const props = (md: string) => ({
  section: parseSection('x', md),
  inline: () => ({ state: 'ready', value: '7' }) as const,
  table: () => ({ state: 'loading' }) as const,
  href: (id: string) => `#/methods?section=${id}`,
  go: () => {},
});

describe('Prose', () => {
  it('links an https address and an anchor on the page', () => {
    render(Prose, props('# X\n\nSee [GitHub](https://github.com/ceph/ceph) and [below](#x).\n'));
    expect(screen.getByRole('link', { name: 'GitHub' }).getAttribute('href')).toBe('https://github.com/ceph/ceph');
    expect(screen.getByRole('link', { name: 'below' }).getAttribute('href')).toBe('#/methods?section=x');
  });

  it('draws any other address as its text, not as a link', () => {
    render(Prose, props('# X\n\nA [bad link](javascript:alert) and [plain](http://example.org).\n'));
    expect(screen.queryAllByRole('link')).toEqual([]);
    expect(screen.getByRole('region').textContent).toContain('A bad link and plain.');
  });
});
