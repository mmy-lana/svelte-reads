<script lang="ts">
  interface Props {
    value?: number;
    readonly?: boolean;
    size?: 'sm' | 'md' | 'lg';
    onChange?: (newRating: number) => void;
  }

  let { value = $bindable(0), readonly = false, size = 'md', onChange }: Props = $props();

  let hoverRating = $state<number | null>(null);

  const displayRating = $derived(hoverRating !== null ? hoverRating : value);

  const starSizes = {
    sm: 'w-4 h-4',
    md: 'w-6 h-6',
    lg: 'w-8 h-8'
  };

  const touchPadding = {
    sm: 'p-1',
    md: 'p-2',
    lg: 'p-3'
  };

  function setRating(targetRating: number) {
    if (readonly) return;
    value = targetRating;
    onChange?.(targetRating);
  }

  function handleTouch(starIndex: number, event: TouchEvent | MouseEvent) {
    if (readonly) return;
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const clientX = 'touches' in event ? event.touches[0].clientX : (event as MouseEvent).clientX;
    const isHalf = clientX - rect.left < rect.width / 2;
    const computed = isHalf ? starIndex - 0.5 : starIndex;
    setRating(computed);
  }
</script>

<div
  class="inline-flex items-center gap-0.5"
  role={readonly ? 'img' : 'radiogroup'}
  aria-label={`Rating: ${displayRating} of 5 stars`}
>
  {#each [1, 2, 3, 4, 5] as starIndex}
    {@const fillPercentage = Math.max(0, Math.min(100, (displayRating - (starIndex - 1)) * 100))}
    <button
      type="button"
      disabled={readonly}
      class="relative transition-transform duration-100 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded-sm disabled:cursor-default {touchPadding[size]} active:scale-95"
      onclick={(e) => handleTouch(starIndex, e)}
      onmouseenter={() => !readonly && (hoverRating = starIndex)}
      onmouseleave={() => !readonly && (hoverRating = null)}
      aria-label={`Rate ${starIndex} stars`}
    >
      <svg
        class="{starSizes[size]} text-stone-300 dark:text-stone-700 transition-colors"
        viewBox="0 0 24 24"
        fill="currentColor"
      >
        <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
      </svg>
      {#if fillPercentage > 0}
        <div
          class="absolute inset-0 overflow-hidden pointer-events-none {touchPadding[size]}"
          style="width: {fillPercentage}%;"
        >
          <svg
            class="{starSizes[size]} text-amber-500 fill-amber-500"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
          </svg>
        </div>
      {/if}
    </button>
  {/each}
  {#if !readonly && value > 0}
    <span class="ml-2 text-xs font-mono font-medium text-stone-500 dark:text-stone-400 select-none">
      {value.toFixed(1)}
    </span>
  {/if}
</div>
