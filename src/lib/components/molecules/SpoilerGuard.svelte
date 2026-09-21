<script lang="ts">
  import type { Snippet } from 'svelte';
  import Badge from '$lib/components/atoms/Badge.svelte';
  import Button from '$lib/components/atoms/Button.svelte';
  import { cx } from '$lib/utils/cx';

  /**
   * Masks spoiler-tagged content without changing document flow.
   *
   * While masked, the children are rendered once inside an `aria-hidden` and
   * `inert` wrapper: assistive technology cannot reach the text and no nested
   * control can receive focus or pointer input. The warning header occupies the
   * same row in both states, so revealing never shifts the page.
   */
  interface Props {
    containsSpoilers: boolean;
    children: Snippet;
    /** Optional override for the warning copy shown while masked. */
    warningLabel?: string;
    revealLabel?: string;
    hideLabel?: string;
    class?: string;
  }

  let {
    containsSpoilers,
    children,
    warningLabel = 'Contains spoilers',
    revealLabel = 'Reveal Review',
    hideLabel = 'Hide Spoilers',
    class: className = ''
  }: Props = $props();

  let isRevealed = $state(false);

  const isMasked = $derived(containsSpoilers && !isRevealed);
</script>

<div
  class={cx(
    'overflow-hidden rounded-[var(--radius-card)] border p-3 sm:p-4',
    containsSpoilers
      ? 'border-amber-300/70 bg-amber-50/60 dark:border-amber-900/60 dark:bg-amber-950/20'
      : 'border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900',
    className
  )}
  data-spoiler-state={containsSpoilers ? (isRevealed ? 'revealed' : 'masked') : 'clean'}
>
  {#if containsSpoilers}
    <!-- Reserved header row: identical height in both states, so toggling never shifts layout. -->
    <div
      class="mb-3 flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-amber-200/70 pb-2 dark:border-amber-900/40"
    >
      {#if isMasked}
        <span class="flex min-w-0 items-center gap-2">
          <svg
            class="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fill-rule="evenodd"
              d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm-1-8a1 1 0 0 0-1 1v3a1 1 0 0 0 2 0V6a1 1 0 0 0-1-1z"
              clip-rule="evenodd"
            />
          </svg>
          <span class="truncate text-sm font-semibold text-amber-900 dark:text-amber-200">
            {warningLabel}
          </span>
        </span>
        <Button size="sm" variant="primary" onclick={() => (isRevealed = true)}>{revealLabel}</Button>
      {:else}
        <Badge tone="rose" label="Spoilers revealed" showDot />
        <Button size="sm" variant="ghost" onclick={() => (isRevealed = false)}>{hideLabel}</Button>
      {/if}
    </div>
  {/if}

  <!-- The masked copy stays in flow at its natural height: revealing cannot shift the page. -->
  <div
    class={cx(
      isMasked && 'pointer-events-none select-none opacity-40 blur-[6px] transition-[filter,opacity] duration-200'
    )}
    aria-hidden={isMasked ? 'true' : undefined}
    inert={isMasked}
    data-spoiler-content
  >
    {@render children()}
  </div>
</div>
