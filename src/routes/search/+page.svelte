<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import Button from '$lib/components/atoms/Button.svelte';
  import BookCardClean from '$lib/components/molecules/BookCardClean.svelte';
  import CardGridSkeleton from '$lib/components/shells/CardGridSkeleton.svelte';
  import EmptyState from '$lib/components/shells/EmptyState.svelte';
  import { CATALOG_SORT_OPTIONS, searchStore } from '$lib/state/search.svelte';
  import { catalogStore } from '$lib/state/catalog.svelte';
  import { shelfStore } from '$lib/state/shelf.svelte';
  import { applySearchParams } from '$lib/utils/search-params';
  import { countLabel } from '$lib/utils/format';
  import { RATING_BOUNDS } from '$lib/utils/ratings';
  import type { Book, BookSortField, SortDirection } from '$lib/types/domain';

  /**
   * Catalog search.
   *
   * Filters live in the query string so any result view can be shared or
   * bookmarked; the store keeps the debounced in-memory engine and the
   * cursor-backed server paging. Typing updates the URL without pushing history
   * entries, so the back button returns to the previous page, not the previous
   * keystroke.
   */
  const queryFieldId = $props.id();
  const genreFieldId = `${queryFieldId}-genre`;
  const ratingFieldId = `${queryFieldId}-rating`;
  const sortFieldId = `${queryFieldId}-sort`;

  let searchInput: HTMLInputElement | null = $state(null);
  let initialized = $state(false);
  /** Last query string written by this page, so the URL effect ignores our own writes. */
  let mirroredSearch = $state<string | null>(null);

  function applyParams(search: URLSearchParams): void {
    applySearchParams(search, searchStore);
  }

  $effect(() => {
    if (initialized) return;
    initialized = true;
    applyParams(page.url.searchParams);
    void catalogStore.loadGenres();
    void searchStore.flush();
  });

  // Inbound links (a genre chip, a header search) update the filters.
  $effect(() => {
    const search = page.url.search;
    if (!initialized || search === mirroredSearch) return;
    applyParams(page.url.searchParams);
    void searchStore.flush();
  });

  // Filter changes are mirrored into the URL after the reader pauses typing.
  $effect(() => {
    const target = urlForFilters();
    if (!initialized || target === page.url.pathname + page.url.search) return;

    const timer = setTimeout(() => {
      const url = new URL(target, window.location.origin);
      mirroredSearch = url.search;
      void goto(target, { replaceState: true, keepFocus: true, noScroll: true });
    }, 250);

    return () => clearTimeout(timer);
  });

  const filters = $derived(searchStore.filters);
  const results = $derived(searchStore.results);
  const activeFilterCount = $derived(searchStore.activeFilterCount);

  /** Canonical URL for the current filters; defaults are omitted. */
  function urlForFilters(): string {
    const params = new URLSearchParams();
    if (filters.query.trim().length > 0) params.set('q', filters.query.trim());
    if (filters.genre) params.set('genre', filters.genre);
    if (filters.minRating > 0) params.set('rating', String(filters.minRating));
    if (filters.sortBy !== 'bayesianRating') params.set('sort', filters.sortBy);
    if (filters.sortDirection !== 'desc') params.set('dir', filters.sortDirection);

    const query = params.toString();
    return query.length > 0 ? `/search?${query}` : '/search';
  }

  function clearFilters(): void {
    searchStore.clearFilters();
    searchInput?.focus();
  }

  async function handleShelfChange(book: Book, status: Parameters<typeof shelfStore.setStatus>[1]) {
    try {
      await shelfStore.setStatus(book, status);
    } catch {
      // The store records the reader-facing failure; the card restores itself.
    }
  }
</script>

<svelte:head>
  <title>Search the catalog — SvelteReads</title>
  <meta name="description" content="Search by title, author, genre, or minimum rating and sort by community score." />
</svelte:head>

<header class="mb-5">
  <h1 class="text-balance font-serif text-3xl font-semibold text-stone-900 sm:text-4xl dark:text-stone-50">
    Search the catalog
  </h1>
  <p class="mt-1 text-sm text-stone-600 dark:text-stone-400">
    Filter by genre and minimum rating, then sort by community score, popularity, or title.
  </p>
</header>

<form class="mb-5" role="search" onsubmit={(event) => event.preventDefault()}>
  <label class="sr-only" for={queryFieldId}>Search books</label>
  <div class="relative">
    <svg
      class="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-stone-400"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      aria-hidden="true"
    >
      <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
    <input
      id={queryFieldId}
      bind:this={searchInput}
      type="search"
      name="q"
      value={filters.query}
      oninput={(event) => searchStore.setQuery(event.currentTarget.value)}
      placeholder="Title, author, ISBN, or publisher…"
      autocomplete="off"
      enterkeyhint="search"
      class="h-12 w-full rounded-[var(--radius-control)] border border-stone-300 bg-white pl-10 pr-3 text-base text-stone-900 placeholder:text-stone-400 focus:border-primary-500 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
    />
  </div>

  <div class="mt-3 grid gap-3 sm:grid-cols-3">
    <div class="flex flex-col gap-1">
      <label class="text-sm font-medium text-stone-700 dark:text-stone-300" for={genreFieldId}>Genre</label>
      <select
        id={genreFieldId}
        name="genre"
        value={filters.genre}
        onchange={(event) => searchStore.setGenre(event.currentTarget.value)}
        class="h-11 rounded-[var(--radius-control)] border border-stone-300 bg-white px-3 text-sm text-stone-900 focus:border-primary-500 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
      >
        <option value="">All genres</option>
        {#each catalogStore.genres as genre (genre)}
          <option value={genre}>{genre}</option>
        {/each}
      </select>
    </div>

    <div class="flex flex-col gap-1">
      <label class="text-sm font-medium text-stone-700 dark:text-stone-300" for={ratingFieldId}>Minimum rating</label>
      <select
        id={ratingFieldId}
        name="rating"
        value={String(filters.minRating)}
        onchange={(event) => searchStore.setMinRating(Number.parseInt(event.currentTarget.value, 10))}
        class="h-11 rounded-[var(--radius-control)] border border-stone-300 bg-white px-3 text-sm text-stone-900 focus:border-primary-500 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
      >
        <option value="0">Any rating</option>
        <option value="3">3 stars and up</option>
        <option value="4">4 stars and up</option>
        <option value="4.5">4.5 stars and up</option>
        <option value="5">5 stars only</option>
      </select>
    </div>

    <div class="flex flex-col gap-1">
      <label class="text-sm font-medium text-stone-700 dark:text-stone-300" for={sortFieldId}>Sort by</label>
      <select
        id={sortFieldId}
        name="sort"
        value={`${filters.sortBy}:${filters.sortDirection}`}
        onchange={(event) => searchStore.setSortOption(event.currentTarget.value)}
        class="h-11 rounded-[var(--radius-control)] border border-stone-300 bg-white px-3 text-sm text-stone-900 focus:border-primary-500 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
      >
        {#each CATALOG_SORT_OPTIONS as option (option.value)}
          <option value={option.value}>{option.label}</option>
        {/each}
      </select>
    </div>
  </div>

  <div class="mt-3 flex flex-wrap items-center gap-3 text-sm">
    <p aria-live="polite" class="text-stone-600 dark:text-stone-400">
      {#if searchStore.isLoading && results.length === 0}
        Searching…
      {:else if results.length === 0}
        No matches yet
      {:else}
        {countLabel(results.length, 'result')}
        {#if searchStore.hasMore}so far{/if}
      {/if}
    </p>

    {#if activeFilterCount > 0}
      <button
        type="button"
        class="rounded-[var(--radius-control)] px-2 py-1 font-medium text-primary-700 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 dark:text-primary-300"
        onclick={clearFilters}
      >
        Clear {activeFilterCount === 1 ? 'filter' : `${activeFilterCount} filters`}
      </button>
    {/if}

    <span class="ml-auto text-xs text-stone-500 dark:text-stone-400">
      Ratings run {RATING_BOUNDS.MIN}–{RATING_BOUNDS.MAX} stars in {RATING_BOUNDS.STEP} steps
    </span>
  </div>
</form>

{#if searchStore.error && results.length === 0}
  <EmptyState
    tone="warning"
    title="The catalog could not be searched"
    description={searchStore.error}
  >
    {#snippet action()}
      <Button variant="primary" size="sm" onclick={() => void searchStore.search()}>Try again</Button>
    {/snippet}
  </EmptyState>
{:else if searchStore.isLoading && results.length === 0}
  <CardGridSkeleton count={8} label="Searching the catalog…" />
{:else if results.length === 0}
  <EmptyState
    title="No books match those filters"
    description={activeFilterCount > 0
      ? 'Try a shorter search term, a broader genre, or a lower minimum rating.'
      : 'The catalog returned no titles. Check the connection and try again.'}
    icon="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
  >
    {#snippet action()}
      {#if activeFilterCount > 0}
        <Button variant="primary" size="sm" onclick={clearFilters}>Clear filters</Button>
      {/if}
      <Button variant="secondary" size="sm" href="/">Back to discovery</Button>
    {/snippet}
  </EmptyState>
{:else}
  <ul class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
    {#each results as book, index (book.id)}
      <li class="flex">
        <BookCardClean
          {book}
          currentShelf={shelfStore.statusFor(book.id)}
          priority={index < 4}
          onShelfChange={(status) => handleShelfChange(book, status)}
          class="w-full"
        />
      </li>
    {/each}
  </ul>

  {#if searchStore.hasMore}
    <div class="mt-6 flex justify-center">
      <Button
        variant="secondary"
        size="md"
        loading={searchStore.isLoading}
        onclick={() => void searchStore.loadMore()}
      >
        {searchStore.isLoading ? 'Loading…' : 'Load more results'}
      </Button>
    </div>
  {/if}
{/if}
