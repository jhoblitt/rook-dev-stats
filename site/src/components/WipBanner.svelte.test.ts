// @vitest-environment jsdom
import { render, screen } from '@testing-library/svelte';
import { beforeAll, describe, expect, it } from 'vitest';
import App from '../App.svelte';
import { fixturePage } from '../lib/__fixtures__/page';

const TEXT = 'Work in progress: figures and methods are not yet final for Rook.';

beforeAll(() => {
  // jsdom has no matchMedia; the theme toggle asks it for the system theme.
  window.matchMedia = (query: string) =>
    ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;
  Element.prototype.scrollIntoView = () => {};
});

describe('WipBanner', () => {
  it('says the work is in progress once, above the period controls', async () => {
    render(App, (await fixturePage('')).props);
    const banners = screen.getAllByText(TEXT);
    expect(banners).toHaveLength(1);
    const period = screen.getByRole('group', { name: 'Period' });
    expect(banners[0]!.compareDocumentPosition(period) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('says it on the methods page too, which shares the page shell', async () => {
    render(App, (await fixturePage('#/methods')).props);
    expect(screen.getAllByText(TEXT)).toHaveLength(1);
  });
});
