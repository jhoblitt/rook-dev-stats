<script lang="ts">
  import { get } from 'svelte/store';
  import {
    BACKPORT_LINKS,
    type Choice,
    DISCLOSURES,
    type Filters,
    SIZE_BANDS,
    STANDING_BANDS,
    TARGETS,
    UNKNOWN_KIND,
    findChoice,
  } from '../lib/filters';
  import { formatCount } from '../lib/format';
  import { findLogin, loginHandle, personHandle } from '../lib/handles';
  import { getPage } from '../lib/page';
  import { branchChoices } from '../lib/select';
  import { RECENT_MONTHS, dataDays, recentFilters } from '../lib/state';
  import { formatDate } from '../lib/timeline-axis';

  const { meta, selection, view } = getPage();
  const uid = $props.id();
  const { first, last } = dataDays(meta);
  const recent = recentFilters(meta);
  const filters = $derived($selection.filters);

  // A period the reader can reach in one choice, which the date inputs reach
  // only a field at a time: the whole window, the default, and the last six
  // months when the window reaches further back. A window no longer than
  // that is the whole window, so it is one choice, named for what it is.
  // The whole window's short name stands in for its full one on a narrow pinned bar.
  const whole = { label: `All, from ${formatDate(meta.window_start)}`, short: 'All', from: first, to: last };
  const presets: { label: string; short?: string; from: string; to: string }[] = [
    ...(first < recent.from ? [{ label: `Last ${RECENT_MONTHS} months`, from: recent.from, to: recent.to }] : []),
    whole,
  ];

  function set(patch: Partial<Filters>) {
    selection.update((s) => ({ ...s, filters: { ...s.filters, ...patch } }));
  }

  // A day the state rejects (outside the data, or past the other end) leaves
  // the state as it was; show that rather than what was typed.
  function setDay(which: 'from' | 'to', input: HTMLInputElement) {
    set(which === 'from' ? { from: input.value } : { to: input.value });
    input.value = get(selection).filters[which];
  }

  type PersonFilter = 'author' | 'reviewer';
  // The Reviewer filter's dependence on the period is shown, not only hinted, since it narrows every section.
  const PEOPLE: { id: PersonFilter; label: string; hint: string; shown: boolean }[] = [
    {
      id: 'author',
      label: 'Author',
      hint:
        meta.people_deleted.length > 0
          ? 'PRs opened by this GitHub login, or by a deleted account under the name on its commits'
          : 'PRs this GitHub login opened',
      shown: false,
    },
    { id: 'reviewer', label: 'Reviewer', hint: 'PRs reviewed or commented on in the period', shown: true },
  ];
  const bots = new Set(meta.people_bots);
  // Each person as the page writes them, which is what the inputs show and take.
  const choices = meta.people.map((_, i) => ({ handle: personHandle(meta, i), bot: bots.has(i) }));
  // What was typed that the data does not name, by filter, until the next change.
  let unknown = $state<Record<PersonFilter, string | null>>({ author: null, reviewer: null });

  const shown = (login: string | null) => (login === null ? null : loginHandle(meta, login));

  // A login in any case, or a person as the page writes them, is the entry
  // the data gives; one it does not name leaves the filter as it was, and
  // says so.
  function setPerson(which: PersonFilter, input: HTMLInputElement) {
    const typed = input.value.trim();
    const login = typed === '' ? null : findLogin(meta, typed);
    unknown[which] = typed !== '' && login === null ? typed : null;
    if (typed === '' || login !== null) setLogin(which, login);
    input.value = shown(get(selection).filters[which])?.text ?? '';
  }

  function setLogin(which: PersonFilter, login: string | null) {
    set(which === 'author' ? { author: login } : { reviewer: login });
  }

  function clearPerson(which: PersonFilter) {
    unknown[which] = null;
    setLogin(which, null);
  }

  const unknownText = (typed: string | null) => (typed === null ? '' : `No PR in the data names “${typed}”.`);

  // The branches of the reader's target, counted over the period the figures
  // are for, which is the reader's once its years have loaded.
  const branches = $derived(branchChoices($view.dataset, { ...$view.filters, target: filters.target }));
  const branchHint = 'A branch of the target, its PRs in the period counted';
  let unknownBranch = $state<string | null>(null);

  // A branch's name as given, or in another case when only one branch of the
  // target has it; one the target does not hold leaves the filter as it was.
  function findBranch(typed: string): string | null {
    const exact = branches.find((b) => b.base === typed);
    if (exact) return exact.base;
    const folded = branches.filter((b) => b.base.toLowerCase() === typed.toLowerCase());
    return folded.length === 1 ? (folded[0]?.base ?? null) : null;
  }

  function setBranch(input: HTMLInputElement) {
    const typed = input.value.trim();
    const base = typed === '' ? null : findBranch(typed);
    unknownBranch = typed !== '' && base === null ? typed : null;
    if (typed === '' || base !== null) set({ base });
    input.value = get(selection).filters.base ?? '';
  }

  function clearBranch() {
    unknownBranch = null;
    set({ base: null });
  }

  const linksHint = $derived(
    [
      'Mergify’s “automatic backport of pull request #N”, a “backport of #N” line, or a “(backport #N)” or “(bp #N)” title; most release-branch PRs before 2020 have none.',
      ...($view.dataset.linksUnrecorded.length > 0
        ? [`The data for ${$view.dataset.linksUnrecorded.join(', ')} does not record it, so every PR there counts as no link.`]
        : []),
    ].join(' '),
  );

  interface Select {
    id: string;
    label: string;
    value: string;
    options: readonly Choice<string>[];
    change(value: string): void;
    hint?: string;
  }

  // The empty value stands for no filter.
  const all: Choice<string> = { id: '', label: 'all' };

  const selects: Select[] = $derived([
    {
      id: 'backport',
      label: 'Backport link',
      value: filters.backportLink ?? '',
      options: [{ id: '', label: 'any' }, ...BACKPORT_LINKS],
      change: (v) => set({ backportLink: findChoice(BACKPORT_LINKS, v) }),
      hint: linksHint,
    },
    {
      id: 'component',
      label: 'Component',
      value: filters.component ?? '',
      options: [all, ...meta.components.map((c) => ({ id: c.id, label: c.name }))],
      change: (v) => set({ component: v === '' ? null : v }),
    },
    {
      id: 'kind',
      label: 'Kind',
      value: filters.kind ?? '',
      options: [all, ...meta.kinds.map((k) => ({ id: k.id, label: k.name })), UNKNOWN_KIND],
      change: (v) => set({ kind: v === '' ? null : v }),
    },
    {
      id: 'size',
      label: 'Size (lines added and deleted)',
      value: filters.size ?? '',
      options: [all, ...SIZE_BANDS],
      change: (v) => set({ size: findChoice(SIZE_BANDS, v) }),
    },
    {
      id: 'standing',
      label: 'Author standing (earlier PRs)',
      value: filters.standing ?? '',
      options: [all, ...STANDING_BANDS],
      change: (v) => set({ standing: findChoice(STANDING_BANDS, v) }),
    },
    {
      id: 'disclosure',
      label: 'AI use disclosure',
      value: filters.disclosure ?? '',
      options: [all, ...DISCLOSURES],
      change: (v) => set({ disclosure: findChoice(DISCLOSURES, v) }),
    },
    {
      id: 'drafts',
      label: 'Drafts',
      value: filters.excludeDrafts ? 'exclude' : '',
      options: [
        { id: '', label: 'include' },
        { id: 'exclude', label: 'exclude' },
      ],
      change: (v) => set({ excludeDrafts: v === 'exclude' }),
    },
    {
      id: 'reopened',
      label: 'Reopened',
      value: filters.reopenedOnly ? 'only' : '',
      options: [all, { id: 'only', label: 'reopened only' }],
      change: (v) => set({ reopenedOnly: v === 'only' }),
    },
  ]);

  // Once the reader scrolls past the Period row, the row itself, the same
  // controls, is pinned to the top of the viewport, and its place in the bar
  // keeps the size the row had there, so nothing on the page moves and
  // pinning never moves the place it is decided by.
  let bar = $state<HTMLElement>();
  let place = $state<HTMLElement>();
  let banner = $state<HTMLElement>();
  let held = $state<{ width: number; height: number } | null>(null);
  const pinned = $derived(held !== null);

  // The row's size laid out in its place; a pinned row is put back there for
  // the measure and pinned again before anything is drawn.
  function measure(el: HTMLElement) {
    const was = el.classList.contains('pinned');
    el.classList.remove('pinned');
    const { width, height } = el.getBoundingClientRect();
    if (was) el.classList.add('pinned');
    return { width, height };
  }

  function follow() {
    if (!place) return;
    const past = place.getBoundingClientRect().top < 0;
    if (past && held === null) held = measure(place);
    else if (!past && held !== null) held = null;
  }

  // A new width lays the row out anew in its place.
  function resized() {
    if (place && held !== null) held = measure(place);
    follow();
  }

  $effect(() => {
    follow();
    window.addEventListener('scroll', follow, { passive: true });
    window.addEventListener('resize', resized);
    return () => {
      window.removeEventListener('scroll', follow);
      window.removeEventListener('resize', resized);
    };
  });

  // What the page scrolls to clears the pinned row: its height as drawn,
  // which the style gives before it is first drawn.
  $effect(() => {
    const el = banner;
    if (!pinned || el === undefined || typeof ResizeObserver !== 'function') return;
    const root = document.documentElement;
    const observer = new ResizeObserver(() => root.style.setProperty('--period-banner', `${el.offsetHeight}px`));
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--period-banner');
    };
  });

  function toFilters() {
    bar?.scrollIntoView({ block: 'start' });
    bar?.focus({ preventScroll: true });
  }
</script>

<section class="filter-bar" aria-labelledby="{uid}-heading" tabindex="-1" bind:this={bar}>
  <h2 id="{uid}-heading" class="visually-hidden">Filters</h2>

  <div
    class="period-slot"
    class:pinned
    bind:this={place}
    style:--held-width={held ? `${held.width}px` : undefined}
    style:--held-height={held ? `${held.height}px` : undefined}
  >
    <div class="period-banner" bind:this={banner}>
      <div class="period-row">
        <fieldset>
          <legend>Period</legend>
          <div class="days">
            <div class="field">
              <label for="{uid}-from">From</label>
              <input
                id="{uid}-from"
                type="date"
                min={first}
                max={filters.to}
                value={filters.from}
                onchange={(e) => setDay('from', e.currentTarget)}
              />
            </div>
            <div class="field">
              <label for="{uid}-to">To</label>
              <input
                id="{uid}-to"
                type="date"
                min={filters.from}
                max={last}
                value={filters.to}
                onchange={(e) => setDay('to', e.currentTarget)}
              />
            </div>
            <div class="presets">
              {#each presets as p (p.label)}
                <button
                  type="button"
                  aria-pressed={filters.from === p.from && filters.to === p.to ? 'true' : 'false'}
                  data-short={p.short}
                  onclick={() => set({ from: p.from, to: p.to })}><span class="full">{p.label}</span></button
                >
              {/each}
            </div>
          </div>
        </fieldset>
        {#if pinned}
          <button type="button" class="to-filters" onclick={toFilters}><span aria-hidden="true">↑</span> Filters</button>
        {/if}
      </div>
    </div>
  </div>

  <fieldset>
    <legend>Target</legend>
    <div class="segmented">
      {#each TARGETS as t (t.id)}
        <label>
          <input
            type="radio"
            name="{uid}-target"
            value={t.id}
            checked={filters.target === t.id}
            onchange={() => set({ target: t.id })}
          />
          <span>{t.label}</span>
        </label>
      {/each}
    </div>
  </fieldset>

  <div class="field">
    <label for="{uid}-base">Branch</label>
    <div class="branch">
      <input
        id="{uid}-base"
        type="text"
        list="{uid}-bases"
        value={filters.base ?? ''}
        placeholder="any branch"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        aria-describedby={unknownBranch === null ? `${uid}-base-hint` : `${uid}-base-hint ${uid}-base-unknown`}
        onchange={(e) => setBranch(e.currentTarget)}
      />
      {#if filters.base !== null}
        <button type="button" aria-label="Clear the Branch filter" onclick={clearBranch}>clear</button>
      {/if}
    </div>
    <p class="hint" id="{uid}-base-hint">{branchHint}</p>
    <p class="unknown" id="{uid}-base-unknown" role="status">
      {unknownBranch === null ? '' : `No branch of this target is named “${unknownBranch}”.`}
    </p>
  </div>
  <datalist id="{uid}-bases">
    {#each branches as b (b.base)}
      <option value={b.base}>{formatCount(b.count)} {b.count === 1 ? 'PR' : 'PRs'}</option>
    {/each}
  </datalist>

  {#each selects as f (f.id)}
    <div class="field">
      <label for="{uid}-{f.id}">{f.label}</label>
      <select
        id="{uid}-{f.id}"
        value={f.value}
        aria-describedby={f.hint === undefined ? undefined : `${uid}-${f.id}-hint`}
        onchange={(e) => f.change(e.currentTarget.value)}
      >
        {#each f.options as o (o.id)}
          <option value={o.id}>{o.label}</option>
        {/each}
      </select>
      {#if f.hint !== undefined}
        <p class="hint" id="{uid}-{f.id}-hint">{f.hint}</p>
      {/if}
    </div>
  {/each}

  <div class="people">
    {#each PEOPLE as f (f.id)}
      {@const value = filters[f.id]}
      {@const person = shown(value)}
      <div class="field">
        <label for="{uid}-{f.id}">{f.label}</label>
        <div class="person">
          <input
            id="{uid}-{f.id}"
            type="text"
            list="{uid}-people"
            value={person?.text ?? ''}
            placeholder="any GitHub login"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            title={f.hint}
            aria-describedby={[
              f.shown ? `${uid}-${f.id}-hint` : '',
              person?.note ? `${uid}-${f.id}-note` : '',
              unknown[f.id] === null ? '' : `${uid}-${f.id}-unknown`,
            ]
              .filter(Boolean)
              .join(' ') || undefined}
            onchange={(e) => setPerson(f.id, e.currentTarget)}
          />
          {#if value !== null}
            <button type="button" aria-label="Clear the {f.label} filter" onclick={() => clearPerson(f.id)}>clear</button>
          {/if}
        </div>
        {#if f.shown}
          <p class="hint" id="{uid}-{f.id}-hint">{f.hint}</p>
        {/if}
        {#if person?.note}
          <p class="hint" id="{uid}-{f.id}-note">{person.text}: {person.note}</p>
        {/if}
        <p class="unknown" id="{uid}-{f.id}-unknown" role="status">{unknownText(unknown[f.id])}</p>
      </div>
    {/each}
  </div>
  <datalist id="{uid}-people">
    {#each choices as c (c.handle.login)}
      <option value={c.handle.text}>{c.handle.note ?? (c.bot ? 'bot' : '')}</option>
    {/each}
  </datalist>
</section>

<style>
  /* Every field is a label line, a control of one height beneath it, and any
     hint beneath that. The fields of a row align at the top, so their labels
     share a line and their controls a top edge, and a hint hangs below its
     own control without moving another field. A group's legend is its label
     line, and the Period's From and To sit beside their inputs on the
     control line, so its dates and choices line up with the other controls. */
  .filter-bar {
    --label-line: 1.25rem;
    --control-height: 2.375rem;
    display: flex;
    flex-wrap: wrap;
    align-items: start;
    gap: var(--space-4) var(--space-5);
    padding: var(--space-4) var(--space-5);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
  }

  /* Every control fits the bar's width on a narrow phone: a field may be no
     wider than the bar, and what is in it shrinks or wraps. */
  .period-slot,
  fieldset,
  .field,
  .people,
  .person,
  .branch {
    min-width: 0;
    max-width: 100%;
  }

  fieldset {
    margin: 0;
    padding: 0;
    border: 0;
  }

  legend,
  .field label {
    color: var(--text-muted);
    font-size: var(--text-sm);
    line-height: var(--label-line);
  }

  /* Floated, a legend is laid out in its fieldset's flow, one label line
     tall, and what follows it clears it onto the control line. */
  legend {
    float: left;
    padding: 0;
    margin-bottom: var(--space-1);
  }

  .days {
    clear: both;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .days .field {
    flex-direction: row;
    align-items: center;
    gap: var(--space-2);
  }

  /* From and To take one width, so the dates line up when they wrap onto lines of their own. */
  .days .field label {
    min-width: 2.5rem;
  }

  input[type='date'],
  input[type='text'],
  select {
    box-sizing: border-box;
    height: var(--control-height);
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--page);
    color: var(--text);
    font: inherit;
    font-size: var(--text-base);
  }

  input[type='text'] {
    width: 13rem;
    min-width: 0;
    flex: 0 1 auto;
  }

  .people {
    display: flex;
    flex-wrap: wrap;
    align-items: start;
    gap: var(--space-4) var(--space-5);
  }

  .person,
  .branch {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }

  .presets {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .presets button[aria-pressed='true'] {
    background: var(--accent);
    color: var(--accent-ink);
  }

  .presets button:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }

  .person button,
  .branch button,
  .presets button,
  .to-filters {
    box-sizing: border-box;
    height: var(--control-height);
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--page);
    color: var(--accent);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .hint,
  .unknown {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  .hint {
    max-width: 16rem;
  }

  /* Out of the flow while empty, but still rendered, so the live region announces. */
  .unknown:empty {
    position: absolute;
  }

  /* As wide as its options, and as tall as every other control. */
  .segmented {
    clear: both;
    box-sizing: border-box;
    display: flex;
    width: fit-content;
    max-width: 100%;
    height: var(--control-height);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }

  /* An option may narrow on a phone to its longest word, its words wrapping inside the control's height. */
  .segmented label {
    position: relative;
    display: flex;
  }

  .segmented label + label {
    border-left: 1px solid var(--border-strong);
  }

  /* The radio stays in the accessibility tree and takes focus; its label is the button. */
  .segmented input {
    position: absolute;
    opacity: 0;
    inset: 0;
    margin: 0;
    cursor: pointer;
  }

  .segmented span {
    display: flex;
    align-items: center;
    height: 100%;
    box-sizing: border-box;
    padding: 0 var(--space-3);
    color: var(--text);
    background: var(--page);
  }

  .segmented input:hover + span {
    background: var(--accent-wash);
  }

  .segmented input:checked + span {
    background: var(--accent);
    color: var(--accent-ink);
  }

  /* The ring of page colour keeps the focus outline visible on the accent fill. */
  .segmented input:focus-visible + span {
    outline: 2px solid var(--focus);
    outline-offset: -2px;
    box-shadow: inset 0 0 0 4px var(--page);
  }

  /* Pinned, the Period row is a bar across the top of the viewport, its
     controls in the page's column: the period at the left, and at the right
     a way back to the other filters. Nothing in it wraps, whatever the
     typeface: it is one line of controls on a wide screen and two on a
     narrower one, and what is too wide gives way inside its line. What the
     page scrolls to sits below the bar. */
  .filter-bar {
    --banner-pad: 0.375rem;
    --back-width: 6rem;
  }

  @media screen {
    :global(html:has(.period-slot)) {
      --period-banner: calc(1px + 2 * 0.375rem + 2.375rem);
      scroll-padding-top: var(--period-banner);
    }

    .pinned {
      width: var(--held-width);
      height: var(--held-height);
    }

    .pinned .period-banner {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 10;
      background: var(--surface);
      border-bottom: 1px solid var(--border-strong);
      box-shadow: 0 2px 8px light-dark(rgb(0 0 0 / 0.08), rgb(0 0 0 / 0.5));
    }

    /* The button sits over the end of the row's last line, which keeps room for it. */
    .pinned .period-row {
      display: grid;
      align-items: center;
      max-width: var(--content-max);
      margin: 0 auto;
      padding: var(--banner-pad) var(--space-5);
    }

    .pinned fieldset,
    .to-filters {
      grid-area: 1 / 1;
    }

    .to-filters {
      justify-self: end;
      width: var(--back-width);
    }

    .pinned legend {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }

    .pinned .days {
      flex-wrap: nowrap;
      gap: var(--banner-pad) var(--space-2);
    }

    .pinned .days .field {
      flex: none;
      gap: var(--space-1);
    }

    .pinned .days .field label {
      min-width: 0;
    }

    .pinned .presets {
      flex: 0 1 auto;
      flex-wrap: nowrap;
      min-width: 0;
      padding-inline-end: calc(var(--back-width) + var(--space-2));
    }

    /* A name too wide for its control is cut short, never wrapped. */
    .pinned .presets button,
    .to-filters {
      min-width: 0;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
  }

  /* Two lines: the dates side by side, a half of the line each, read From
     then To with their names left to assistive technology; under them the
     choices, the whole window's by its short name. */
  @media screen and (width < 52rem) {
    :global(html:has(.period-slot)) {
      --period-banner: calc(1px + 3 * 0.375rem + 2 * 2.375rem);
    }

    .pinned .days {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      grid-template-rows: var(--control-height) var(--control-height);
    }

    .pinned .days .field label,
    .pinned [data-short] .full {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }

    .pinned input[type='date'] {
      width: 100%;
      min-width: 0;
      padding-inline: var(--space-1);
    }

    .pinned .presets {
      grid-column: 1 / -1;
    }

    /* Drawn only, so the choice keeps its full name for assistive technology. */
    .pinned [data-short]::after {
      content: attr(data-short) / '';
    }

    .to-filters {
      align-self: end;
    }
  }

  @media screen and (width < 720px) {
    .pinned .period-row {
      padding-inline: var(--space-4);
    }
  }

  @media print {
    .to-filters {
      display: none;
    }
  }

  @media (width < 480px) {
    .filter-bar {
      padding: var(--space-3) var(--space-4);
    }

    /* Two lines of the smaller size fit the control's height. */
    .segmented span {
      padding: 0 var(--space-2);
      font-size: var(--text-sm);
      line-height: 1.15;
    }
  }
</style>
