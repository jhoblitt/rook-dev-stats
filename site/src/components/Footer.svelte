<script lang="ts">
  import { REPO_URL, formatVersion } from '../lib/version';

  const version = formatVersion(__APP_VERSION__);
  const repoLabel = REPO_URL.replace(/^https:\/\//, '');
</script>

<footer class="site-footer">
  <div class="inner">
    {#if version.href}
      <a class="num" href={version.href}>{version.label}</a>
    {:else}
      <span class="num">{version.label}</span>
    {/if}
    <span aria-hidden="true">·</span>
    <a href={REPO_URL}>{repoLabel}</a>
  </div>
</footer>

<style>
  .site-footer {
    margin-top: var(--space-8);
    border-top: 1px solid var(--border);
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  .inner {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    max-width: var(--content-max);
    margin: 0 auto;
    padding: var(--space-5);
  }

  a {
    color: var(--text-muted);
  }

  a:hover {
    color: var(--accent);
  }
</style>
