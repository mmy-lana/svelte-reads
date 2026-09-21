<script lang="ts">
  import ProgressBar from '$lib/components/atoms/ProgressBar.svelte';
  import { cx } from '$lib/utils/cx';
  import { validateProgress } from '$lib/validation/schemas';

  /**
   * Page-level reading progress control.
   *
   * Dragging the slider updates the percentage immediately and persists on
   * release (or when a step button / direct page entry commits). Reaching the
   * final page fires `onComplete` once, which is the store's cue to move the
   * book onto the Read shelf.
   */
  interface Props {
    bookId: string;
    /** Total pages; a non-positive value renders the unavailable state. */
    pageCount: number;
    currentPage?: number;
    /** Accessible name for the controls, e.g. the book title. */
    bookTitle?: string;
    disabled?: boolean;
    /** Persists the new position; rejecting rolls the control back. */
    onProgressChange?: (pages: number, percentage: number) => void | Promise<void>;
    /** Fires once when progress reaches the final page. */
    onComplete?: (pages: number) => void | Promise<void>;
    class?: string;
  }

  let {
    bookId,
    pageCount,
    currentPage = $bindable(0),
    bookTitle,
    disabled = false,
    onProgressChange,
    onComplete,
    class: className = ''
  }: Props = $props();

  const hasPageCount = $derived(Number.isFinite(pageCount) && pageCount > 0);
  const safePageCount = $derived(hasPageCount ? Math.floor(pageCount) : 0);

  const persistedPage = $derived(
    hasPageCount ? Math.min(Math.max(Math.round(currentPage), 0), safePageCount) : 0
  );

  /**
   * `draftPages` holds only an in-flight position: while dragging or while a
   * write is pending it takes over the display, and clearing it falls back to
   * the persisted prop. That keeps the control live without syncing effects and
   * makes rollback after a rejected write automatic.
   */
  let draftPages = $state<number | null>(null);
  let isSaving = $state(false);
  let errorMessage = $state<string | null>(null);

  const displayedPage = $derived(draftPages ?? persistedPage);
  const percentage = $derived(validateProgress(displayedPage, safePageCount).percentage);
  const isFinished = $derived(hasPageCount && displayedPage >= safePageCount);

  const instanceId = $props.id();
  const rangeId = `${instanceId}-range`;
  const pagesId = `${instanceId}-pages`;
  const describedById = `${instanceId}-hint`;

  function clamp(page: number): number {
    if (!Number.isFinite(page)) return 0;
    return Math.min(Math.max(Math.round(page), 0), safePageCount);
  }

  async function commit(nextPage: number): Promise<void> {
    const next = clamp(nextPage);
    const wasFinished = hasPageCount && persistedPage >= safePageCount;

    draftPages = next;

    if (next === persistedPage || disabled) {
      draftPages = null;
      return;
    }

    isSaving = true;
    errorMessage = null;

    try {
      await onProgressChange?.(next, validateProgress(next, safePageCount).percentage);
      currentPage = next;
      draftPages = null;

      if (!wasFinished && hasPageCount && next >= safePageCount) {
        await onComplete?.(next);
      }
    } catch {
      draftPages = null;
      errorMessage = 'Could not save your progress. Check your connection and try again.';
    } finally {
      isSaving = false;
    }
  }

  function step(delta: number): void {
    void commit(displayedPage + delta);
  }

  function handleNumberInput(event: Event): void {
    const target = event.currentTarget as HTMLInputElement;
    draftPages = clamp(Number(target.value));
  }
</script>

<div
  class={cx(
    'rounded-[var(--radius-card)] border border-stone-200 bg-white p-3.5 sm:p-4 dark:border-stone-800 dark:bg-stone-900',
    className
  )}
  data-progress-state={hasPageCount ? (isFinished ? 'complete' : 'active') : 'unavailable'}
>
  <div class="mb-3 flex min-w-0 items-baseline justify-between gap-2">
    <span class="min-w-0 truncate text-xs font-semibold text-stone-700 dark:text-stone-200">
      Reading progress
    </span>
    <span
      class="shrink-0 font-mono text-xs font-medium text-stone-500 dark:text-stone-400"
      data-numeric
      aria-live="polite"
    >
      {#if isSaving}
        Saving…
      {:else if hasPageCount}
        {displayedPage} / {safePageCount} pages
      {:else}
        Pages unavailable
      {/if}
    </span>
  </div>

  {#if hasPageCount}
    <ProgressBar
      value={displayedPage}
      max={safePageCount}
      size="md"
      tone={isFinished ? 'emerald' : 'primary'}
      ariaLabel={`Pages read of ${bookTitle ?? 'this book'}`}
      valueText={`${displayedPage} of ${safePageCount} pages, ${percentage}% complete`}
    />

    <div class="mt-3 space-y-3">
      <div>
        <label for={rangeId} class="sr-only">Current page for {bookTitle ?? 'this book'}</label>
        <p id={describedById} class="sr-only">
          Drag the slider, use the −10 and +10 buttons, or type a page number. Changes save
          automatically.
        </p>
        <input
          id={rangeId}
          type="range"
          min="0"
          max={safePageCount}
          step="1"
          value={displayedPage}
          disabled={disabled}
          class="h-11 w-full cursor-pointer touch-manipulation accent-primary-600 disabled:cursor-not-allowed disabled:opacity-60 dark:accent-primary-500"
          aria-valuetext={`Page ${displayedPage} of ${safePageCount}`}
          aria-describedby={describedById}
          oninput={(event) => (draftPages = clamp(Number(event.currentTarget.value)))}
          onchange={(event) => void commit(Number(event.currentTarget.value))}
        />
      </div>

      <div class="flex items-center justify-between gap-2">
        <button
          type="button"
          class="min-h-11 min-w-11 rounded-[var(--radius-control)] border border-stone-300 bg-stone-100 px-3 text-xs font-semibold text-stone-700 transition-colors hover:bg-stone-200 active:bg-stone-300 disabled:pointer-events-none disabled:opacity-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700"
          disabled={disabled || isSaving || displayedPage === 0}
          aria-label={`Go back 10 pages, to page ${clamp(displayedPage - 10)}`}
          onclick={() => step(-10)}
        >
          −10
        </button>

        <div class="flex min-w-0 items-center gap-1.5">
          <label for={pagesId} class="text-xs text-stone-500 dark:text-stone-400">Page</label>
          <input
            id={pagesId}
            type="number"
            inputmode="numeric"
            min="0"
            max={safePageCount}
            value={displayedPage}
            disabled={disabled || isSaving}
            class="h-11 w-20 rounded-[var(--radius-control)] border border-stone-300 bg-white px-2 text-center font-mono text-sm text-stone-800 disabled:opacity-60 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
            oninput={handleNumberInput}
            onchange={(event) => void commit(Number(event.currentTarget.value))}
          />
        </div>

        <button
          type="button"
          class="min-h-11 min-w-11 rounded-[var(--radius-control)] border border-stone-300 bg-stone-100 px-3 text-xs font-semibold text-stone-700 transition-colors hover:bg-stone-200 active:bg-stone-300 disabled:pointer-events-none disabled:opacity-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700"
          disabled={disabled || isSaving || displayedPage >= safePageCount}
          aria-label={`Go forward 10 pages, to page ${clamp(displayedPage + 10)}`}
          onclick={() => step(10)}
        >
          +10
        </button>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="min-h-11 rounded-[var(--radius-control)] bg-primary-600 px-3.5 text-xs font-semibold text-white transition-colors hover:bg-primary-700 active:bg-primary-800 disabled:pointer-events-none disabled:opacity-50 dark:bg-primary-500 dark:text-primary-950 dark:hover:bg-primary-400"
          disabled={disabled || isSaving || isFinished}
          onclick={() => void commit(safePageCount)}
        >
          Mark as Finished
        </button>

        {#if isFinished}
          <span class="text-xs font-medium text-emerald-700 dark:text-emerald-300">
            Finished — moving this book to your Read shelf.
          </span>
        {/if}
      </div>
    </div>

    {#if errorMessage}
      <p class="mt-2 text-xs text-rose-700 dark:text-rose-300" role="alert">{errorMessage}</p>
    {/if}
  {:else}
    <p class="text-xs text-stone-500 dark:text-stone-400">
      This edition has no page count, so page-level progress cannot be tracked. You can still shelve
      the book or rate it.
    </p>
  {/if}
</div>
