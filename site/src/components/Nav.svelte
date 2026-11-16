<script lang="ts">
  import { getPage } from '../lib/page';
  import { type Route, routeHash } from '../lib/state';

  const { meta, selection } = getPage();

  const links: { route: Route; label: string }[] = [
    { route: 'report', label: 'Statistics' },
    { route: 'methods', label: 'Methods' },
  ];
</script>

<nav aria-label="Pages">
  <ul>
    {#each links as link (link.route)}
      <li>
        <!-- Each link carries the filters and selection, so the methods page and back keeps them. -->
        <a
          href={routeHash($selection, link.route, meta)}
          aria-current={$selection.route === link.route ? 'page' : undefined}
        >
          {link.label}
        </a>
      </li>
    {/each}
  </ul>
</nav>

<style>
  ul {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  a {
    display: block;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    text-decoration: none;
    font-weight: 500;
  }

  a:hover {
    color: var(--text);
    background: var(--accent-wash);
  }

  a[aria-current='page'] {
    color: var(--text);
    box-shadow: inset 0 -2px 0 var(--accent);
  }

  @media (width < 720px) {
    ul {
      margin-inline-start: calc(-1 * var(--space-3));
    }
  }
</style>
