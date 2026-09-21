<script lang="ts">
  import { page } from '$app/state';
  import { cx } from '$lib/utils/cx';

  /**
   * Mobile bottom navigation, rendered only below the 768px breakpoint.
   *
   * Each destination is a full-width grid cell with a ≥44px target, an icon, and
   * a label — no icon-only affordances and no hover dependency. The bar respects
   * the iOS home-indicator safe area.
   */
  interface Props {
    /** Unread or pending indicators are appended to the link labels. */
    badges?: Partial<Record<MobileNavItem['label'], number>>;
    class?: string;
  }

  interface MobileNavItem {
    label: string;
    href: string;
    /** Path prefixes that should mark this item active. */
    matches: readonly string[];
    icon: string;
  }

  let { badges = {}, class: className = '' }: Props = $props();

  const navItems: readonly MobileNavItem[] = [
    {
      label: 'Explore',
      href: '/',
      matches: ['/'],
      icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6'
    },
    {
      label: 'Search',
      href: '/search',
      matches: ['/search'],
      icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z'
    },
    {
      label: 'My Shelves',
      href: '/my-books',
      matches: ['/my-books'],
      icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253'
    },
    {
      label: 'Profile',
      href: '/profile',
      matches: ['/profile'],
      icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z'
    }
  ];

  function isActive(item: MobileNavItem, pathname: string): boolean {
    if (item.href === '/') return pathname === '/';
    return item.matches.some((prefix) => pathname.startsWith(prefix));
  }
</script>

<nav
  class={cx(
    'fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-white/95 backdrop-blur-md safe-area-bottom shadow-elevation-3 md:hidden dark:border-stone-800 dark:bg-night/95',
    className
  )}
  aria-label="Primary"
>
  <ul class="mx-auto grid h-16 max-w-lg grid-cols-4 px-1">
    {#each navItems as item (item.href)}
      {@const active = isActive(item, page.url.pathname)}
      {@const badge = badges[item.label] ?? 0}
      <li class="flex">
        <a
          href={item.href}
          class={cx(
            'relative flex w-full flex-col items-center justify-center gap-1 rounded-[var(--radius-control)] px-1 text-[11px] font-medium touch-manipulation transition-colors',
            'min-h-11 min-w-11',
            active
              ? 'text-primary-700 font-semibold dark:text-primary-300'
              : 'text-stone-500 dark:text-stone-400'
          )}
          aria-current={active ? 'page' : undefined}
          data-nav-item={item.label}
        >
          <svg
            class="h-6 w-6 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            aria-hidden="true"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d={item.icon} />
          </svg>
          <span class="truncate">{item.label}</span>
          {#if badge > 0}
            <span
              class="absolute right-3 top-1.5 min-w-4 rounded-[var(--radius-pill)] bg-primary-600 px-1 text-center font-mono text-[10px] font-semibold leading-4 text-white"
              aria-hidden="true"
            >
              {badge}
            </span>
            <span class="sr-only">{badge} items</span>
          {/if}
        </a>
      </li>
    {/each}
  </ul>
</nav>
