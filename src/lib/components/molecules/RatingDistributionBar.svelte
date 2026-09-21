<script lang="ts">
  import { buildRatingBreakdown, totalRatings } from '$lib/utils/ratings';
  import { cx } from '$lib/utils/cx';
  import type { RatingDistribution } from '$lib/types/domain';

  /**
   * Five-tier rating histogram.
   *
   * Rendered as a real table so the counts and percentages are readable by
   * assistive technology without ARIA emulation; the bars are presentational.
   */
  interface Props {
    distribution: RatingDistribution;
    /** Overrides the denominator when an aggregate total is already known. */
    totalOverride?: number;
    size?: 'sm' | 'md';
    /** Accessible caption for the table; defaults to a generic description. */
    title?: string;
    class?: string;
  }

  let {
    distribution,
    totalOverride,
    size = 'md',
    title = 'Rating distribution',
    class: className = ''
  }: Props = $props();

  const barHeights = { sm: 'h-2', md: 'h-2.5' } as const;
  const countFormatter = new Intl.NumberFormat('en');

  const total = $derived(totalOverride ?? totalRatings(distribution));
  const rows = $derived(buildRatingBreakdown(distribution, total));

  function formatPercentage(percentage: number, count: number): string {
    if (count > 0 && percentage < 1) return '<1%';
    return `${Math.round(percentage)}%`;
  }
</script>

<div class={cx('w-full', className)}>
  {#if total === 0}
    <p class="text-xs text-stone-500 dark:text-stone-400">
      No ratings yet — be the first to rate this book.
    </p>
  {:else}
    <table class="w-full border-collapse">
      <caption class="sr-only">{title}</caption>
      <thead class="sr-only">
        <tr>
          <th scope="col">Star rating</th>
          <th scope="col">Share of ratings</th>
          <th scope="col">Number of ratings</th>
          <th scope="col">Percentage</th>
        </tr>
      </thead>
      <tbody>
        {#each rows as row (row.tier)}
          <tr>
            <th
              scope="row"
              class="w-[3.25rem] py-1 pr-2 text-left align-middle font-mono text-xs font-medium text-stone-600 dark:text-stone-300"
              data-numeric
            >
              <span class="inline-flex items-center gap-1">
                {row.tier}
                <svg
                  class="h-3 w-3 text-primary-500 dark:text-primary-400"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
                </svg>
              </span>
            </th>

            <td class="py-1.5 align-middle">
              <div
                class={cx(
                  'w-full overflow-hidden rounded-[var(--radius-pill)] bg-stone-200/80 dark:bg-stone-700/60',
                  barHeights[size]
                )}
                aria-hidden="true"
              >
                <div
                  class="h-full rounded-[var(--radius-pill)] bg-primary-500 transition-[width] duration-500 ease-[var(--ease-editorial)] dark:bg-primary-400"
                  style="width: max({row.percentage}%, {row.count > 0 ? '2px' : '0px'});"
                ></div>
              </div>
            </td>

            <td
              class="w-[4.5rem] py-1 pl-2 text-right align-middle font-mono text-xs text-stone-700 dark:text-stone-200"
              data-numeric
            >
              {countFormatter.format(row.count)}
            </td>

            <td
              class="w-[3rem] py-1 pl-2 text-right align-middle font-mono text-xs text-stone-500 dark:text-stone-400"
              data-numeric
            >
              {formatPercentage(row.percentage, row.count)}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>
