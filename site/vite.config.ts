import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/rook-dev-stats/',
  // Under vitest, svelteTesting resolves Svelte's client build, so component
  // tests can mount, and cleans up after each test.
  plugins: [svelte(), ...(process.env['VITEST'] ? [svelteTesting()] : [])],
  define: {
    // Formatted at runtime by lib/version.ts; an empty string means a dev build.
    __APP_VERSION__: JSON.stringify(process.env['APP_VERSION'] ?? ''),
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
