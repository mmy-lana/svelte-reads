<script lang="ts">
  import { authState } from '$lib/state/auth.svelte';
</script>

<header class="sticky top-0 z-40 w-full border-b border-stone-200 dark:border-stone-800 bg-white/90 dark:bg-stone-900/90 backdrop-blur-md">
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
    <div class="flex items-center gap-6">
      <a href="/" class="flex items-center gap-2 text-stone-950 dark:text-stone-50 focus:outline-none">
        <span class="font-serif text-xl font-bold tracking-tight text-amber-700 dark:text-amber-500">
          SvelteReads
        </span>
      </a>

      <nav class="hidden md:flex items-center gap-5 text-sm font-medium text-stone-600 dark:text-stone-300">
        <a href="/" class="hover:text-amber-600 dark:hover:text-amber-400 transition-colors">Explore</a>
        <a href="/my-books" class="hover:text-amber-600 dark:hover:text-amber-400 transition-colors">My Shelves</a>
      </nav>
    </div>

    <div class="flex items-center gap-3">
      <a
        href="/search"
        class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400 text-xs hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors"
        aria-label="Search catalog"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <span class="hidden sm:inline">Search titles, authors, genres...</span>
      </a>

      {#if authState.user}
        <div class="flex items-center gap-2">
          <img
            src={authState.profile?.avatarUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${authState.user.email}`}
            alt="Profile Avatar"
            class="w-8 h-8 rounded-full border border-stone-300 dark:border-stone-700 object-cover"
          />
        </div>
      {:else}
        <button
          type="button"
          class="text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white transition-colors"
        >
          Sign In
        </button>
      {/if}
    </div>
  </div>
</header>
