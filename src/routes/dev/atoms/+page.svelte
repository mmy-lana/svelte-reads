<script lang="ts">
  import Avatar from '$lib/components/atoms/Avatar.svelte';
  import Badge from '$lib/components/atoms/Badge.svelte';
  import Button from '$lib/components/atoms/Button.svelte';
  import ProgressBar from '$lib/components/atoms/ProgressBar.svelte';
  import RatingStars from '$lib/components/atoms/RatingStars.svelte';
  import {
    PROGRESS_GEOMETRY,
    remToPx,
    STAR_GEOMETRY,
    STAR_TRACK_MIN_HEIGHT_REM,
    starTrackWidthPx,
    TOUCH_TARGET_MIN_PX
  } from '$lib/design/metrics';
  import { SHELF_STATUS_VALUES, SHELF_STATUS_LABELS } from '$lib/utils/shelf-state-machine';
  import type { ShelfStatus } from '$lib/types/domain';

  let interactiveRating = $state(0);
  let fullStarRating = $state(3);
  let saving = $state(false);

  const readonlyRating = 4.37;
  const statuses: readonly ShelfStatus[] = SHELF_STATUS_VALUES;

  const starRows = (['sm', 'md', 'lg'] as const).map((size) => ({
    size,
    iconPx: remToPx(STAR_GEOMETRY[size].iconRem),
    trackWidthPx: starTrackWidthPx(size, 5),
    trackHeightPx: remToPx(STAR_TRACK_MIN_HEIGHT_REM)
  }));

  async function simulateSave(): Promise<void> {
    saving = true;
    await new Promise((resolve) => setTimeout(resolve, 1200));
    saving = false;
  }
</script>

{#snippet bookmarkIcon()}
  <svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path d="M5 3a2 2 0 0 0-2 2v12l7-4 7 4V5a2 2 0 0 0-2-2H5z" />
  </svg>
{/snippet}

<svelte:head>
  <title>Atom Gallery · Development</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div id="atom-gallery" class="mx-auto max-w-5xl space-y-10 pb-16">
  <header class="space-y-2">
    <p
      class="font-mono text-xs font-medium uppercase tracking-[0.2em] text-primary-700 dark:text-primary-300"
    >
      Phase 2 · Design Foundation
    </p>
    <h1 class="font-serif text-title text-stone-900 dark:text-stone-50">Atom gallery</h1>
    <p class="max-w-2xl text-sm text-stone-600 dark:text-stone-300">
      Every primitive is rendered here at mobile widths (360px, 390px, 430px) to certify the
      ≥{TOUCH_TARGET_MIN_PX}×{TOUCH_TARGET_MIN_PX}px target contract, touch and keyboard
      interaction, and both colour schemes. This route is development-only.
    </p>
  </header>

  <section class="space-y-4">
    <h2 class="font-serif text-2xl text-stone-900 dark:text-stone-50">Button</h2>

    <div class="flex flex-wrap items-center gap-3">
      <Button>Save Review</Button>
      <Button variant="secondary">Add to Shelf</Button>
      <Button variant="ghost">Cancel</Button>
      <Button variant="danger">Remove</Button>
    </div>

    <div class="flex flex-wrap items-center gap-3">
      <Button size="sm">Small</Button>
      <Button size="md">Medium</Button>
      <Button size="lg">Large</Button>
    </div>

    <div class="flex flex-wrap items-center gap-3">
      <Button loading>Publishing…</Button>
      <Button loading onclick={simulateSave} variant="secondary">
        {saving ? 'Saving…' : 'Save Progress'}
      </Button>
      <Button disabled>Disabled</Button>
      <Button variant="secondary" leadingIcon={bookmarkIcon}>With Icon</Button>
      <Button ariaLabel="Add to want to read" variant="ghost" leadingIcon={bookmarkIcon} />
    </div>

    <div class="flex flex-wrap items-center gap-3">
      <Button href="/dev/atoms" variant="ghost">Link Styled as Button</Button>
      <Button disabled href="/dev/atoms" variant="secondary">Disabled Link</Button>
    </div>

    <div class="max-w-sm">
      <Button fullWidth size="lg">Full Width Primary Action</Button>
    </div>
  </section>

  <section class="space-y-4">
    <h2 class="font-serif text-2xl text-stone-900 dark:text-stone-50">RatingStars</h2>

    <div
      class="space-y-3 rounded-[var(--radius-card)] border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900"
    >
      <div class="flex flex-wrap items-center gap-3">
        <span class="w-40 shrink-0 text-xs font-medium text-stone-500 dark:text-stone-400">
          Interactive · half stars
        </span>
        <RatingStars bind:value={interactiveRating} showValue />
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <span class="w-40 shrink-0 text-xs font-medium text-stone-500 dark:text-stone-400">
          Interactive · whole stars
        </span>
        <RatingStars bind:value={fullStarRating} precision="full" showValue />
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <span class="w-40 shrink-0 text-xs font-medium text-stone-500 dark:text-stone-400">
          Read-only · community average
        </span>
        <RatingStars readonly value={readonlyRating} showValue />
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <span class="w-40 shrink-0 text-xs font-medium text-stone-500 dark:text-stone-400">
          Disabled
        </span>
        <RatingStars disabled value={2.5} showValue />
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <span class="w-40 shrink-0 text-xs font-medium text-stone-500 dark:text-stone-400">
          Sizes (sm · md · lg)
        </span>
        <div class="flex flex-wrap items-center gap-4">
          <RatingStars readonly size="sm" value={3} />
          <RatingStars readonly size="md" value={3.5} />
          <RatingStars readonly size="lg" value={4} />
        </div>
      </div>

      <p class="font-mono text-[11px] text-stone-500 dark:text-stone-400" data-numeric>
        {#each starRows as row (row.size)}
          {row.size}: glyph {row.iconPx}px · track {row.trackWidthPx}×{row.trackHeightPx}px<br />
        {/each}
      </p>
    </div>
  </section>

  <section class="space-y-4">
    <h2 class="font-serif text-2xl text-stone-900 dark:text-stone-50">Badge</h2>

    <div class="flex flex-wrap items-center gap-2">
      {#each statuses as status (status)}
        <Badge {status} showDot />
      {/each}
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <Badge tone="amber" label="Trending" />
      <Badge tone="rose" label="Spoilers" showDot />
      <Badge tone="violet" label="Debut Author" />
      <Badge tone="emerald" label="On Goal" />
      <Badge tone="sky" label="New Releases" />
      <Badge tone="stone" label="Archived" />
      <Badge size="md" tone="amber" label="Larger Badge" />
      <Badge status="read" />
    </div>

    <p class="text-xs text-stone-500 dark:text-stone-400">
      Empty state: a badge without a label or children renders nothing, so optional metadata never
      leaves an empty pill behind.
    </p>
  </section>

  <section class="space-y-4">
    <h2 class="font-serif text-2xl text-stone-900 dark:text-stone-50">Avatar</h2>

    <div class="flex flex-wrap items-end gap-4">
      <Avatar size="xs" name="Ada Okonkwo" />
      <Avatar size="sm" name="Marco Silva" />
      <Avatar size="md" name="Yuki Tanaka" />
      <Avatar size="lg" name="Priya Raman" />
      <Avatar size="xl" name="Nadia Haddad" ring />
    </div>

    <div class="flex flex-wrap items-center gap-4">
      <Avatar name="Broken Source" src="https://example.invalid/does-not-exist.png" />
      <Avatar name="Empty Source" src="" />
      <Avatar name="   " />
      <Avatar name="Solitary" />
      <Avatar
        name="Remote Portrait"
        size="lg"
        src="https://api.dicebear.com/9.x/initials/svg?seed=Ada%20Okonkwo"
      />
    </div>
  </section>

  <section class="space-y-4">
    <h2 class="font-serif text-2xl text-stone-900 dark:text-stone-50">ProgressBar</h2>

    <div class="grid gap-4 sm:grid-cols-2">
      <ProgressBar label="Reading goal" value={18} max={52} showValue />
      <ProgressBar label="East of Eden" value={120} max={601} showValue valueText="120 of 601 pages" />
      <ProgressBar label="Finished" tone="emerald" value={100} showValue />
      <ProgressBar label="Abandoned" tone="rose" value={0} showValue />
      <ProgressBar ariaLabel="Compact track" size="sm" value={42} />
      <ProgressBar ariaLabel="Large track" size="lg" value={75} showValue />
    </div>

    <p class="font-mono text-[11px] text-stone-500 dark:text-stone-400" data-numeric>
      track heights: sm {remToPx(PROGRESS_GEOMETRY.sm.heightRem)}px · md {remToPx(
        PROGRESS_GEOMETRY.md.heightRem
      )}px · lg {remToPx(PROGRESS_GEOMETRY.lg.heightRem)}px
    </p>

    <p class="text-xs text-stone-500 dark:text-stone-400">
      Edge states: negative values clamp to 0%, values beyond the maximum clamp to 100%, and a
      non-positive maximum reports 0% instead of dividing by zero.
    </p>
  </section>

  <section class="space-y-3">
    <h2 class="font-serif text-2xl text-stone-900 dark:text-stone-50">Certification notes</h2>
    <ul class="list-disc space-y-1 pl-5 text-sm text-stone-600 dark:text-stone-300">
      <li>
        Interactive targets hold ≥{TOUCH_TARGET_MIN_PX}px: buttons via
        <code class="font-mono text-xs">min-h-11</code>, the star control via its composite
        {remToPx(STAR_TRACK_MIN_HEIGHT_REM)}px track.
      </li>
      <li>
        Stars respond to tap, pointer drag, mouse hover preview, and arrow/Home/End/digit keys with a
        single tab stop.
      </li>
      <li>No hover-only affordance: every action is reachable by tap and keyboard.</li>
      <li>
        Fractions render without layout shift: star fills use clipped overlays and numeric readouts
        reserve their width.
      </li>
      <li>
        Motion honours <code class="font-mono text-xs">prefers-reduced-motion</code> globally in
        <code class="font-mono text-xs">app.css</code>.
      </li>
      <li>
        Labels: {SHELF_STATUS_LABELS['currently-reading']} and {SHELF_STATUS_LABELS['did-not-finish']}
        are the longest shelf strings and still fit at 360px.
      </li>
    </ul>
  </section>
</div>
