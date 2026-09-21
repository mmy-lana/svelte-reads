<script lang="ts">
  import type { Snippet } from 'svelte';
  import {
    BADGE_GEOMETRY,
    type BadgeGeometry
  } from '$lib/design/metrics';
  import { SHELF_STATUS_LABELS, SHELF_STATUS_TONES } from '$lib/utils/shelf-state-machine';
  import { cx } from '$lib/utils/cx';
  import type { ShelfStatus } from '$lib/types/domain';

  export type BadgeTone = 'amber' | 'sky' | 'emerald' | 'stone' | 'rose' | 'violet';
  export type BadgeSize = 'sm' | 'md';

  interface Props {
    /** Shelf status convenience: derives both the label and the semantic tone. */
    status?: ShelfStatus;
    tone?: BadgeTone;
    size?: BadgeSize;
    label?: string;
    /** Renders a leading status dot in the current tone. */
    showDot?: boolean;
    title?: string;
    class?: string;
    /** Optional custom content; wins over `label` when both are provided. */
    children?: Snippet;
  }

  let {
    status,
    tone,
    size = 'sm',
    label,
    showDot = false,
    title,
    class: className = '',
    children
  }: Props = $props();

  const TONE_CLASSES: Record<BadgeTone, string> = {
    amber:
      'bg-amber-100 text-amber-900 ring-amber-600/20 dark:bg-amber-500/15 dark:text-amber-200 dark:ring-amber-400/25',
    sky: 'bg-sky-100 text-sky-900 ring-sky-600/20 dark:bg-sky-500/15 dark:text-sky-200 dark:ring-sky-400/25',
    emerald:
      'bg-emerald-100 text-emerald-900 ring-emerald-600/20 dark:bg-emerald-500/15 dark:text-emerald-200 dark:ring-emerald-400/25',
    stone:
      'bg-stone-200/80 text-stone-700 ring-stone-500/20 dark:bg-stone-700/50 dark:text-stone-200 dark:ring-stone-400/20',
    rose: 'bg-rose-100 text-rose-900 ring-rose-600/20 dark:bg-rose-500/15 dark:text-rose-200 dark:ring-rose-400/25',
    violet:
      'bg-violet-100 text-violet-900 ring-violet-600/20 dark:bg-violet-500/15 dark:text-violet-200 dark:ring-violet-400/25'
  };

  const DOT_CLASSES: Record<BadgeTone, string> = {
    amber: 'bg-amber-600 dark:bg-amber-300',
    sky: 'bg-sky-600 dark:bg-sky-300',
    emerald: 'bg-emerald-600 dark:bg-emerald-300',
    stone: 'bg-stone-500 dark:bg-stone-300',
    rose: 'bg-rose-600 dark:bg-rose-300',
    violet: 'bg-violet-600 dark:bg-violet-300'
  };

  const geometry: BadgeGeometry = $derived(BADGE_GEOMETRY[size]);
  const resolvedTone: BadgeTone = $derived(
    tone ?? (status ? SHELF_STATUS_TONES[status] : 'stone')
  );
  const resolvedLabel: string = $derived(label ?? (status ? SHELF_STATUS_LABELS[status] : ''));

  const classes = $derived(
    cx(
      'inline-flex max-w-full items-center gap-1.5 rounded-[var(--radius-pill)] font-medium ring-1 ring-inset',
      geometry.paddingClass,
      geometry.textClass,
      TONE_CLASSES[resolvedTone],
      className
    )
  );
</script>

{#if resolvedLabel.length > 0 || children}
  <span class={classes} title={title ?? resolvedLabel}>
    {#if showDot}
      <span class={cx('h-1.5 w-1.5 shrink-0 rounded-full', DOT_CLASSES[resolvedTone])} aria-hidden="true"
      ></span>
    {/if}
    {#if children}
      {@render children()}
    {:else}
      <span class="truncate">{resolvedLabel}</span>
    {/if}
  </span>
{/if}
