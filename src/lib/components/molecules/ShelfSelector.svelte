<script lang="ts">
  import { tick } from 'svelte';
  import {
    SHELF_STATUS_LABELS,
    SHELF_STATUS_SHORT_LABELS,
    SHELF_STATUS_TONES,
    SHELF_STATUS_VALUES
  } from '$lib/utils/shelf-state-machine';
  import { cx } from '$lib/utils/cx';
  import type { ShelfStatus } from '$lib/types/domain';

  /**
   * Shelf picker with no hover dependency: below 768px it opens as a bottom
   * sheet, at and above 768px it becomes a popover anchored to the trigger.
   * Both variants render the same listbox, so the option set, the arrow-key
   * navigation, and the screen-reader semantics are identical across viewports.
   *
   * The difference is modality: the sheet covers the page with a click-away
   * layer, so it traps Tab inside the panel; the popover is a plain disclosure
   * and lets Tab continue through the page.
   */
  interface Props {
    bookId: string;
    /** Optional title used for the sheet heading and the listbox label. */
    bookTitle?: string;
    currentStatus?: ShelfStatus | null;
    disabled?: boolean;
    /** Receives the requested status; rejection surfaces an inline error. */
    onSelect?: (status: ShelfStatus) => void | Promise<void>;
    class?: string;
  }

  let {
    bookId,
    bookTitle,
    currentStatus = null,
    disabled = false,
    onSelect,
    class: className = ''
  }: Props = $props();

  const DOT_CLASSES = {
    sky: 'bg-sky-500',
    amber: 'bg-amber-500',
    emerald: 'bg-emerald-500',
    stone: 'bg-stone-400'
  } as const;

  /** Stable per-instance id so the trigger can reference the panel. */
  const panelId = $props.id();

  let isOpen = $state(false);
  let isUpdating = $state(false);
  let errorMessage = $state<string | null>(null);
  let triggerElement: HTMLButtonElement | null = $state(null);
  let panelElement: HTMLDivElement | null = $state(null);
  /** True while the panel is rendered as the modal bottom sheet (DEF-03). */
  let isBottomSheet = $state(false);

  const triggerLabel = $derived(
    currentStatus ? SHELF_STATUS_SHORT_LABELS[currentStatus] : 'Add to Shelf'
  );

  const isBusy = $derived(disabled || isUpdating);

  const triggerClasses = $derived(
    cx(
      'flex w-full select-none items-center justify-between gap-2 rounded-[var(--radius-control)] border px-3 text-xs font-semibold touch-manipulation',
      'min-h-11 transition-[background-color,border-color,color] duration-150 ease-out',
      'focus-visible:outline-2 focus-visible:outline-offset-2',
      'disabled:pointer-events-none disabled:opacity-60',
      currentStatus
        ? 'border-primary-300 bg-primary-50 text-primary-900 dark:border-primary-800/60 dark:bg-primary-950/40 dark:text-primary-100'
        : 'border-stone-300 bg-stone-100 text-stone-700 hover:bg-stone-200 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700'
    )
  );

  const panelClasses =
    'fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-lg overflow-hidden rounded-t-[var(--radius-card)] border border-stone-200 bg-white pb-[env(safe-area-inset-bottom)] shadow-elevation-4 animate-rise dark:border-stone-800 dark:bg-stone-900 md:absolute md:inset-x-auto md:bottom-auto md:right-0 md:top-full md:mt-1.5 md:w-72 md:max-w-none md:rounded-[var(--radius-card)] md:pb-1 md:animate-fade-in';

  function optionElements(): HTMLButtonElement[] {
    if (!panelElement) return [];
    return Array.from(panelElement.querySelectorAll<HTMLButtonElement>('[role="option"]'));
  }

  /**
   * DEF-03: reads the mode from the *rendered* panel rather than re-deriving
   * Tailwind's breakpoint here.
   *
   * `position: fixed` is precisely what the `md:` variants swap away when the
   * panel becomes a trigger-anchored popover, so the focus trap can never
   * disagree with the layout a reader is actually looking at — including zoom
   * levels and rem-based breakpoint resolution that a duplicated `768` would get
   * wrong.
   */
  function syncSheetMode(): void {
    isBottomSheet =
      typeof window !== 'undefined' && panelElement !== null
        ? window.getComputedStyle(panelElement).position === 'fixed'
        : false;
  }

  $effect(() => {
    if (!isOpen || panelElement === null) {
      isBottomSheet = false;
      return;
    }

    // Runs after the panel is in the DOM, so the computed style is real. A
    // viewport change across the breakpoint re-evaluates the mode mid-session.
    syncSheetMode();
    window.addEventListener('resize', syncSheetMode);
    return () => window.removeEventListener('resize', syncSheetMode);
  });

  async function open(): Promise<void> {
    if (isBusy) return;
    errorMessage = null;
    isOpen = true;
    await tick();

    const options = optionElements();
    const selected = options.find((option) => option.getAttribute('aria-selected') === 'true');
    (selected ?? options[0])?.focus();
  }

  /**
   * Every close path funnels through here — Escape, the click-away layer, and a
   * committed selection — so focus is handed back to the trigger exactly once
   * instead of being dropped on `<body>` where the reader would lose their place
   * in the page (DEF-03).
   */
  function close(): void {
    if (!isOpen) return;
    isOpen = false;
    triggerElement?.focus({ preventScroll: true });
  }

  async function select(status: ShelfStatus): Promise<void> {
    if (status === currentStatus) {
      close();
      return;
    }

    isUpdating = true;
    errorMessage = null;

    try {
      await onSelect?.(status);
      isUpdating = false;
      close();
    } catch {
      isUpdating = false;
      errorMessage = `Could not move "${bookTitle ?? 'this book'}" to ${SHELF_STATUS_LABELS[status]}. Check your connection and try again.`;
    }
  }

  function handleWindowKeyDown(event: KeyboardEvent): void {
    if (isOpen && event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  }

  /**
   * Keyboard contract for the open panel.
   *
   * Arrow/Home/End navigation is identical in both modes. Tab is where the modes
   * differ: the bottom sheet is modal (a click-away layer covers the page, so
   * anything Tab could reach behind it is unreachable by pointer as well), and
   * focus therefore wraps inside the panel. The desktop popover is non-modal and
   * keeps native Tab behaviour, so a reader can simply Tab onward.
   */
  function handlePanelKeyDown(event: KeyboardEvent): void {
    const options = optionElements();
    if (options.length === 0) return;

    const activeIndex = options.indexOf(document.activeElement as HTMLButtonElement);

    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        const nextIndex = activeIndex < 0 ? 0 : (activeIndex + delta + options.length) % options.length;
        options[nextIndex]?.focus();
        break;
      }
      case 'Home':
        event.preventDefault();
        options[0]?.focus();
        break;
      case 'End':
        event.preventDefault();
        options[options.length - 1]?.focus();
        break;
      case 'Tab': {
        if (!isBottomSheet) break;

        const first = options[0];
        const last = options[options.length - 1];
        if (!first || !last) break;

        // `activeIndex === -1` means focus sits on the panel container itself
        // (`tabindex="-1"`), which precedes the options in DOM order: Tab walks
        // into the first option naturally, but Shift+Tab would leave the sheet.
        if (event.shiftKey && activeIndex <= 0) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && activeIndex === options.length - 1) {
          event.preventDefault();
          first.focus();
        }
        break;
      }
      default:
        break;
    }
  }
</script>

<svelte:window onkeydown={handleWindowKeyDown} />

<div class={cx('relative w-full', className)}>
  <button
    bind:this={triggerElement}
    type="button"
    class={triggerClasses}
    disabled={isBusy}
    aria-haspopup="listbox"
    aria-expanded={isOpen}
    aria-controls={panelId}
    onclick={() => (isOpen ? close() : void open())}
  >
    <span class="flex min-w-0 items-center gap-1.5">
      {#if currentStatus}
        <span
          class={cx('h-1.5 w-1.5 shrink-0 rounded-full', DOT_CLASSES[SHELF_STATUS_TONES[currentStatus]])}
          aria-hidden="true"
        ></span>
      {/if}
      <span class="truncate">{isUpdating ? 'Updating…' : triggerLabel}</span>
    </span>

    {#if isUpdating}
      <svg class="h-4 w-4 shrink-0 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" class="opacity-25" />
        <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
      </svg>
    {:else}
      <svg
        class={cx('h-4 w-4 shrink-0 transition-transform duration-200', isOpen && 'rotate-180')}
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path
          fill-rule="evenodd"
          d="M5.293 7.293a1 1 0 0 1 1.414 0L10 10.586l3.293-3.293a1 1 0 1 1 1.414 1.414l-4 4a1 1 0 0 1-1.414 0l-4-4a1 1 0 0 1 0-1.414Z"
          clip-rule="evenodd"
        />
      </svg>
    {/if}
  </button>

  {#if isOpen}
    <!-- Click-away layer; keep it behind the panel and out of the tab order. -->
    <div class="fixed inset-0 z-40" role="presentation" onclick={close}></div>

    <div
      bind:this={panelElement}
      id={panelId}
      class={panelClasses}
      role="listbox"
      tabindex="-1"
      aria-label={bookTitle ? `Shelf for ${bookTitle}` : 'Choose a shelf'}
      onkeydown={handlePanelKeyDown}
    >
      <div class="mx-auto mt-2 h-1 w-10 rounded-full bg-stone-300 md:hidden dark:bg-stone-700"></div>

      <p
        class="px-4 pt-3 pb-1 font-serif text-sm font-semibold text-stone-900 md:px-3 md:pt-2.5 md:text-[11px] md:font-sans md:font-bold md:uppercase md:tracking-wide md:text-stone-500 dark:text-stone-100 md:dark:text-stone-400"
      >
        {bookTitle ? 'Move to Shelf' : 'Add to Shelf'}
      </p>

      <ul class="pb-1 md:pb-0.5">
        {#each SHELF_STATUS_VALUES as status (status)}
          <li role="none">
            <button
              type="button"
              role="option"
              aria-selected={currentStatus === status}
              disabled={isUpdating}
              class={cx(
                'flex w-full min-h-12 items-center justify-between gap-3 px-4 text-left text-sm transition-colors md:min-h-11 md:px-3 md:text-xs',
                'disabled:pointer-events-none disabled:opacity-60',
                currentStatus === status
                  ? 'bg-primary-50 font-semibold text-primary-900 dark:bg-primary-950/40 dark:text-primary-100'
                  : 'text-stone-700 hover:bg-stone-100 active:bg-stone-200 dark:text-stone-200 dark:hover:bg-stone-800'
              )}
              onclick={() => void select(status)}
            >
              <span class="flex min-w-0 items-center gap-2.5">
                <span
                  class={cx('h-2 w-2 shrink-0 rounded-full', DOT_CLASSES[SHELF_STATUS_TONES[status]])}
                  aria-hidden="true"
                ></span>
                <span class="truncate">{SHELF_STATUS_LABELS[status]}</span>
              </span>

              {#if currentStatus === status}
                <svg
                  class="h-4 w-4 shrink-0 text-primary-600 dark:text-primary-400"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fill-rule="evenodd"
                    d="M16.707 5.293a1 1 0 0 1 0 1.414l-8 8a1 1 0 0 1-1.414 0l-4-4a1 1 0 0 1 1.414-1.414L8 12.586l7.293-7.293a1 1 0 0 1 1.414 0Z"
                    clip-rule="evenodd"
                  />
                </svg>
              {/if}
            </button>
          </li>
        {/each}
      </ul>

      <div class="border-t border-stone-200 px-4 py-2 md:px-3 dark:border-stone-800">
        {#if errorMessage}
          <p class="text-xs text-rose-700 dark:text-rose-300" role="alert">{errorMessage}</p>
        {:else}
          <p class="text-[11px] text-stone-500 dark:text-stone-400">
            Updates apply immediately to your shelves.
          </p>
        {/if}
      </div>
    </div>
  {/if}
</div>
