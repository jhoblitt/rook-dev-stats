<!--
  A person in a table cell: their GitHub handle, a link to their page there
  when the login has the form of one, a mark when the account is a bot, what
  the pooled deleted account stands for, and, where a filter by them applies,
  a control that sets or clears it.
-->
<script lang="ts">
  import type { Handle } from '../lib/handles';

  interface Props {
    handle: Handle;
    bot: boolean;
    /** The filter by this person, if any; its control reads "Filter by <login> as <role>". */
    filter?: { role: string; active: boolean; ontoggle: () => void };
  }

  let { handle, bot, filter }: Props = $props();
</script>

<span class="person">
  {#if handle.url}
    <a href={handle.url} target="_blank" rel="noopener noreferrer" aria-label="{handle.text} on GitHub, opens in a new tab"
      >{handle.text}</a
    >
  {:else}
    <span title={handle.note}>{handle.text}</span>{#if handle.note}<span class="visually-hidden">{` (${handle.note})`}</span>{/if}
  {/if}
  {#if bot}
    <span class="bot">bot</span>
  {/if}
  {#if filter}
    <button
      type="button"
      class="filter"
      aria-pressed={filter.active}
      title="Filter by {handle.text} as {filter.role}"
      onclick={filter.ontoggle}
      ><span class="visually-hidden">Filter by {handle.text} as {filter.role}</span><span aria-hidden="true">filter</span
      ></button
    >
  {/if}
</span>

<style>
  .person {
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-2);
  }

  .bot {
    padding: 0 var(--space-1);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    color: var(--text-muted);
  }

  .filter {
    padding: 0 var(--space-1);
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-muted);
    font: inherit;
    cursor: pointer;
  }

  .filter:hover {
    color: var(--accent);
    border-color: var(--border-strong);
  }

  .filter[aria-pressed='true'] {
    color: var(--accent-ink);
    background: var(--accent);
  }
</style>
