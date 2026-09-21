<script lang="ts">
  import Badge from '$lib/components/atoms/Badge.svelte';
  import RatingStars from '$lib/components/atoms/RatingStars.svelte';
  import ShelfSelector from '$lib/components/molecules/ShelfSelector.svelte';
  import { cx } from '$lib/utils/cx';
  import { formatRating } from '$lib/utils/ratings';
  import type { Book, ShelfStatus } from '$lib/types/domain';

  interface Props {
    book: Book;
    currentShelf?: ShelfStatus | null;
    /** Rejecting the returned promise restores the previous shelf in the selector. */
    onShelfChange?: (newStatus: ShelfStatus) => void | Promise<void>;
    /** Above-the-fold cards should load their cover eagerly. */
    priority?: boolean;
    class?: string;
  }

  let { book, currentShelf = null, onShelfChange, priority = false, class: className = '' }: Props = $props();

  const ratingCountFormatter = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
  const exactCountFormatter = new Intl.NumberFormat('en');

  /** Empty authors, blank titles, and missing covers must not render broken UI. */
  const authors = $derived(
    book.authors.filter((author) => author.trim().length > 0).join(', ') || 'Unknown author'
  );
  const hasCover = $derived(book.coverUrl.trim().length > 0);
  const hasRatings = $derived(book.ratingsCount > 0 && book.averageRating > 0);

  let coverFailed = $state(false);
</script>

<article
  class={cx(
    'group flex h-full flex-col overflow-hidden rounded-[var(--radius-card)] border border-stone-200/80 bg-white shadow-elevation-1 transition-shadow duration-200 hover:shadow-elevation-2 dark:border-stone-800 dark:bg-stone-900',
    className
  )}
  data-book-id={book.id}
>
  <a
    href={`/books/${book.id}`}
    class="relative block aspect-[2/3] w-full overflow-hidden bg-stone-100 dark:bg-stone-800"
    aria-label={`View details for ${book.title || 'this book'}`}
  >
    {#if hasCover && !coverFailed}
      <img
        src={book.coverUrl}
        alt=""
        width={400}
        height={600}
        loading={priority ? 'eager' : 'lazy'}
        fetchpriority={priority ? 'high' : 'auto'}
        decoding="async"
        referrerpolicy="no-referrer"
        class="h-full w-full object-cover object-center transition-transform duration-300 ease-out group-hover:scale-[1.02]"
        onerror={() => {
          coverFailed = true;
        }}
      />
    {:else}
      <span
        class="flex h-full w-full flex-col items-center justify-center gap-2 bg-linear-to-br from-primary-100 via-stone-100 to-stone-200 p-3 text-center dark:from-primary-950/40 dark:via-stone-900 dark:to-stone-800"
        aria-hidden="true"
      >
        <svg class="h-8 w-8 text-primary-700/70 dark:text-primary-300/70" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
          <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10a2 2 0 0 1 2 2v13a1.5 1.5 0 0 0-1.5-1.5H5.5A1.5 1.5 0 0 1 4 16V5.5Z" />
          <path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H14a2 2 0 0 0-2 2v13a1.5 1.5 0 0 1 1.5-1.5h5A1.5 1.5 0 0 0 20 16V5.5Z" />
        </svg>
        <span class="font-serif text-xs leading-snug font-semibold text-stone-600 dark:text-stone-300 line-clamp-3">
          {book.title || 'Untitled'}
        </span>
      </span>
    {/if}

    {#if currentShelf}
      <span class="absolute left-2 top-2 z-10">
        <Badge status={currentShelf} showDot class="backdrop-blur-md" />
      </span>
    {/if}
  </a>

  <div class="flex flex-1 flex-col justify-between gap-2.5 p-3.5 sm:p-4">
    <div class="space-y-1">
      <a
        href={`/books/${book.id}`}
        class="line-clamp-2 font-serif text-base leading-snug font-bold text-stone-900 transition-colors hover:text-primary-800 dark:text-stone-50 dark:hover:text-primary-300"
      >
        {book.title || 'Untitled'}
      </a>
      <p class="line-clamp-1 text-xs text-stone-600 dark:text-stone-400">{authors}</p>
    </div>

    <div class="flex min-w-0 items-center justify-between gap-2 border-t border-stone-100 pt-1.5 dark:border-stone-800/60">
      {#if hasRatings}
        <span class="flex min-w-0 items-center gap-1.5">
          <RatingStars readonly size="sm" value={book.averageRating} />
          <span class="font-mono text-xs font-medium text-stone-700 dark:text-stone-200" data-numeric>
            {formatRating(book.averageRating, 1)}
          </span>
        </span>
        <span
          class="shrink-0 font-mono text-[11px] text-stone-400 dark:text-stone-500"
          data-numeric
          title={`${exactCountFormatter.format(book.ratingsCount)} ratings`}
        >
          {ratingCountFormatter.format(book.ratingsCount)}
        </span>
      {:else}
        <span class="truncate text-[11px] font-medium text-stone-400 dark:text-stone-500">
          No ratings yet
        </span>
      {/if}
    </div>

    <div class="pt-0.5">
      <ShelfSelector
        bookId={book.id}
        bookTitle={book.title}
        currentStatus={currentShelf}
        onSelect={onShelfChange}
      />
    </div>
  </div>
</article>
