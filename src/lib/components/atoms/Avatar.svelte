<script lang="ts">
  import { AVATAR_GEOMETRY, type AvatarSize } from '$lib/design/metrics';
  import { cx } from '$lib/utils/cx';

  interface Props {
    /** Remote or local image URL; empty/invalid values fall back to initials. */
    src?: string | null;
    /** Used for the accessible name, the initials fallback, and the tint. */
    name: string;
    alt?: string;
    size?: AvatarSize;
    loading?: 'lazy' | 'eager';
    /** Adds a subtle ring, used when avatars sit on photography or colour fields. */
    ring?: boolean;
    class?: string;
  }

  let {
    src,
    name,
    alt,
    size = 'md',
    loading = 'lazy',
    ring = false,
    class: className = ''
  }: Props = $props();

  /** Warm tints that sit inside the editorial palette; picked deterministically from the name. */
  const TINTS = [
    'bg-primary-100 text-primary-800 dark:bg-primary-500/20 dark:text-primary-200',
    'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200',
    'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200',
    'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200',
    'bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-200',
    'bg-stone-200 text-stone-700 dark:bg-stone-700/60 dark:text-stone-200'
  ] as const;

  const geometry = $derived(AVATAR_GEOMETRY[size]);
  const trimmedSrc = $derived(typeof src === 'string' ? src.trim() : '');
  const accessibleName = $derived(alt ?? (name.trim().length > 0 ? name.trim() : 'Reader avatar'));

  /** Empty strings and whitespace-only names must not produce a broken glyph. */
  const initials = $derived.by(() => {
    const parts = name
      .trim()
      .split(/\s+/)
      .filter((part) => part.length > 0);

    if (parts.length === 0) return '';
    if (parts.length === 1) return (parts[0] ?? '').slice(0, 2).toUpperCase();

    const first = parts[0]?.charAt(0) ?? '';
    const last = parts[parts.length - 1]?.charAt(0) ?? '';
    return `${first}${last}`.toUpperCase();
  });

  const tint = $derived.by(() => {
    const seed = name.trim().length > 0 ? name.trim() : 'reader';
    let hash = 0;
    for (const character of seed) {
      hash = (hash * 31 + character.codePointAt(0)!) % 997;
    }
    return TINTS[hash % TINTS.length] ?? TINTS[0];
  });

  let failed = $state(false);

  // A new source deserves a fresh attempt even if the previous one failed.
  $effect(() => {
    void trimmedSrc;
    failed = false;
  });

  const classes = $derived(
    cx(
      'inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-semibold',
      geometry.sizeClass,
      ring && 'ring-2 ring-white dark:ring-stone-900',
      className
    )
  );
</script>

{#if trimmedSrc.length > 0 && !failed}
  <img
    class={cx(classes, 'object-cover')}
    src={trimmedSrc}
    alt={accessibleName}
    width={geometry.px}
    height={geometry.px}
    {loading}
    decoding="async"
    referrerpolicy="no-referrer"
    onerror={() => {
      failed = true;
    }}
  />
{:else}
  <span class={cx(classes, tint)} role="img" aria-label={accessibleName}>
    {#if initials.length > 0}
      <span class={cx(geometry.initialsClass, 'leading-none')} aria-hidden="true">{initials}</span>
    {:else}
      <svg
        class={geometry.glyphClass}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        aria-hidden="true"
      >
        <path d="M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0z" />
        <path d="M12 14a7 7 0 0 0-7 7h14a7 7 0 0 0-7-7z" />
      </svg>
    {/if}
  </span>
{/if}
