<!--
  A report section's heading, and beside it a link to the section: the
  current address naming the section, so a copied link keeps the filters.
  The link sits outside the heading, so the heading, and the section it
  labels, keep their names.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { getLanding } from '../lib/landing';
  import { getPage } from '../lib/page';
  import { reportSection } from '../lib/report-sections';
  import { reportSectionHash } from '../lib/state';

  interface Props {
    /** The section's name in the address. */
    name: string;
    /** The heading. */
    children: Snippet;
  }

  let { name, children }: Props = $props();

  const { meta, selection } = getPage();
  const landing = getLanding();
  const title = $derived(reportSection(name)?.title ?? name);
  const href = $derived(reportSectionHash($selection, name, meta));

  // Followed here, the link moves to the section through the address, or
  // again when the address already names it.
  function go(event: MouseEvent) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const id = reportSection(name)?.id;
    if ($selection.section === name && id !== undefined) landing?.land(id);
    else selection.update((s) => ({ ...s, section: name }));
  }
</script>

<div class="section-head">
  {@render children()}
  <a class="section-link" {href} aria-label="Link to the {title} section" onclick={go}><span aria-hidden="true">#</span></a>
</div>

<style>
  .section-head {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
  }

  .section-link {
    font-size: var(--text-lg);
    text-decoration: none;
    opacity: 0;
  }

  .section-head:hover .section-link,
  .section-link:focus-visible {
    opacity: 1;
  }

  /* Where nothing hovers, the link is always shown. */
  @media (hover: none) {
    .section-link {
      opacity: 1;
    }
  }
</style>
