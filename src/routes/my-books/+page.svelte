<script lang="ts">
  import { shelfStore } from '$lib/state/shelf.svelte';
  import type { ShelfStatus, UserBookShelf } from '$lib/types/domain';

  let activeTab = $state<ShelfStatus | 'all'>('all');

  const shelves = $derived(Array.from(shelfStore.shelves.values()));

  const filteredShelves = $derived(
    activeTab === 'all' ? shelves : shelves.filter((s) => s.status === activeTab)
  );

  const tabs: { label: string; value: ShelfStatus | 'all' }[] = [
    { label: 'All', value: 'all' },
    { label: 'Currently Reading', value: 'currently-reading' },
    { label: 'Want to Read', value: 'want-to-read' },
    { label: 'Read', value: 'read' },
    { label: 'Did Not Finish', value: 'did-not-finish' }
  ];
</script>

<div class="space-y-6">
  <div class="space-y-1">
    <h1 class="font-serif text-2xl sm:text-3xl font-bold">My Bookshelf</h1>
    <p class="text-xs sm:text-sm text-stone-500">Track and manage your reading journey.</p>
  </div>

  <div class="flex items-center gap-2 overflow-x-auto pb-2 border-b border-stone-200 dark:border-stone-800">
    {#each tabs as tab}
      <button
        type="button"
        class="px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors {activeTab === tab.value
          ? 'bg-amber-600 text-white shadow-xs'
          : 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200'}"
        onclick={() => (activeTab = tab.value)}
      >
        {tab.label}
      </button>
    {/each}
  </div>

  {#if filteredShelves.length === 0}
    <div class="p-12 text-center rounded-xl border border-dashed border-stone-300 dark:border-stone-800">
      <p class="text-sm text-stone-500">No books found in this shelf category.</p>
      <a href="/" class="inline-block mt-3 text-xs font-semibold text-amber-600 hover:underline">
        Explore catalog to add books
      </a>
    </div>
  {:else}
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {#each filteredShelves as shelf (shelf.id)}
        <div class="flex gap-4 p-3 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl shadow-xs">
          <img
            src={shelf.bookCoverUrl}
            alt={shelf.bookTitle}
            class="w-16 h-24 object-cover rounded-md"
          />
          <div class="flex-1 space-y-1">
            <h3 class="font-serif font-bold text-sm line-clamp-1">{shelf.bookTitle}</h3>
            <p class="text-xs text-stone-500 line-clamp-1">{shelf.bookAuthors.join(', ')}</p>
            <div class="pt-2">
              <span class="inline-block px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300">
                {shelf.status.replace(/-/g, ' ')}
              </span>
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
