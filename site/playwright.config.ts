// The browser smoke test: the built site, served by `vite preview` under its
// real base path, in Chromium only. `make site-e2e` builds from the data first.
//
// To run the same spec against a published copy instead, set
// ROOKSTATS_E2E_URL to the page's address and no local server is started:
//
//   cd site && ROOKSTATS_E2E_URL=https://jhoblitt.github.io/rook-dev-stats/ npm run e2e

import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const LOCAL = `http://127.0.0.1:${PORT}/rook-dev-stats/`;
const published = process.env['ROOKSTATS_E2E_URL'];
// The spec navigates relative to the base, which only resolves inside it with a trailing slash.
const BASE = published ? published.replace(/\/*$/, '/') : LOCAL;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  reporter: 'list',
  timeout: 30_000,
  use: {
    baseURL: BASE,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  ...(published
    ? {}
    : {
        webServer: {
          command: `npm run preview -- --host 127.0.0.1 --port ${PORT} --strictPort`,
          url: LOCAL,
          // Always the build under test, never a server left running.
          reuseExistingServer: false,
          timeout: 30_000,
        },
      }),
});
