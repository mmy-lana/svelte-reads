<script lang="ts">
  import { page } from '$app/state';
  import Button from '$lib/components/atoms/Button.svelte';
  import ProgressBar from '$lib/components/atoms/ProgressBar.svelte';
  import RatingStars from '$lib/components/atoms/RatingStars.svelte';
  import ReadingProgressWidget from '$lib/components/molecules/ReadingProgressWidget.svelte';
  import ShelfSelector from '$lib/components/molecules/ShelfSelector.svelte';
  import CardGridSkeleton from '$lib/components/shells/CardGridSkeleton.svelte';
  import EmptyState from '$lib/components/shells/EmptyState.svelte';
  import { authState } from '$lib/state/auth.svelte';
  import { catalogStore } from '$lib/state/catalog.svelte';
  import { shelfStore } from '$lib/state/shelf.svelte';
  import { formatPageCount, formatPercentage, formatRelativeDate } from '$lib/utils/format';
  import { SHELF_TABS } from '$lib/utils/shelf-state-machine';
  import type { Book, ShelfStatus, ShelfTabValue, UserBookShelf } from '$lib/types/domain';

  /**
   * Shelf management.
   *
   * The active tab and the layout toggle live in the query string, so a filtered
   * view can be linked, bookmarked, and restored with the back button. Rows are
   * rendered as a card grid or a dense table; both expose the same controls.
   */
  const VALID_TAB_VALUES: readonly ShelfTabValue[] = SHELF_TABS.map((tab) => tab.value);

  const activeTab = $derived<ShelfTabValue>(readTab(page.url.searchParams.get('tab')));
  const layout = $derived<'grid' | 'table'>(
    page.url.searchParams.get('view') === 'table' ? 'table' : 'grid'
  );

  let failure = $state<string | null>(null);
  let requestedUser = $state<string | null>(null);

  function readTab(value: string | null): ShelfTabValue {
    return VALID_TAB_VALUES.includes(value as ShelfTabValue) ? (value as ShelfTabValue) : 'all';
  }

  $effect(() => {
    const uid = authState.user?.uid ?? null;
    if (!uid || requestedUser === uid) return;
    requestedUser = uid;
    void shelfStore.loadShelves({ refresh: true });
  });

  $effect(() => {
    if (authState.status === 'anonymous') requestedUser = null;
  });

  const rows = $derived(
    activeTab === 'all' ? shelfStore.list : shelfStore.list.filter((row) => row.status === activeTab)
  );

  const counts = $derived(shelfStore.counts);
  const isLoading = $derived(shelfStore.isLoading);
  const hasAnyRow = $derived(shelfStore.list.length > 0);
  const readingNow = $derived(
    shelfStore.list.filter((row) => row.status === 'currently-reading').slice(0, 4)
  );

  function tabUrl(tab: ShelfTabValue, view: 'grid' | 'table'): string {
    const params = new URLSearchParams();
    if (tab !== 'all') params.set('tab', tab);
    if (view === 'table') params.set('view', 'table');
    const query = params.toString();
    return query.length > 0 ? `/my-books?${query}` : '/my-books';
  }

  /** Shelf rows are snapshots: hydrate them into full books for the card controls. */
  function bookFor(row: UserBookShelf): Book | undefined {
    return catalogStore.bookFor(row.bookId);
  }

  function ensureBooks(): void {
    const missing = shelfStore.list.filter((row) => !catalogStore.bookFor(row.bookId)).slice(0, 24);
    for (const row of missing) void catalogStore.loadBook(row.bookId);
  }

  $effect(() => {
    if (shelfStore.list.length > 0) ensureBooks();
  });

  async function changeStatus(row: UserBookShelf, status: ShelfStatus): Promise<void> {
    const book = bookFor(row);
    failure = null;
    if (!book) {
      failure = 'That book is still loading. Try again in a moment.';
      return;
    }
    try {
      await shelfStore.setStatus(book, status);
    } catch (error) {
      failure = shelfStore.failureFor(row.bookId) ?? describe(error, 'That change could not be saved.');
    }
  }

  async function changeProgress(row: UserBookShelf, pages: number): Promise<void> {
    const book = bookFor(row);
    failure = null;
    if (!book) {
      failure = 'That book is still loading. Try again in a moment.';
      return;
    }
    try {
      await shelfStore.updateProgress(book, pages);
    } catch (error) {
      failure = shelfStore.failureFor(row.bookId) ?? describe(error, 'That progress could not be saved.');
    }
  }

  async function changeRating(row: UserBookShelf, rating: number): Promise<void> {
    const book = bookFor(row);
    failure = null;
    if (!book) {
      failure = 'That book is still loading. Try again in a moment.';
      return;
    }
    try {
      await shelfStore.submitRating(book, rating);
    } catch (error) {
      failure = shelfStore.failureFor(row.bookId) ?? describe(error, 'That rating could not be saved.');
    }
  }

  function describe(error: unknown, fallback: string): string {
    return error instanceof Error && error.message.length > 0 ? error.message : fallback;
  }
</script>

<svelte:head>
  <title>My Shelves — SvelteReads</title>
  <meta name="description" content="Every book you are reading, want to read, have finished, or set aside." />
</svelte:head>

<header class="mb-5 flex flex-wrap items-end justify-between gap-4">
  <div class="min-w-0">
    <h1 class="text-balance font-serif text-3xl font-semibold text-stone-900 sm:text-4xl dark:text-stone-50">
      My Shelves
    </h1>
    <p class="mt-1 text-sm text-stone-600 dark:text-stone-400">
      {#if authState.profile}
        Everything {authState.profile.displayName} is reading, ranked by most recent activity.
      {:else}
        Everything you are reading, ranked by most recent activity.
      {/if}
    </p>
  </div>

  {#if authState.user && hasAnyRow}
    <div class="flex items-center gap-2" role="group" aria-label="Shelf layout">
      <a
        href={tabUrl(activeTab, 'grid')}
        aria-current={layout === 'grid' ? 'true' : undefined}
        class="flex min-h-11 items-center rounded-[var(--radius-control)] border px-3 text-sm font-medium {layout ===
        'grid'
          ? 'border-primary-500 bg-primary-50 text-primary-800 dark:border-primary-500 dark:bg-primary-950/40 dark:text-primary-200'
          : 'border-stone-300 text-stone-700 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800'}"
      >
        Grid
      </a>
      <a
        href={tabUrl(activeTab, 'table')}
        aria-current={layout === 'table' ? 'true' : undefined}
        class="flex min-h-11 items-center rounded-[var(--radius-control)] border px-3 text-sm font-medium {layout ===
        'table'
          ? 'border-primary-500 bg-primary-50 text-primary-800 dark:border-primary-500 dark:bg-primary-950/40 dark:text-primary-200'
          : 'border-stone-300 text-stone-700 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800'}"
      >
        Table
      </a>
    </div>
  {/if}
</header>

{#if authState.status === 'initializing'}
  <CardGridSkeleton count={4} columns="rows" label="Loading your session…" />
{:else if !authState.user}
  <EmptyState
    title="Sign in to build your shelves"
    description="Shelves, progress, and ratings are tied to your account so they follow you between devices."
    icon="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
  >
    {#snippet action()}
      <Button variant="primary" size="md" href="/profile">Sign in or create an account</Button>
      <Button variant="secondary" size="md" href="/search">Browse the catalog</Button>
    {/snippet}
  </EmptyState>
{:else}
  <nav aria-label="Shelf filters" class="mb-5">
    <ul class="scrollbar-none flex gap-2 overflow-x-auto pb-1 sm:flex-wrap">
      {#each SHELF_TABS as tab (tab.value)}
        {@const active = tab.value === activeTab}
        <li class="shrink-0">
          <a
            href={tabUrl(tab.value, layout)}
            aria-current={active ? 'page' : undefined}
            class="flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] border px-4 text-sm font-medium transition-colors {active
              ? 'border-primary-600 bg-primary-600 text-white'
              : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800'}"
          >
            {tab.label}
            <span class="font-mono text-xs tabular-nums {active ? 'text-white/80' : 'text-stone-500 dark:text-stone-400'}">
              {counts[tab.value]}
            </span>
          </a>
        </li>
      {/each}
    </ul>
  </nav>

  <div aria-live="polite" class="sr-only">{failure ?? ''}</div>

  {#if failure}
    <p class="mb-4 rounded-[var(--radius-control)] border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200" role="alert">
      {failure}
      <button type="button" class="ml-2 underline" onclick={() => (failure = null)}>Dismiss</button>
    </p>
  {/if}

  {#if shelfStore.error && !hasAnyRow}
    <EmptyState tone="warning" title="Your shelves could not be loaded" description={shelfStore.error}>
      {#snippet action()}
        <Button variant="primary" size="sm" onclick={() => void shelfStore.loadShelves({ refresh: true })}>Try again</Button>
      {/snippet}
    </EmptyState>
  {:else if isLoading && !hasAnyRow}
    <CardGridSkeleton count={4} columns={layout === 'table' ? 'rows' : 'cards'} label="Loading your shelves…" />
  {:else if rows.length === 0}
    <EmptyState
      title={activeTab === 'all' ? 'Your shelves are empty' : `Nothing on “${SHELF_TABS.find((tab) => tab.value === activeTab)?.label}”`}
      description={activeTab === 'all'
        ? 'Shelve your first book and it will show up here with progress and ratings.'
        : 'Books move between shelves as you update them — try another tab or the catalog.'}
    >
      {#snippet action()}
        <Button variant="primary" size="md" href="/search">Find a book to shelve</Button>
      {/snippet}
    </EmptyState>
  {:else if layout === 'grid'}
    <ul class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {#each rows as row (row.id)}
        {@const book = bookFor(row)}
        <li class="flex flex-col gap-3 rounded-[var(--radius-card)] border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
          <div class="flex gap-4">
            <a href={`/books/${row.bookId}`} class="block h-24 w-16 shrink-0 overflow-hidden rounded-[var(--radius-control)] bg-stone-100 dark:bg-stone-800">
              {#if row.bookCoverUrl}
                <img src={row.bookCoverUrl} alt="" width={64} height={96} loading="lazy" decoding="async" class="h-full w-full object-cover" />
              {:else}
                <span class="sr-only">No cover available</span>
              {/if}
            </a>

            <div class="min-w-0 flex-1">
              <h2 class="truncate font-serif text-base font-semibold text-stone-900 dark:text-stone-100">
                <a href={`/books/${row.bookId}`} class="hover:underline focus-visible:outline-2 focus-visible:outline-offset-2">
                  {row.bookTitle || 'Untitled'}
                </a>
              </h2>
              <p class="truncate text-sm text-stone-600 dark:text-stone-400">
                {row.bookAuthors.length > 0 ? row.bookAuthors.join(', ') : 'Unknown author'}
              </p>
              <p class="mt-1 text-xs text-stone-500 dark:text-stone-400">
                Updated {formatRelativeDate(row.updatedAt)}
              </p>
            </div>
          </div>

          <ShelfSelector
            bookId={row.bookId}
            bookTitle={row.bookTitle}
            currentStatus={row.status}
            disabled={shelfStore.isPending(row.bookId)}
            onSelect={(status) => changeStatus(row, status)}
          />

          {#if row.status === 'currently-reading' || row.status === 'read' || row.status === 'did-not-finish'}
            <div class="flex flex-col gap-2">
              <ProgressBar value={row.progressPercentage} max={100} size="sm" label={`Progress for ${row.bookTitle || 'this book'}`} />
              <p class="text-xs tabular-nums text-stone-500 dark:text-stone-400">
                {formatPercentage(row.progressPercentage)} · {formatPageCount(row.progressPages)} of {formatPageCount(row.bookPageCount)}
              </p>
              {#if book}
                <ReadingProgressWidget
                  bookId={row.bookId}
                  pageCount={row.bookPageCount}
                  bookTitle={row.bookTitle}
                  currentPage={row.progressPages}
                  disabled={shelfStore.isPending(row.bookId)}
                  onProgressChange={(pages) => changeProgress(row, pages)}
                />
              {/if}
            </div>
          {/if}

          <div class="flex flex-wrap items-center gap-3">
            <RatingStars
              value={row.rating}
              showValue
              size="sm"
              label={`Your rating for ${row.bookTitle || 'this book'}`}
              disabled={shelfStore.isPending(row.bookId)}
              onChange={(value) => void changeRating(row, value)}
            />
            <Button
              variant="ghost"
              size="sm"
              class="ml-auto"
              loading={shelfStore.isPending(row.bookId)}
              onclick={() => {
                const target = book;
                if (!target) return;
                void shelfStore.remove(target).catch((error) => {
                  failure = describe(error, 'That book could not be removed.');
                });
              }}
            >
              Remove
            </Button>
          </div>

          {#if shelfStore.failureFor(row.bookId)}
            <p class="text-xs font-medium text-rose-700 dark:text-rose-300" role="alert">
              {shelfStore.failureFor(row.bookId)}
            </p>
          {/if}
        </li>
      {/each}
    </ul>
  {:else}
    <div class="overflow-x-auto rounded-[var(--radius-card)] border border-stone-200 dark:border-stone-800">
      <table class="w-full min-w-[44rem] border-collapse bg-white text-left text-sm dark:bg-stone-900">
        <caption class="sr-only">
          Your shelved books with state, progress, rating, and last update
        </caption>
        <thead class="bg-stone-50 text-xs uppercase tracking-wide text-stone-500 dark:bg-stone-950/50 dark:text-stone-400">
          <tr>
            <th scope="col" class="px-4 py-3 font-semibold">Book</th>
            <th scope="col" class="px-4 py-3 font-semibold">Shelf</th>
            <th scope="col" class="px-4 py-3 font-semibold">Progress</th>
            <th scope="col" class="px-4 py-3 font-semibold">Rating</th>
            <th scope="col" class="px-4 py-3 font-semibold">Updated</th>
            <th scope="col" class="px-4 py-3 font-semibold"><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {#each rows as row (row.id)}
            {@const book = bookFor(row)}
            <tr class="border-t border-stone-200 align-middle dark:border-stone-800">
              <th scope="row" class="max-w-64 px-4 py-3 text-left font-medium text-stone-900 dark:text-stone-100">
                <a href={`/books/${row.bookId}`} class="block truncate hover:underline focus-visible:outline-2 focus-visible:outline-offset-2">
                  {row.bookTitle || 'Untitled'}
                </a>
                <span class="block truncate text-xs font-normal text-stone-500 dark:text-stone-400">
                  {row.bookAuthors.length > 0 ? row.bookAuthors.join(', ') : 'Unknown author'}
                </span>
              </th>
              <td class="px-4 py-3">
                <ShelfSelector
                  bookId={row.bookId}
                  bookTitle={row.bookTitle}
                  currentStatus={row.status}
                  disabled={shelfStore.isPending(row.bookId)}
                  onSelect={(status) => changeStatus(row, status)}
                />
              </td>
              <td class="px-4 py-3">
                <div class="w-32">
                  <ProgressBar value={row.progressPercentage} max={100} size="sm" label={`Progress for ${row.bookTitle || 'this book'}`} />
                </div>
                <p class="mt-1 text-xs tabular-nums text-stone-500 dark:text-stone-400">
                  {formatPercentage(row.progressPercentage)}
                </p>
              </td>
              <td class="px-4 py-3">
                <RatingStars
                  value={row.rating}
                  size="sm"
                  showValue
                  label={`Your rating for ${row.bookTitle || 'this book'}`}
                  disabled={shelfStore.isPending(row.bookId)}
                  onChange={(value) => void changeRating(row, value)}
                />
              </td>
              <td class="px-4 py-3 text-xs text-stone-500 dark:text-stone-400">
                {formatRelativeDate(row.updatedAt)}
              </td>
              <td class="px-4 py-3 text-right">
                <Button
                  variant="ghost"
                  size="sm"
                  onclick={() => {
                    const target = book;
                    if (!target) return;
                    void shelfStore.remove(target).catch((error) => {
                      failure = describe(error, 'That book could not be removed.');
                    });
                  }}
                >
                  Remove
                </Button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    {#if rows.length > 8}
      <p class="mt-3 text-xs text-stone-500 dark:text-stone-400">
        Scroll the table sideways on narrow screens for rating, progress, and actions.
      </p>
    {/if}
  {/if}

  {#if shelfStore.hasMore && hasAnyRow}
    <div class="mt-6 flex justify-center">
      <Button variant="secondary" size="md" loading={isLoading} onclick={() => void shelfStore.loadMore()}>
        {isLoading ? 'Loading…' : 'Load more books'}
      </Button>
    </div>
  {/if}

  {#if readingNow.length > 0}
    <section class="mt-10" aria-labelledby="continue-heading">
      <h2 id="continue-heading" class="font-serif text-xl font-semibold text-stone-900 dark:text-stone-50">
        Keep going
      </h2>
      <p class="mt-1 text-sm text-stone-600 dark:text-stone-400">
        Open a book to log pages, adjust your rating, or write a review.
      </p>
      <ul class="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {#each readingNow as row (row.id)}
          <li>
            <a
              href={`/books/${row.bookId}`}
              class="block overflow-hidden rounded-[var(--radius-card)] border border-stone-200 bg-white transition-shadow hover:shadow-elevation-2 focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-stone-800 dark:bg-stone-900"
            >
              {#if row.bookCoverUrl}
                <img src={row.bookCoverUrl} alt="" width={240} height={360} loading="lazy" decoding="async" class="aspect-[2/3] w-full object-cover" />
              {/if}
              <span class="block truncate px-3 py-2 font-serif text-sm font-semibold text-stone-900 dark:text-stone-100">
                {row.bookTitle || 'Untitled'}
              </span>
            </a>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
{/if}
