<script lang="ts">
  import '../app.css';
  import AppHeader from '$lib/components/shells/AppHeader.svelte';
  import MobileBottomNav from '$lib/components/shells/MobileBottomNav.svelte';
  import { authState } from '$lib/state/auth.svelte';
  import { shelfStore } from '$lib/state/shelf.svelte';
  import type { Snippet } from 'svelte';

  /**
   * Application shell.
   *
   * The Firebase session is resolved here once, and the reader's shelves are
   * loaded whenever the signed-in user changes. Firestore access is intentionally
   * client-side: the security rules authorise requests with the browser session
   * token, so there is nothing meaningful to render on the server for
   * reader-specific data.
   *
   * Layout notes:
   * - `overflow-x-clip` (not `hidden`) contains wide content without turning the
   *   shell into a scroll container, which keeps the sticky header sticky.
   * - The main region reserves room for the mobile bottom bar and the bottom
   *   safe area so neither hides content or a focused control.
   */
  interface Props {
    children: Snippet;
  }

  let { children }: Props = $props();

  $effect(() => {
    void authState.init();
  });

  $effect(() => {
    const uid = authState.user?.uid ?? null;
    if (!uid) return;

    void (async () => {
      try {
        await authState.whenReady();
        await shelfStore.loadShelves({ refresh: true });
      } catch {
        // The stores already expose reader-facing error state; the shell must not
        // crash because a background refresh failed.
      }
    })();
  });

  $effect(() => {
    // Signing out must not leave another reader's shelves on screen.
    if (authState.status === 'anonymous') shelfStore.clear();
  });
</script>

<a
  href="#main-content"
  class="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-[var(--radius-control)] focus:bg-primary-600 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
>
  Skip to main content
</a>

<div class="flex min-h-dvh flex-col overflow-x-clip bg-canvas text-stone-800 dark:bg-night dark:text-stone-200">
  <AppHeader />

  <main
    id="main-content"
    tabindex="-1"
    class="mx-auto w-full max-w-7xl flex-1 px-4 pb-28 pt-6 sm:px-6 sm:pb-16 lg:px-8"
  >
    {@render children()}
  </main>

  <footer
    class="border-t border-stone-200 px-4 py-6 pb-28 text-center text-xs text-stone-500 sm:px-6 md:pb-6 dark:border-stone-800 dark:text-stone-400"
  >
    <p>
      SvelteReads — a reading community built with
      <span translate="no">SvelteKit</span>,
      <span translate="no">Firebase</span>, and
      <span translate="no">Tailwind CSS</span>.
    </p>
  </footer>
</div>

<MobileBottomNav
  badges={{
    'My Shelves': shelfStore.counts['currently-reading'] + shelfStore.counts['want-to-read']
  }}
/>
