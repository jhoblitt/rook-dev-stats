<!--
  Above the report's sections: that the period reaches back before GitHub
  recorded reviews, and where the methods page says what that leaves out.
  Nothing while the period starts after.
-->
<script lang="ts">
  import { getPage } from '../lib/page';
  import { REVIEWS_RECORDED_SECTION, reviewsRecordedNote } from '../lib/review';
  import { sectionHash } from '../lib/state';

  const { meta, selection, view } = getPage();
  const text = $derived(reviewsRecordedNote($view.filters));
</script>

{#if text !== null}
  <p class="reviews-note" role="note">
    {text}
    <a href={sectionHash($selection, REVIEWS_RECORDED_SECTION, meta)}>What the data holds before reviews were recorded</a>.
  </p>
{/if}

<style>
  .reviews-note {
    margin: 0;
    max-width: 48rem;
    padding: var(--space-2) var(--space-3);
    border-inline-start: 3px solid var(--border-strong);
    font-size: var(--text-sm);
    color: var(--text-muted);
  }
</style>
