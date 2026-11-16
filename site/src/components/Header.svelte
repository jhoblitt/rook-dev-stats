<script lang="ts">
  import { dayOf } from '../lib/filters';
  import { getPage } from '../lib/page';
  import { routeHash } from '../lib/state';
  import Nav from './Nav.svelte';
  import ThemeToggle from './ThemeToggle.svelte';

  const { meta, selection } = getPage();
  const asOf = dayOf(meta.fetched_through);
</script>

<header class="site-header">
  <div class="inner">
    <div class="brand">
      <a class="title" href={routeHash($selection, 'report', meta)}>Rook pull requests</a>
      <p class="as-of">data as of <time class="num" datetime={asOf}>{asOf}</time></p>
    </div>
    <div class="nav"><Nav /></div>
    <div class="toggle"><ThemeToggle /></div>
  </div>
</header>

<style>
  .site-header {
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }

  .inner {
    display: grid;
    grid-template-columns: 1fr auto auto;
    grid-template-areas: 'brand nav toggle';
    align-items: center;
    gap: var(--space-3) var(--space-5);
    max-width: var(--content-max);
    margin: 0 auto;
    padding: var(--space-4) var(--space-5);
  }

  .brand {
    grid-area: brand;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-1) var(--space-4);
  }

  .nav {
    grid-area: nav;
  }

  .toggle {
    grid-area: toggle;
  }

  .title {
    color: var(--text);
    font-size: var(--text-lg);
    font-weight: 700;
    letter-spacing: -0.01em;
    text-decoration: none;
  }

  .as-of {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  @media (width < 720px) {
    .inner {
      grid-template-columns: 1fr auto;
      grid-template-areas:
        'brand toggle'
        'nav nav';
      padding: var(--space-4);
    }

    .brand {
      flex-direction: column;
      gap: 0;
    }
  }
</style>
