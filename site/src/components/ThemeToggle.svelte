<script lang="ts">
  import { onMount } from 'svelte';
  import { type Theme, chooseTheme, currentTheme } from '../lib/theme';

  let theme = $state<Theme>(currentTheme(document, window));
  const next = $derived<Theme>(theme === 'dark' ? 'light' : 'dark');

  onMount(() => {
    // Until the reader chooses, the system preference can change under us.
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const follow = () => (theme = currentTheme(document, window));
    query.addEventListener('change', follow);
    return () => query.removeEventListener('change', follow);
  });

  function toggle() {
    chooseTheme(next, document, window);
    theme = next;
  }
</script>

<button type="button" class="toggle" onclick={toggle} aria-label={`Switch to ${next} theme`} title={`Switch to ${next} theme`}>
  {#if theme === 'dark'}
    <!-- Sun: the light theme is one click away. -->
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <circle cx="12" cy="12" r="4.5" />
      <path
        d="M12 2v2.5M12 19.5V22M4.93 4.93l1.77 1.77M17.3 17.3l1.77 1.77M2 12h2.5M19.5 12H22M4.93 19.07l1.77-1.77M17.3 6.7l1.77-1.77"
      />
    </svg>
  {:else}
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z" />
    </svg>
  {/if}
</button>

<style>
  .toggle {
    display: inline-grid;
    place-items: center;
    width: 2.5rem;
    height: 2.5rem;
    padding: 0;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    cursor: pointer;
  }

  .toggle:hover {
    background: var(--accent-wash);
  }

  svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
