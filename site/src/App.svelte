<script lang="ts">
  import Footer from './components/Footer.svelte';
  import Header from './components/Header.svelte';
  import { type Page, setPage } from './lib/page';
  import type { Route } from './lib/state';
  import Methods from './routes/Methods.svelte';
  import Report from './routes/Report.svelte';

  interface Props {
    page: Page;
  }

  let { page }: Props = $props();

  // main.ts mounts the page once; it is never replaced.
  // svelte-ignore state_referenced_locally
  setPage(page);
  // svelte-ignore state_referenced_locally
  const { selection } = page;

  const titles: Record<Route, string> = {
    report: 'Rook pull requests',
    methods: 'Methods · Rook pull requests',
  };

  let main: HTMLElement;
  let shownRoute: Route | undefined;

  $effect(() => {
    const route = $selection.route;
    const section = $selection.section;
    document.title = titles[route];
    // On a page change, start at the top and give the new page focus, as a
    // full page load would; the first render leaves both alone. An address
    // naming a section of the methods page is left to that page to move to.
    if (shownRoute !== undefined && shownRoute !== route && section === null) {
      window.scrollTo(0, 0);
      main.focus({ preventScroll: true });
    }
    shownRoute = route;
  });

  function skipToContent(event: MouseEvent) {
    // A plain #main link would replace the hash that holds the filters.
    event.preventDefault();
    main.focus();
  }
</script>

<a class="skip-link" href="#/" onclick={skipToContent}>Skip to content</a>

<Header />

<main bind:this={main} tabindex="-1">
  {#if $selection.route === 'methods'}
    <Methods />
  {:else}
    <Report />
  {/if}
</main>

<Footer />

<style>
  main {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    max-width: var(--content-max);
    margin: 0 auto;
    padding: var(--space-6) var(--space-5) 0;
  }

  main:focus {
    outline: none;
  }

  .skip-link {
    position: absolute;
    left: var(--space-4);
    top: -10rem;
    z-index: 1;
    padding: var(--space-2) var(--space-4);
    background: var(--accent);
    color: var(--accent-ink);
    border-radius: var(--radius-sm);
  }

  .skip-link:focus-visible {
    top: var(--space-4);
  }

  @media (width < 720px) {
    main {
      padding-top: var(--space-5);
      padding-inline: var(--space-4);
    }
  }
</style>
