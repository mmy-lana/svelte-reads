<script lang="ts">
  import { page } from '$app/state';

  const navItems = [
    {
      label: 'Explore',
      href: '/',
      icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6'
    },
    {
      label: 'Search',
      href: '/search',
      icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z'
    },
    {
      label: 'My Shelves',
      href: '/my-books',
      icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253'
    }
  ];
</script>

<nav
  class="fixed bottom-0 left-0 right-0 z-50 bg-white/95 dark:bg-stone-900/95 backdrop-blur-md border-t border-stone-200 dark:border-stone-800 safe-area-bottom shadow-lg"
  aria-label="Mobile Navigation"
>
  <div class="grid grid-cols-3 h-16 max-w-lg mx-auto px-2">
    {#each navItems as item}
      {@const isActive = page.url.pathname === item.href}
      <a
        href={item.href}
        class="inline-flex flex-col items-center justify-center min-h-[44px] px-1 transition-colors select-none {isActive
          ? 'text-amber-600 dark:text-amber-400 font-semibold'
          : 'text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-200'}"
      >
        <svg
          class="w-5 h-5 transition-transform active:scale-90"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d={item.icon} />
        </svg>
        <span class="text-[10px] mt-1 tracking-tight truncate w-full text-center">
          {item.label}
        </span>
      </a>
    {/each}
  </div>
</nav>
