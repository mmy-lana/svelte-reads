<script lang="ts">
  import type { Snippet } from 'svelte';
  import { BUTTON_GEOMETRY, type ControlSize } from '$lib/design/metrics';
  import { cx } from '$lib/utils/cx';

  export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

  interface CommonProps {
    variant?: ButtonVariant;
    size?: ControlSize;
    /** Renders an anchor element; navigation must remain a real link. */
    href?: string;
    type?: 'button' | 'submit' | 'reset';
    disabled?: boolean;
    /** Shows a spinner, blocks interaction, and reports `aria-busy`. */
    loading?: boolean;
    fullWidth?: boolean;
    title?: string;
    class?: string;
    leadingIcon?: Snippet;
    trailingIcon?: Snippet;
    onclick?: (event: MouseEvent) => void;
  }

  interface LabelledProps extends CommonProps {
    /** Optional override; the visible label names the control by default. */
    ariaLabel?: string;
    children: Snippet;
  }

  interface IconOnlyProps extends CommonProps {
    /** Required: an icon-only control has no visible label to announce. */
    ariaLabel: string;
    children?: undefined;
  }

  type Props = LabelledProps | IconOnlyProps;

  let {
    variant = 'primary',
    size = 'md',
    href,
    type = 'button',
    disabled = false,
    loading = false,
    fullWidth = false,
    ariaLabel,
    title,
    class: className = '',
    leadingIcon,
    trailingIcon,
    onclick,
    children
  }: Props = $props();

  const VARIANT_CLASSES: Record<ButtonVariant, string> = {
    primary:
      'border border-primary-700/20 bg-primary-600 text-white shadow-elevation-1 hover:bg-primary-700 hover:border-primary-800/30 active:bg-primary-800 dark:border-primary-400/30 dark:bg-primary-500 dark:text-primary-950 dark:hover:bg-primary-400 dark:active:bg-primary-300',
    secondary:
      'border border-stone-300 bg-white text-stone-800 shadow-elevation-1 hover:border-stone-400 hover:bg-stone-50 active:bg-stone-100 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:hover:border-stone-600 dark:hover:bg-stone-800 dark:active:bg-stone-700',
    ghost:
      'border border-transparent bg-transparent text-stone-700 hover:bg-stone-200/70 active:bg-stone-200 dark:text-stone-200 dark:hover:bg-stone-800/80 dark:active:bg-stone-700/80',
    danger:
      'border border-rose-700/20 bg-rose-600 text-white shadow-elevation-1 hover:bg-rose-700 active:bg-rose-800 dark:border-rose-400/30 dark:bg-rose-500 dark:text-rose-950 dark:hover:bg-rose-400 dark:active:bg-rose-300'
  };

  const geometry = $derived(BUTTON_GEOMETRY[size]);
  const iconOnly = $derived(children === undefined);
  const isBusy = $derived(loading);
  const isDisabled = $derived(disabled || loading);

  const classes = $derived(
    cx(
      'inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-control)] font-sans font-medium touch-manipulation',
      'transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out active:scale-[0.98]',
      'disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50',
      geometry.minHeightClass,
      geometry.paddingClass,
      geometry.textClass,
      VARIANT_CLASSES[variant],
      fullWidth && 'w-full',
      iconOnly && 'min-w-11 px-0',
      className
    )
  );

  function handleClick(event: MouseEvent): void {
    if (isDisabled) {
      event.preventDefault();
      return;
    }
    onclick?.(event);
  }
</script>

{#snippet spinner()}
  <svg class="h-4 w-4 shrink-0 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" class="opacity-25" />
    <path
      d="M12 2a10 10 0 0 1 10 10"
      stroke="currentColor"
      stroke-width="3"
      stroke-linecap="round"
    />
  </svg>
{/snippet}

{#snippet content()}
  {#if isBusy}
    {@render spinner()}
  {:else if leadingIcon}
    {@render leadingIcon()}
  {/if}
  {#if children}
    <span class="min-w-0 truncate">{@render children()}</span>
  {/if}
  {#if trailingIcon && !isBusy}
    {@render trailingIcon()}
  {/if}
{/snippet}

{#if href && !isDisabled}
  <a class={classes} {href} {title} aria-label={ariaLabel} onclick={handleClick}>
    {@render content()}
  </a>
{:else}
  <button
    class={classes}
    {type}
    disabled={isDisabled}
    aria-busy={isBusy}
    aria-label={ariaLabel}
    {title}
    onclick={handleClick}
  >
    {@render content()}
  </button>
{/if}
