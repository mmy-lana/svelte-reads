<script lang="ts">
  import {
    STAR_GEOMETRY,
    STAR_TRACK_MIN_HEIGHT_CLASS,
    type ControlSize
  } from '$lib/design/metrics';
  import { cx } from '$lib/utils/cx';

  /**
   * Interactive star rating with half-star precision.
   *
   * Accessibility note: the glyphs are a single composite control exposed as an
   * ARIA slider (one tab stop, arrow/Home/End/digit keys, `aria-valuetext`),
   * because a radiogroup cannot express a fractional value without lying about
   * which radio is checked. Interactive glyphs are presentational, so they add no
   * nested interactive elements and no phantom tab stops.
   */
  interface Props {
    value?: number;
    readonly?: boolean;
    disabled?: boolean;
    size?: ControlSize;
    max?: number;
    /** `half` selects 0.5 - 5.0 in half-star steps; `full` snaps to whole stars. */
    precision?: 'half' | 'full';
    /** Renders a fixed-width numeric readout next to the stars. */
    showValue?: boolean;
    /** Accessible name for the control; a rating-specific default is used otherwise. */
    label?: string;
    onChange?: (value: number) => void;
    class?: string;
  }

  let {
    value = $bindable(0),
    readonly = false,
    disabled = false,
    size = 'md',
    max = 5,
    precision = 'half',
    showValue = false,
    label,
    onChange,
    class: className = ''
  }: Props = $props();

  const starPath =
    'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z';

  const step = $derived(precision === 'half' ? 0.5 : 1);
  const geometry = $derived(STAR_GEOMETRY[size]);
  const isInteractive = $derived(!readonly && !disabled);

  let hoverValue = $state<number | null>(null);
  let isPointerDown = $state(false);
  let track: HTMLButtonElement | HTMLDivElement | null = $state(null);

  /** Shared box styles for the interactive control and the read-only display. */
  const layoutClasses =
    'inline-flex select-none items-center justify-start rounded-[var(--radius-control)] transition-[background-color,color] duration-150 ease-out';

  /** Snaps an incoming value onto the legal increment grid inside [step, max]. */
  function snap(raw: number): number {
    if (!Number.isFinite(raw)) return step;
    const bounded = Math.min(max, Math.max(step, raw));
    return precision === 'half' ? Math.round(bounded * 2) / 2 : Math.round(bounded);
  }

  /** Read-only display keeps the exact community average (e.g. 4.37 stars). */
  function clampDisplay(raw: number): number {
    if (!Number.isFinite(raw) || raw <= 0) return 0;
    return Math.min(max, raw);
  }

  const displayValue = $derived(
    readonly
      ? clampDisplay(value)
      : hoverValue !== null
        ? snap(hoverValue)
        : Number.isFinite(value) && value > 0
          ? snap(value)
          : 0
  );

  const stars = $derived(Array.from({ length: max }, (_, index) => index + 1));

  function fillForStar(starIndex: number, current: number): number {
    return Math.max(0, Math.min(100, (current - (starIndex - 1)) * 100));
  }

  const valueText = $derived(
    displayValue > 0 ? `${displayValue.toFixed(1)} out of ${max} stars` : `Not rated out of ${max} stars`
  );

  /** Maps a viewport x coordinate onto the rating grid of the whole track. */
  function ratingFromPointer(clientX: number): number {
    const element = track;
    if (!element) return value;

    const rect = element.getBoundingClientRect();
    if (rect.width <= 0) return value;

    const zoneWidth = rect.width / max;
    const offset = Math.min(Math.max(clientX - rect.left, 0), Math.max(rect.width - 0.01, 0));
    const index = Math.min(max - 1, Math.floor(offset / zoneWidth));
    const withinZone = offset - index * zoneWidth;
    const base = index + 1;

    if (precision === 'full') return base;
    return withinZone < zoneWidth / 2 ? base - 0.5 : base;
  }

  function commit(next: number): void {
    const snapped = snap(next);
    if (snapped === value) return;
    value = snapped;
    onChange?.(snapped);
  }

  function handlePointerDown(event: PointerEvent): void {
    if (!isInteractive || event.button !== 0) return;
    isPointerDown = true;
    hoverValue = null;
    track?.setPointerCapture?.(event.pointerId);
    commit(ratingFromPointer(event.clientX));
  }

  function handlePointerMove(event: PointerEvent): void {
    if (!isInteractive) return;

    if (isPointerDown) {
      commit(ratingFromPointer(event.clientX));
      return;
    }

    if (event.pointerType === 'mouse') {
      hoverValue = ratingFromPointer(event.clientX);
    }
  }

  function handlePointerUp(event: PointerEvent): void {
    if (!isPointerDown) return;
    isPointerDown = false;
    if (track?.hasPointerCapture?.(event.pointerId)) {
      track.releasePointerCapture(event.pointerId);
    }
  }

  function handlePointerLeave(): void {
    if (!isPointerDown) hoverValue = null;
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (!isInteractive) return;

    let next: number | null = null;

    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        next = displayValue + step;
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        next = displayValue - step;
        break;
      case 'Home':
        next = step;
        break;
      case 'End':
        next = max;
        break;
      default: {
        const digit = Number.parseInt(event.key, 10);
        if (!Number.isNaN(digit) && digit >= 1 && digit <= max) {
          next = Math.min(digit, max);
        }
      }
    }

    if (next === null) return;
    event.preventDefault();
    commit(next);
  }
</script>

{#snippet starGlyphs()}
  {#each stars as starIndex (starIndex)}
    {@const fillPercentage = fillForStar(starIndex, displayValue)}
    <span class={cx('relative block shrink-0', geometry.iconClass)} aria-hidden="true">
      <svg
        class="h-full w-full text-stone-300 transition-colors dark:text-stone-700"
        viewBox="0 0 24 24"
        fill="currentColor"
      >
        <path d={starPath} />
      </svg>
      {#if fillPercentage > 0}
        <span class="absolute inset-y-0 left-0 overflow-hidden" style="width: {fillPercentage}%;">
          <svg
            class={cx('text-primary-500 dark:text-primary-400', geometry.iconClass)}
            width={geometry.iconRem * 16}
            height={geometry.iconRem * 16}
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d={starPath} />
          </svg>
        </span>
      {/if}
    </span>
  {/each}
{/snippet}

<div class={cx('inline-flex items-center gap-2', className)}>
  {#if readonly}
    <div
      bind:this={track}
      class={cx(
        layoutClasses,
        STAR_TRACK_MIN_HEIGHT_CLASS,
        geometry.gapClass,
        'cursor-default'
      )}
      role="img"
      aria-label={label ?? `Rated ${displayValue.toFixed(1)} out of ${max} stars`}
    >
      {@render starGlyphs()}
    </div>
  {:else}
    <!--
      A native button hosts the slider role: it is focusable without a manual
      tabindex, restores a pointer cursor, and keeps the whole track as one target.
    -->
    <button
      bind:this={track}
      type="button"
      class={cx(
        layoutClasses,
        STAR_TRACK_MIN_HEIGHT_CLASS,
        geometry.gapClass,
        // pan-y lets the page keep scrolling vertically while horizontal drags
        // stay with the rating control instead of being claimed by the browser.
        'cursor-pointer touch-pan-y',
        disabled && 'cursor-not-allowed opacity-60'
      )}
      role="slider"
      aria-label={label ?? 'Your rating'}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={displayValue}
      aria-valuetext={valueText}
      aria-disabled={disabled ? 'true' : undefined}
      onpointerdown={handlePointerDown}
      onpointermove={handlePointerMove}
      onpointerup={handlePointerUp}
      onpointercancel={handlePointerUp}
      onpointerleave={handlePointerLeave}
      onkeydown={handleKeyDown}
    >
      {@render starGlyphs()}
    </button>
  {/if}

  {#if showValue}
    <span
      class="min-w-11 shrink-0 text-right font-mono text-xs font-medium text-stone-500 dark:text-stone-400"
      data-numeric
      aria-hidden="true"
    >
      {displayValue > 0 ? displayValue.toFixed(1) : '\u2014'}
    </span>
  {/if}
</div>
