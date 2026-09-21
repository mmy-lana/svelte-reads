<script lang="ts">
  import type { Book, ShelfStatus } from '$lib/types/domain';
  import RatingStars from '$lib/components/atoms/RatingStars.svelte';
  import ShelfSelector from '$lib/components/molecules/ShelfSelector.svelte';

  interface Props {
    book: Book;
    currentShelf?: ShelfStatus | null;
    onShelfChange?: (newStatus: ShelfStatus) => Promise<void>;
  }

  let { book, currentShelf = null, onShelfChange }: Props = $props();
</script>

<article
  class="group relative flex flex-col w-full bg-white dark:bg-stone-900 rounded-xl border border-stone-200/80 dark:border-stone-800 shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden"
>
  <a
    href={`/books/${book.id}`}
    class="relative w-full aspect-[2/3] bg-stone-100 dark:bg-stone-800 overflow-hidden block focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
  >
    <img
      src={book.coverUrl}
      alt={`Cover for ${book.title}`}
      loading="lazy"
      class="w-full h-full object-cover object-center transition-transform duration-300 group-hover:scale-102"
    />
    {#if currentShelf}
      <div class="absolute top-2 left-2 z-10">
        <span
          class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold tracking-wide bg-stone-900/85 text-white backdrop-blur-md shadow-xs border border-white/10 capitalize"
        >
          {currentShelf.replace(/-/g, ' ')}
        </span>
      </div>
    {/if}
  </a>

  <div class="flex flex-col flex-1 p-3.5 sm:p-4 justify-between gap-2.5">
    <div class="space-y-1">
      <a
        href={`/books/${book.id}`}
        class="font-serif font-bold text-base leading-snug text-stone-900 dark:text-stone-100 hover:text-amber-800 dark:hover:text-amber-400 line-clamp-2 transition-colors"
      >
        {book.title}
      </a>
      <p class="text-xs text-stone-600 dark:text-stone-400 font-sans line-clamp-1">
        by {book.authors.join(', ')}
      </p>
    </div>

    <div class="flex items-center justify-between gap-1 pt-1 border-t border-stone-100 dark:border-stone-800/60">
      <div class="flex items-center gap-1.5">
        <RatingStars value={book.averageRating} readonly size="sm" />
        <span class="text-xs font-medium font-mono text-stone-700 dark:text-stone-300">
          {book.averageRating.toFixed(2)}
        </span>
      </div>
      <span class="text-[11px] text-stone-400 dark:text-stone-500 font-mono">
        ({book.ratingsCount.toLocaleString()})
      </span>
    </div>

    <div class="pt-1.5">
      <ShelfSelector
        bookId={book.id}
        currentStatus={currentShelf}
        onSelect={onShelfChange}
      />
    </div>
  </div>
</article>
