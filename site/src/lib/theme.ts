// The colour theme: the system preference until the reader picks one, which
// is then kept in localStorage. index.html applies a stored choice before
// first paint; this module owns reading and changing it afterwards.

export type Theme = 'light' | 'dark';

/** index.html's inline script reads the same key. */
export const THEME_STORAGE_KEY = 'rook-dev-stats:theme';

export function parseTheme(value: string | null | undefined): Theme | null {
  return value === 'light' || value === 'dark' ? value : null;
}

/** The theme in effect: the reader's choice, else the system's. */
export function currentTheme(doc: Document, win: Window): Theme {
  return parseTheme(doc.documentElement.dataset['theme']) ?? (systemPrefersDark(win) ? 'dark' : 'light');
}

export function systemPrefersDark(win: Window): boolean {
  return win.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Applies a theme and remembers it; storage may be unavailable, which only costs persistence. */
export function chooseTheme(theme: Theme, doc: Document, win: Window): void {
  doc.documentElement.dataset['theme'] = theme;
  try {
    win.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Private browsing or disabled storage: the choice lasts for this page.
  }
}
