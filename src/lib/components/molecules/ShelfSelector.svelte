<script lang="ts">
  import type { ShelfStatus } from '$lib/types/domain';

  interface Props {
    bookId: string;
    currentStatus?: ShelfStatus | null;
    onSelect?: (status: ShelfStatus) => Promise<void>;
  }

  let { bookId, currentStatus = null, onSelect }: Props = $props();

  let isOpen = $state(false);
  let isUpdating = $state(false);

  const shelfOptions: { label: string; value: ShelfStatus }[] = [
    { label: 'Want to Read', value: 'want-to-read' },
    { label: 'Currently Reading', value: 'currently-reading' },
    { label: 'Read', value: 'read' },
    { label: 'Did Not Finish', value: 'did-not-finish' }
  ];

  async function handleSelection(status: ShelfStatus) {
    if (status === currentStatus) {
      isOpen = false;
      return;
    }
    isUpdating = true;
    try {
      if (onSelect) {
        await onSelect(status);
      }
    } finally {
      isUpdating = false;
      isOpen = false;
    }
  }

  function getButtonLabel(status: ShelfStatus | null): string {
    switch (status) {
      case 'want-to-read': return 'Want to Read';
      case 'currently-reading': return 'Reading';
      case 'read': return 'Finished';
      case 'did-not-finish': return 'DNF';
      default: return 'Add to Shelf';
    }
  }
</script>

<div class="relative inline-block w-full">
  <button
    type="button"
    class="w-full min-h-[44px] flex items-center justify-between px-3 py-2 text-xs font-semibold rounded-lg transition-colors border shadow-xs select-none disabled:opacity-50 disabled:pointer-events-none {currentStatus
      ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 border-amber-300 dark:border-amber-800/60'
      : 'bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 border-stone-300 dark:border-stone-700 hover:bg-stone-200 dark:hover:bg-stone-700'}"
    onclick={() => (isOpen = !isOpen)}
    aria-expanded={isOpen}
    aria-haspopup="listbox"
  >
    <span class="truncate">
      {#if isUpdating}
        Updating...
      {:else}
        {getButtonLabel(currentStatus)}
      {/if}
    </span>
    <svg
      class="w-4 h-4 ml-1.5 transition-transform duration-200 {isOpen ? 'rotate-180' : ''}"
      viewBox="0 0 20 20"
      fill="currentColor"
    >
      <path
        fill-rule="evenodd"
        d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
        clip-rule="evenodd"
      />
    </svg>
  </button>

  {#if isOpen}
    <div
      class="fixed inset-0 z-40"
      onclick={() => (isOpen = false)}
      onkeydown={(e) => e.key === 'Escape' && (isOpen = false)}
      role="presentation"
      tabindex="-1"
    ></div>

    <ul
      role="listbox"
      class="absolute left-0 bottom-full mb-1 sm:bottom-auto sm:top-full sm:mt-1 z-50 w-full bg-white dark:bg-stone-900 rounded-lg shadow-xl border border-stone-200 dark:border-stone-800 py-1 overflow-hidden"
    >
      {#each shelfOptions as option}
        <li role="option" aria-selected={currentStatus === option.value}>
          <button
            type="button"
            class="w-full text-left px-3.5 py-2.5 text-xs font-medium transition-colors flex items-center justify-between {currentStatus === option.value
              ? 'bg-amber-500/10 text-amber-900 dark:text-amber-200 font-semibold'
              : 'text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800'}"
            onclick={() => handleSelection(option.value)}
          >
            <span>{option.label}</span>
            {#if currentStatus === option.value}
              <svg class="w-4 h-4 text-amber-600 dark:text-amber-400" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fill-rule="evenodd"
                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                  clip-rule="evenodd"
                />
              </svg>
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>
