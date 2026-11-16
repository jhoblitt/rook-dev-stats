<!--
  How every figure on the site is arrived at. The prose is Markdown under
  src/content/methods/, shown at once; the figures in it are computed from
  the data when the page is shown, the ones that need the table files only
  once those load, and a load that fails leaves the prose as it is. The
  address can name a section, which the page moves to when it opens and
  whenever the section named changes.
-->
<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { type DataError, type TableYear, yearsFor } from '../lib/data';
  import { dayOf, periodRange } from '../lib/filters';
  import Prose from '../lib/methods/Prose.svelte';
  import {
    type DataFigures,
    type Loadable,
    type TableFigures,
    dataFigures,
    inlineView,
    tableFigures,
    tableView,
  } from '../lib/methods/present';
  import { sections } from '../lib/methods/sections';
  import { getPage } from '../lib/page';
  import { RECENT_MONTHS, recentFilters, sectionHash } from '../lib/state';

  const { meta, loader, selection } = getPage();
  const all = sections();
  // The figures are over the last six months, not the whole history the
  // report opens on, so the page needs only the files of the PRs active in
  // them.
  const days = recentFilters(meta);
  const years = yearsFor(meta, periodRange(days).start);

  let data = $state<Loadable<DataFigures>>({ state: 'loading' });
  let tables = $state<Loadable<TableFigures>>({ state: 'loading' });

  const href = (id: string) => sectionHash($selection, id, meta);
  const inline = (name: string) => inlineView(name, meta, data, tables);
  const table = (name: string) => tableView(name, meta, data, tables);

  function describe(err: unknown): string {
    const e = err as Partial<DataError>;
    return e.file !== undefined && e.detail !== undefined ? `${e.file}: ${e.detail}` : String(err);
  }

  onMount(() => {
    let live = true;
    void (async () => {
      const loaded = await loader.load(years);
      if (!live) return;
      if (loaded.errors.length > 0) {
        const message = loaded.errors.map((e) => `${e.file}: ${e.message}`).join('; ');
        data = { state: 'error', message };
        tables = { state: 'error', message };
        return;
      }
      data = { state: 'ready', value: dataFigures(loaded.dataset, days) };
      try {
        const loadedTables = await Promise.all(years.map((y) => loader.table(y).then((t): [number, TableYear] => [y, t])));
        if (live) tables = { state: 'ready', value: tableFigures(loaded.dataset, new Map(loadedTables), days) };
      } catch (err) {
        if (live) tables = { state: 'error', message: describe(err) };
      }
    })();
    return () => {
      live = false;
    };
  });

  // Where the page last moved to, and the scroll position it left there, so
  // that figures loading above it can be made up for unless the reader has
  // scrolled since.
  let landed: { id: string; y: number } | null = null;

  function jump(id: string) {
    const target = document.getElementById(id);
    if (!target) return;
    target.scrollIntoView({ block: 'start' });
    target.focus({ preventScroll: true });
    landed = { id, y: window.scrollY };
  }

  // A link to a section is a real address, so it can be copied or opened in
  // a new tab; followed here, it moves to the section through the URL state.
  function go(event: MouseEvent, id: string) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if ($selection.section === id) jump(id);
    else selection.update((s) => ({ ...s, section: id }));
  }

  let heading: HTMLElement;
  // The section the page last moved to; not reactive, so moving does not rerun the effect.
  let shownSection: string | null = null;

  // The app leaves the scroll alone when the route changes to an address
  // naming a section, so the page moves there without racing it.
  $effect(() => {
    const id = $selection.section;
    const previous = shownSection;
    shownSection = id;
    if (id !== null) {
      void tick().then(() => jump(id));
    } else if (previous !== null) {
      // Back to the page itself, as a fresh load of it would show it.
      landed = null;
      window.scrollTo(0, 0);
      heading.focus({ preventScroll: true });
    }
  });

  const settled = $derived(data.state !== 'loading' && tables.state !== 'loading');
  $effect(() => {
    if (!settled || landed === null || Math.abs(window.scrollY - landed.y) > 1) return;
    document.getElementById(landed.id)?.scrollIntoView({ block: 'start' });
  });

  const failures = $derived(
    [data, tables].flatMap((l) => (l.state === 'error' ? [l.message] : [])).filter((m, i, a) => a.indexOf(m) === i),
  );
</script>

<article class="methods">
  <header>
    <h1 bind:this={heading} tabindex="-1">Methods</h1>
    <p>
      How each figure on this site is arrived at, and what it cannot show. The figures on this page are computed in
      your browser from the same data as the report, as of {dayOf(meta.fetched_through)}, over the last
      {RECENT_MONTHS} months of it, {days.from} to {days.to}; the report itself opens on the whole window.
    </p>
    {#if failures.length > 0}
      <p class="notice" role="alert">
        Some figures on this page could not be computed, because their data did not load ({failures.join('; ')}).
        The text does not depend on them. Reloading the page may help.
      </p>
    {:else if data.state === 'loading' || tables.state === 'loading'}
      <p class="notice" role="status">Loading the data the figures on this page are computed from…</p>
    {/if}
  </header>

  <nav aria-labelledby="methods-contents">
    <h2 id="methods-contents">Contents</h2>
    <ol>
      {#each all as section (section.id)}
        <li><a href={href(section.id)} data-target={section.id} onclick={(e) => go(e, section.id)}>{section.title}</a></li>
      {/each}
    </ol>
  </nav>

  {#each all as section (section.id)}
    <Prose {section} {inline} {table} {href} {go} />
  {/each}
</article>

<style>
  .methods {
    display: flex;
    flex-direction: column;
    gap: var(--space-7);
    padding-bottom: var(--space-7);
  }

  header p {
    margin: 0;
  }

  header {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  h1 {
    margin: 0;
  }

  h1:focus {
    outline: none;
  }

  .notice {
    color: var(--text-muted);
  }

  nav h2 {
    font-size: var(--text-lg);
    margin: 0 0 var(--space-2);
  }

  nav ol {
    margin: 0;
    padding-left: var(--space-5);
    columns: 2 18rem;
    column-gap: var(--space-6);
  }

  nav li {
    break-inside: avoid;
    margin-bottom: var(--space-1);
  }
</style>
