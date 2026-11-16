<!--
  One methods section, drawn node by node from its parsed Markdown. Nothing
  is inserted as HTML: text, figures included, goes in as text.
-->
<script lang="ts">
  import type { Inline, Section } from './markdown';
  import type { TableModel, View } from './present';

  interface Props {
    section: Section;
    inline: (name: string) => View<string>;
    table: (name: string) => View<TableModel>;
    /** The address of a section or subheading of this page. */
    href: (id: string) => string;
    /** Follows a link to the section or subheading with this id. */
    go: (event: MouseEvent, id: string) => void;
  }

  let { section, inline, table, href, go }: Props = $props();

  // Only an https address leaves the page; any other is drawn as its text.
  const isExternal = (address: string) => /^https:\/\/[^\s]+$/.test(address);
</script>

{#snippet figure(name: string)}
  {@const v = inline(name)}
  {#if v.state === 'ready'}
    <span class="figure">{v.value}</span>
  {:else if v.state === 'loading'}
    <span class="figure pending">…<span class="visually-hidden"> (loading)</span></span>
  {:else}
    <span class="figure pending">(not available)</span>
  {/if}
{/snippet}

{#snippet nodes(list: Inline[])}
  {#each list as node, i (i)}
    {#if node.type === 'text'}{node.text}{:else if node.type === 'code'}<code>{node.text}</code
      >{:else if node.type === 'em'}<em>{@render nodes(node.children)}</em
      >{:else if node.type === 'strong'}<strong>{@render nodes(node.children)}</strong
      >{:else if node.type === 'figure'}{@render figure(node.name)}{:else if node.href.startsWith('#')}<a
        href={href(node.href.slice(1))}
        onclick={(e) => go(e, node.href.slice(1))}>{@render nodes(node.children)}</a
      >{:else if isExternal(node.href)}<a href={node.href}>{@render nodes(node.children)}</a
      >{:else}{@render nodes(node.children)}{/if}
  {/each}
{/snippet}

<section id={section.id} class="methods-section" aria-labelledby="{section.id}-title" tabindex="-1">
  <h2 id="{section.id}-title">{section.title}</h2>
  {#each section.blocks as block, i (i)}
    {#if block.type === 'paragraph'}
      <p>{@render nodes(block.children)}</p>
    {:else if block.type === 'heading'}
      <h3 id={block.id} tabindex="-1">{@render nodes(block.children)}</h3>
    {:else if block.type === 'list'}
      <ul>
        {#each block.items as item, j (j)}
          <li>{@render nodes(item)}</li>
        {/each}
      </ul>
    {:else}
      {@const v = table(block.name)}
      <figure class="figure-table">
        {#if v.state === 'ready'}
          <div class="scroll">
            <table>
              <caption>{v.value.caption}</caption>
              <thead>
                <tr>
                  {#each v.value.head as cell, c (c)}
                    <th scope="col">{cell}</th>
                  {/each}
                </tr>
              </thead>
              <tbody>
                {#each v.value.rows as row, r (r)}
                  <tr>
                    {#each row as cell, c (c)}
                      {#if c === 0}
                        <th scope="row">{cell}</th>
                      {:else}
                        <td>{cell}</td>
                      {/if}
                    {/each}
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {:else if v.state === 'loading'}
          <p class="pending">Loading the data this table is computed from…</p>
        {:else}
          <p class="pending">This table could not be computed: its data did not load.</p>
        {/if}
      </figure>
    {/if}
  {/each}
</section>

<style>
  .methods-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    scroll-margin-top: var(--space-4);
  }

  .methods-section:focus,
  h3:focus {
    outline: none;
  }

  h2 {
    margin: 0;
  }

  h3 {
    margin: var(--space-3) 0 0;
    scroll-margin-top: var(--space-4);
  }

  p,
  ul {
    margin: 0;
    max-width: var(--measure);
  }

  li + li {
    margin-top: var(--space-2);
  }

  .figure {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    white-space: nowrap;
  }

  .pending {
    color: var(--text-muted);
  }

  .figure-table {
    margin: 0;
  }

  .scroll {
    overflow-x: auto;
  }

  table {
    width: 100%;
    max-width: var(--measure);
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
  }

  caption {
    caption-side: top;
    text-align: left;
    color: var(--text-muted);
    padding-bottom: var(--space-2);
    max-width: var(--measure);
  }

  th,
  td {
    padding: var(--space-1) var(--space-3);
    border-bottom: 1px solid var(--border);
    text-align: right;
    vertical-align: top;
  }

  td {
    white-space: nowrap;
  }

  th[scope='row'],
  thead th:first-child {
    text-align: left;
    font-weight: normal;
    padding-left: 0;
  }

  thead th {
    font-weight: 600;
  }

</style>
