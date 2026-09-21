<script lang="ts">
  import { cx } from '$lib/utils/cx';
  import type { Snippet } from 'svelte';

  /**
   * Shared empty and error state for data-backed surfaces.
   *
   * Keeps the "nothing here yet" copy, the recovery action, and the illustration
   * identical everywhere instead of letting each route invent its own.
   */
  interface Props {
    title: string;
    description: string;
    /** An inline SVG path drawn inside a decorative circle. */
    icon?: string;
    tone?: 'neutral' | 'warning';
    class?: string;
    /** Recovery controls, rendered under the description. */
    action?: Snippet;
  }

  let {
    title,
    description,
    icon = 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
    tone = 'neutral',
    class: className = '',
    action
  }: Props = $props();
</script>

<div
  class={cx(
    'flex flex-col items-center gap-3 rounded-[var(--radius-card)] border border-dashed px-6 py-12 text-center',
    tone === 'warning'
      ? 'border-rose-300 bg-rose-50/60 dark:border-rose-900/60 dark:bg-rose-950/20'
      : 'border-stone-300 bg-stone-50/60 dark:border-stone-700 dark:bg-stone-900/40',
    className
  )}
  role={tone === 'warning' ? 'alert' : 'status'}
>
  <span
    class={cx(
      'grid h-12 w-12 place-items-center rounded-full',
      tone === 'warning'
        ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300'
        : 'bg-stone-200 text-stone-600 dark:bg-stone-800 dark:text-stone-300'
    )}
    aria-hidden="true"
  >
    <svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
      <path stroke-linecap="round" stroke-linejoin="round" d={icon} />
    </svg>
  </span>

  <h2 class="text-balance font-serif text-lg font-semibold text-stone-900 dark:text-stone-100">
    {title}
  </h2>
  <p class="max-w-md text-pretty text-sm text-stone-600 dark:text-stone-400">{description}</p>

  {#if action}
    <div class="mt-1 flex flex-wrap items-center justify-center gap-2">
      {@render action()}
    </div>
  {/if}
</div>
