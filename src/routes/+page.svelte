<script lang="ts">
  import Button from '$lib/components/atoms/Button.svelte';
  import BookCardClean from '$lib/components/molecules/BookCardClean.svelte';
  import CardGridSkeleton from '$lib/components/shells/CardGridSkeleton.svelte';
  import EmptyState from '$lib/components/shells/EmptyState.svelte';
  import { authState } from '$lib/state/auth.svelte';
  import { catalogStore } from '$lib/state/catalog.svelte';
  import { shelfStore } from '$lib/state/shelf.svelte';
  import { countLabel, formatNumber } from '$lib/utils/format';
  import type { Book } from '$lib/types/domain';

  /**
   * Discovery.
   *
   * Three ordered shelves (trending, highest rated, fresh arrivals) plus the
   * reader's reading-challenge ring. Every shelf has its own loading, error, and
   * empty state so one failed query cannot blank the whole page.
   */
  let discoveryRequested = $state(false);

  $effect(() => {
    if (discoveryRequested) return;
    discoveryRequested = true;
    void catalogStore.loadDiscovery();
  });

  const goal = $derived(authState.profile?.readingGoal ?? null);
  const completedBooks = $derived(shelfStore.counts.read);
  const goalTarget = $derived(goal?.targetBooks ?? 0);
  const goalPercentage = $derived(
    goalTarget > 0 ? Math.min(Math.round((completedBooks / goalTarget) * 100), 100) : 0
  );
  const goalRing = $derived(2 * Math.PI * 34);
  const inProgressCount = $derived(shelfStore.counts['currently-reading']);

  /** Reacts to a shelf change from any card, rolling back on rejection. */
  async function handleShelfChange(book: Book, status: Parameters<typeof shelfStore.setStatus>[1]) {
    try {
      await shelfStore.setStatus(book, status);
    } catch {
      // The store records the reader-facing failure; the card restores itself.
    }
  }
</script>

<svelte:head>
  <title>SvelteReads — Discover your next book</title>
  <meta
    name="description"
    content="Track what you read, rate what you finish, and share reviews with a community of readers."
  />
</svelte:head>

<section class="mb-8 overflow-hidden rounded-[var(--radius-card)] border border-stone-200 bg-white shadow-elevation-1 dark:border-stone-800 dark:bg-stone-900">
  <div class="grid gap-6 p-5 sm:p-7 lg:grid-cols-[1.4fr_1fr] lg:items-center">
    <div>
      <p class="font-mono text-xs font-semibold uppercase tracking-wider text-primary-700 dark:text-primary-300">
        Reading community
      </p>
      <h1 class="mt-2 text-balance font-serif text-3xl font-semibold leading-tight text-stone-900 sm:text-4xl dark:text-stone-50">
        Discover your next book, then remember everything you read.
      </h1>
      <p class="mt-3 max-w-prose text-pretty text-base text-stone-600 dark:text-stone-300">
        Build shelves, log progress page by page, and rate what you finish. Reviews are weighed
        against review volume, so a single enthusiastic score cannot top the leaderboard.
      </p>

      <div class="mt-5 flex flex-wrap items-center gap-3">
        <Button variant="primary" size="md" href="/search">Browse the catalog</Button>
        <Button variant="secondary" size="md" href="/my-books">
          {#if authState.user}
            Go to my shelves
          {:else}
            See how shelving works
          {/if}
        </Button>
      </div>

      {#if authState.profile}
        <p class="mt-4 text-sm text-stone-500 dark:text-stone-400">
          Signed in as {authState.profile.displayName}
          {#if inProgressCount > 0}
            — {countLabel(inProgressCount, 'book')} in progress.
          {/if}
        </p>
      {/if}
    </div>

    <div class="rounded-[var(--radius-card)] border border-stone-200 bg-stone-50 p-5 dark:border-stone-800 dark:bg-stone-950/40">
      <h2 class="font-serif text-lg font-semibold text-stone-900 dark:text-stone-100">
        {goal ? `${goal.year} reading challenge` : 'Reading challenge'}
      </h2>

      {#if goal && goalTarget > 0}
        <div class="mt-4 flex items-center gap-5">
          <svg class="h-24 w-24 shrink-0 -rotate-90" viewBox="0 0 80 80" role="img" aria-label={`${goalPercentage}% of your reading goal reached`}>
            <circle cx="40" cy="40" r="34" fill="none" stroke="currentColor" stroke-width="8" class="text-stone-200 dark:text-stone-800" />
            <circle
              cx="40"
              cy="40"
              r="34"
              fill="none"
              stroke="currentColor"
              stroke-width="8"
              stroke-linecap="round"
              class="text-primary-600 transition-[stroke-dashoffset] duration-500 ease-out motion-reduce:transition-none"
              stroke-dasharray={goalRing}
              stroke-dashoffset={goalRing - (goalRing * goalPercentage) / 100}
            />
          </svg>

          <dl class="min-w-0">
            <dd class="font-serif text-3xl font-semibold tabular-nums text-stone-900 dark:text-stone-50">
              {formatNumber(completedBooks)}
              <span class="font-sans text-base font-normal text-stone-500 dark:text-stone-400">
                of {formatNumber(goalTarget)}
              </span>
            </dd>
            <dt class="mt-1 text-sm text-stone-600 dark:text-stone-400">
              {#if completedBooks >= goalTarget}
                Goal reached — every further book is a bonus.
              {:else}
                {countLabel(goalTarget - completedBooks, 'book')} to go.
              {/if}
            </dt>
          </dl>
        </div>

        <p class="mt-4 text-xs text-stone-500 dark:text-stone-400">
          Shelve a book as Read to count it toward this goal.
        </p>
      {:else if authState.user}
        <p class="mt-3 text-sm text-stone-600 dark:text-stone-400">
          Set a target in your profile to start tracking a yearly goal.
        </p>
        <Button variant="secondary" size="sm" href="/profile" class="mt-4">Set a goal</Button>
      {:else}
        <p class="mt-3 text-sm text-stone-600 dark:text-stone-400">
          Sign in to track a yearly reading goal alongside your shelves.
        </p>
        <Button variant="primary" size="sm" href="/profile" class="mt-4">Sign in</Button>
      {/if}
    </div>
  </div>
</section>

{#if catalogStore.discoveryError && !catalogStore.hasDiscoveryContent}
  <EmptyState
    tone="warning"
    title="The catalog could not be reached"
    description={catalogStore.discoveryError}
    icon="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
  >
    {#snippet action()}
      <Button variant="primary" size="sm" onclick={() => void catalogStore.loadDiscovery({ refresh: true })}>
        Try again
      </Button>
    {/snippet}
  </EmptyState>
{:else}
  <div class="flex flex-col gap-10">
    {#each catalogStore.sections as section (section.key)}
      <section aria-labelledby={`section-${section.key}`}>
        <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div class="min-w-0">
            <h2 id={`section-${section.key}`} class="font-serif text-2xl font-semibold text-stone-900 dark:text-stone-50">
              {section.title}
            </h2>
            <p class="mt-1 text-sm text-stone-600 dark:text-stone-400">{section.description}</p>
          </div>

          <a
            href={`/search?sort=${section.key === 'newest' ? 'publishedDate' : section.key === 'topRated' ? 'bayesianRating' : 'ratingsCount'}`}
            class="rounded-[var(--radius-control)] px-2 py-1 text-sm font-semibold text-primary-700 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 dark:text-primary-300"
          >
            See all
            <span class="sr-only"> in {section.title}</span>
          </a>
        </div>

        {#if section.isLoading && section.books.length === 0}
          <CardGridSkeleton count={4} label={`Loading ${section.title.toLowerCase()}…`} />
        {:else if section.error}
          <EmptyState
            tone="warning"
            title={`${section.title} is unavailable`}
            description={section.error}
            class="py-8"
          />
        {:else if section.books.length === 0}
          <EmptyState
            title="No books here yet"
            description="This shelf fills up as the catalog gains titles. Try the search filters in the meantime."
            class="py-8"
          />
        {:else}
          <ul class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {#each section.books as book, index (book.id)}
              <li class="flex">
                <BookCardClean
                  {book}
                  currentShelf={shelfStore.statusFor(book.id)}
                  priority={section.key === 'trending' && index < 4}
                  onShelfChange={(status) => handleShelfChange(book, status)}
                  class="w-full"
                />
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    {/each}
  </div>
{/if}
