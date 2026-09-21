<script lang="ts">
  import { cx } from '$lib/utils/cx';

  /**
   * Placeholder grid shown while a catalog or shelf query is in flight.
   *
   * The skeleton mirrors the real card grid's aspect ratio so the layout does
   * not shift when the data arrives, and it is hidden from assistive technology
   * in favour of the surrounding live-region loading message.
   */
  interface Props {
    /** Number of placeholder cards. */
    count?: number;
    /** Column behaviour; should match the real grid it stands in for. */
    columns?: 'cards' | 'rows';
    label?: string;
    class?: string;
  }

  let {
    count = 8,
    columns = 'cards',
    label = 'Loading…',
    class: className = ''
  }: Props = $props();

  const items = $derived(Array.from({ length: Math.max(count, 0) }, (_, index) => index));
</script>

<div class={className} aria-busy="true">
  <p class="sr-only" role="status">{label}</p>

  {#if columns === 'cards'}
    <ul class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4" aria-hidden="true">
      {#each items as item (item)}
        <li
          class="flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900"
        >
          <div class="aspect-[2/3] w-full animate-pulse bg-stone-200 dark:bg-stone-800"></div>
          <div class="flex flex-col gap-2 p-3">
            <div class="h-3 w-4/5 animate-pulse rounded-[var(--radius-pill)] bg-stone-200 dark:bg-stone-800"></div>
            <div class="h-3 w-2/5 animate-pulse rounded-[var(--radius-pill)] bg-stone-200 dark:bg-stone-800"></div>
          </div>
        </li>
      {/each}
    </ul>
  {:else}
    <ul class="flex flex-col gap-3" aria-hidden="true">
      {#each items as item (item)}
        <li
          class={cx(
            'flex items-center gap-4 rounded-[var(--radius-card)] border border-stone-200 bg-white p-3',
            'dark:border-stone-800 dark:bg-stone-900'
          )}
        >
          <div class="h-20 w-14 shrink-0 animate-pulse rounded-[var(--radius-control)] bg-stone-200 dark:bg-stone-800"></div>
          <div class="flex min-w-0 flex-1 flex-col gap-2">
            <div class="h-3 w-3/5 animate-pulse rounded-[var(--radius-pill)] bg-stone-200 dark:bg-stone-800"></div>
            <div class="h-3 w-2/5 animate-pulse rounded-[var(--radius-pill)] bg-stone-200 dark:bg-stone-800"></div>
            <div class="h-2 w-full animate-pulse rounded-[var(--radius-pill)] bg-stone-200 dark:bg-stone-800"></div>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>
