<script lang="ts">
  import { PROGRESS_GEOMETRY, type ControlSize } from '$lib/design/metrics';
  import { cx } from '$lib/utils/cx';

  export type ProgressTone = 'primary' | 'emerald' | 'rose';

  interface Props {
    /** Current amount, in units of `max` (pages, books, items). */
    value: number;
    /** Upper bound of the track; defaults to a percentage scale. */
    max?: number;
    label?: string;
    /** Accessible name; `label` is used when omitted, then a generic default. */
    ariaLabel?: string;
    /** Verbose readout for assistive technology, e.g. "120 of 601 pages". */
    valueText?: string;
    /** Renders the rounded percentage on the trailing edge of the header row. */
    showValue?: boolean;
    size?: ControlSize;
    tone?: ProgressTone;
    class?: string;
  }

  let {
    value,
    max = 100,
    label,
    ariaLabel,
    valueText,
    showValue = false,
    size = 'md',
    tone = 'primary',
    class: className = ''
  }: Props = $props();

  const TONE_CLASSES: Record<ProgressTone, string> = {
    primary: 'bg-primary-600 dark:bg-primary-500',
    emerald: 'bg-emerald-600 dark:bg-emerald-500',
    rose: 'bg-rose-600 dark:bg-rose-500'
  };

  const geometry = $derived(PROGRESS_GEOMETRY[size]);

  /** Guards NaN, negative bounds, and values beyond the maximum. */
  const boundedValue = $derived(
    Number.isFinite(value) ? Math.min(Math.max(value, 0), Number.isFinite(max) && max > 0 ? max : 0) : 0
  );
  const safeMax = $derived(Number.isFinite(max) && max > 0 ? max : 0);
  const percentage = $derived(
    safeMax > 0 ? Math.round((boundedValue / safeMax) * 100) : 0
  );

  const computedValueText = $derived(valueText ?? `${percentage}% complete`);
  const accessibleName = $derived(ariaLabel ?? label ?? 'Progress');
  const hasHeader = $derived(Boolean(label) || showValue);
</script>

<div class={cx('w-full', className)}>
  {#if hasHeader}
    <div class="mb-1.5 flex min-w-0 items-baseline justify-between gap-2">
      {#if label}
        <span class="min-w-0 truncate text-xs font-medium text-stone-600 dark:text-stone-300">
          {label}
        </span>
      {/if}
      {#if showValue}
        <span
          class="shrink-0 font-mono text-xs font-medium text-stone-500 dark:text-stone-400"
          data-numeric
          aria-hidden="true"
        >
          {percentage}%
        </span>
      {/if}
    </div>
  {/if}

  <div
    class={cx(
      'w-full overflow-hidden rounded-[var(--radius-pill)] bg-stone-200/80 dark:bg-stone-700/60',
      geometry.heightClass
    )}
    role="progressbar"
    aria-label={accessibleName}
    aria-valuemin="0"
    aria-valuemax={safeMax}
    aria-valuenow={boundedValue}
    aria-valuetext={computedValueText}
    data-numeric
  >
    <div
      class={cx(
        'h-full rounded-[var(--radius-pill)]',
        TONE_CLASSES[tone],
        // Width is animated deliberately: a scaleX transform would distort the
        // pill cap, and a single track cannot meaningfully thrash layout.
        'transition-[width] duration-500 ease-[var(--ease-editorial)]'
      )}
      style="width: {percentage}%;"
    ></div>
  </div>
</div>
