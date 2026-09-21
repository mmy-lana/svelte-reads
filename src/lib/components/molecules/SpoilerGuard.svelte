<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    containsSpoilers: boolean;
    children: Snippet;
  }

  let { containsSpoilers, children }: Props = $props();
  let isRevealed = $state(!containsSpoilers);
</script>

{#if !containsSpoilers || isRevealed}
  {@render children()}
{:else}
  <div class="relative rounded-lg border border-amber-300 dark:border-amber-900/60 bg-amber-50/50 dark:bg-amber-950/20 p-4 my-2 overflow-hidden">
    <div class="filter blur-md select-none pointer-events-none opacity-40">
      {@render children()}
    </div>
    <div class="absolute inset-0 flex flex-col items-center justify-center bg-stone-900/20 dark:bg-black/40 backdrop-blur-[2px] p-4 text-center">
      <div class="flex items-center gap-1.5 text-amber-800 dark:text-amber-300 mb-2">
        <svg class="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
          <path
            fill-rule="evenodd"
            d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
            clip-rule="evenodd"
          />
        </svg>
        <span class="text-sm font-semibold">Review contains plot spoilers</span>
      </div>
      <button
        type="button"
        class="min-h-[44px] px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white dark:bg-amber-600 dark:hover:bg-amber-500 rounded-lg text-xs font-semibold shadow-md transition-colors active:scale-98"
        onclick={() => (isRevealed = true)}
      >
        Reveal Review Content
      </button>
    </div>
  </div>
{/if}
