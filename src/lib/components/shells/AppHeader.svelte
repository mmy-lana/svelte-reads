<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import Avatar from '$lib/components/atoms/Avatar.svelte';
  import Button from '$lib/components/atoms/Button.svelte';
  import { cx } from '$lib/utils/cx';
  import { authState } from '$lib/state/auth.svelte';
  import { shelfStore } from '$lib/state/shelf.svelte';

  /**
   * Application header.
   *
   * Everything here works without hover: the account menu is a click/keyboard
   * disclosure (Escape closes it and focus returns to the trigger), and the
   * inline search is a real form so it also submits with Enter.
   */
  interface Props {
    class?: string;
  }

  let { class: className = '' }: Props = $props();

  let isMenuOpen = $state(false);
  let isSearchOpen = $state(false);
  let query = $state('');
  let searchInput: HTMLInputElement | null = $state(null);
  let menuTrigger: HTMLButtonElement | null = $state(null);
  let menuElement: HTMLDivElement | null = $state(null);

  const navigation = [
    { label: 'Explore', href: '/', matches: ['/'] },
    { label: 'My Shelves', href: '/my-books', matches: ['/my-books'] },
    { label: 'Reading Challenge', href: '/my-books?tab=read', matches: ['/challenge'] }
  ] as const;

  const initials = $derived(
    (authState.profile?.displayName ?? authState.user?.displayName ?? 'Reader')
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('')
  );

  const readingCount = $derived(
    shelfStore.counts['currently-reading'] + shelfStore.counts['want-to-read']
  );

  const searchId = $props.id();

  function isActive(matches: readonly string[], pathname: string): boolean {
    if (matches.includes('/')) return pathname === '/';
    return matches.some((prefix) => pathname.startsWith(prefix));
  }

  function openMenu(): void {
    isMenuOpen = true;
    void (async () => {
      const { tick } = await import('svelte');
      await tick();
      menuElement?.querySelector<HTMLAnchorElement>('a[href]')?.focus();
    })();
  }

  function closeMenu(restoreFocus = true): void {
    if (!isMenuOpen) return;
    isMenuOpen = false;
    if (restoreFocus) menuTrigger?.focus({ preventScroll: true });
  }

  function handleMenuKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu();
      return;
    }

    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;

    const items = [...(menuElement?.querySelectorAll<HTMLElement>('a[href], button') ?? [])];
    if (items.length === 0) return;

    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement as HTMLElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    const nextIndex = (currentIndex + step + items.length) % items.length;
    items[nextIndex]?.focus();
  }

  function openSearch(): void {
    isSearchOpen = true;
    void (async () => {
      const { tick } = await import('svelte');
      await tick();
      searchInput?.focus();
    })();
  }

  function submitSearch(event: SubmitEvent): void {
    event.preventDefault();
    const term = query.trim();
    void goto(term.length > 0 ? `/search?q=${encodeURIComponent(term)}` : '/search');
    isSearchOpen = false;
  }

  async function signOut(): Promise<void> {
    closeMenu(false);
    await authState.signOut();
    shelfStore.clear();
    await goto('/');
  }

  // Clicking anywhere outside the menu closes it, matching native expectations.
  function handleDocumentPointerDown(event: PointerEvent): void {
    if (!isMenuOpen) return;
    const target = event.target as Node | null;
    if (target && menuElement?.contains(target)) return;
    if (target && menuTrigger?.contains(target)) return;
    closeMenu(false);
  }

  $effect(() => {
    if (!isMenuOpen) return;
    const controller = new AbortController();
    document.addEventListener('pointerdown', handleDocumentPointerDown, {
      signal: controller.signal
    });
    return () => controller.abort();
  });

  $effect(() => {
    // The mobile search panel closes when the route changes.
    void page.url.pathname;
    isSearchOpen = false;
  });
</script>

<svelte:window
  onkeydown={(event) => {
    if (event.key === 'Escape') closeMenu();
  }}
/>

<header
  class={cx(
    'sticky top-0 z-30 border-b border-stone-200/80 bg-canvas/85 backdrop-blur-md dark:border-stone-800/80 dark:bg-night/85',
    className
  )}
>
  <div class="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4 sm:h-16 sm:px-6 lg:px-8">
    <a
      href="/"
      class="flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] pr-2 font-serif text-lg font-semibold tracking-tight text-stone-900 sm:text-xl dark:text-stone-50"
      aria-label="SvelteReads home"
    >
      <span
        class="grid h-8 w-8 place-items-center rounded-[var(--radius-control)] bg-primary-600 font-mono text-sm font-bold text-white"
        aria-hidden="true"
      >
        SR
      </span>
      <span>SvelteReads</span>
    </a>

    <nav class="ml-2 hidden items-center gap-1 md:flex" aria-label="Sections">
      {#each navigation as item (item.href)}
        {@const active = isActive(item.matches, page.url.pathname)}
        <a
          href={item.href}
          class={cx(
            'flex min-h-11 items-center rounded-[var(--radius-control)] px-3 text-sm font-medium transition-colors',
            active
              ? 'bg-primary-50 text-primary-800 dark:bg-primary-950/50 dark:text-primary-200'
              : 'text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800'
          )}
          aria-current={active ? 'page' : undefined}
        >
          {item.label}
        </a>
      {/each}
    </nav>

    <form class="ml-auto hidden max-w-md flex-1 items-center gap-2 md:flex" onsubmit={submitSearch} role="search">
      <label class="sr-only" for={searchId}>Search the catalog</label>
      <div class="relative min-w-0 flex-1">
        <svg
          class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          aria-hidden="true"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          id={searchId}
          type="search"
          name="q"
          bind:value={query}
          placeholder="Search titles, authors, genres…"
          autocomplete="off"
          class="h-10 w-full rounded-[var(--radius-control)] border border-stone-300 bg-white pl-9 pr-3 text-sm text-stone-900 placeholder:text-stone-400 focus:border-primary-500 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
        />
      </div>
      <Button type="submit" variant="secondary" size="sm" class="shrink-0">Search</Button>
    </form>

    <div class="ml-auto flex items-center gap-1 md:ml-2">
      <Button
        variant="ghost"
        size="sm"
        ariaLabel={isSearchOpen ? 'Close search' : 'Open search'}
        onclick={() => (isSearchOpen ? (isSearchOpen = false) : openSearch())}
        class="md:hidden"
      >
        {#snippet leadingIcon()}
          <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        {/snippet}
      </Button>

      {#if authState.user}
        <div class="relative">
          <button
            type="button"
            bind:this={menuTrigger}
            class="flex min-h-11 min-w-11 items-center gap-2 rounded-[var(--radius-control)] px-1.5 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800"
            aria-haspopup="menu"
            aria-expanded={isMenuOpen}
            onclick={() => (isMenuOpen ? closeMenu() : openMenu())}
          >
            <Avatar
              src={authState.profile?.avatarUrl ?? authState.user.photoURL}
              alt=""
              name={authState.profile?.displayName ?? authState.user.displayName ?? initials}
              size="sm"
            />
            <span class="hidden max-w-24 truncate sm:inline">
              {authState.profile?.displayName ?? authState.user.displayName ?? 'Reader'}
            </span>
            <svg
              class="hidden h-4 w-4 text-stone-400 sm:block"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              aria-hidden="true"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {#if isMenuOpen}
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <div
              class="absolute right-0 top-full z-40 mt-2 w-60 overflow-hidden rounded-[var(--radius-card)] border border-stone-200 bg-white py-1 shadow-elevation-3 dark:border-stone-800 dark:bg-stone-900"
              role="menu"
              tabindex="-1"
              bind:this={menuElement}
              onkeydown={handleMenuKeydown}
              aria-label="Account"
            >
              <div class="border-b border-stone-100 px-3 py-2 dark:border-stone-800">
                <p class="truncate text-sm font-semibold text-stone-900 dark:text-stone-100">
                  {authState.profile?.displayName ?? 'Reader'}
                </p>
                <p class="truncate font-mono text-xs text-stone-500 dark:text-stone-400">
                  @{authState.profile?.handle ?? 'reader'}
                </p>
              </div>

              <a
                href="/profile"
                role="menuitem"
                class="flex min-h-11 items-center px-3 text-sm text-stone-700 hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800"
                onclick={() => closeMenu(false)}
              >
                Your profile
              </a>
              <a
                href="/my-books"
                role="menuitem"
                class="flex min-h-11 items-center px-3 text-sm text-stone-700 hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800"
                onclick={() => closeMenu(false)}
              >
                My shelves
                {#if readingCount > 0}
                  <span class="ml-auto font-mono text-xs text-stone-500 dark:text-stone-400">
                    {readingCount}
                  </span>
                {/if}
              </a>

              <div class="mt-1 border-t border-stone-100 px-2 pt-1 dark:border-stone-800">
                <button
                  type="button"
                  role="menuitem"
                  class="flex min-h-11 w-full items-center rounded-[var(--radius-control)] px-2 text-sm font-medium text-rose-700 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/40"
                  onclick={() => void signOut()}
                >
                  {authState.isBusy ? 'Signing out…' : 'Sign out'}
                </button>
              </div>
            </div>
          {/if}
        </div>
      {:else}
        <Button variant="primary" size="sm" href="/profile" class="whitespace-nowrap">
          Sign in
        </Button>
      {/if}
    </div>
  </div>

  {#if isSearchOpen}
    <form
      class="border-t border-stone-200 px-4 py-2 md:hidden dark:border-stone-800"
      onsubmit={submitSearch}
      role="search"
    >
      <label class="sr-only" for={`${searchId}-mobile`}>Search the catalog</label>
      <div class="flex items-center gap-2">
        <input
          id={`${searchId}-mobile`}
          bind:this={searchInput}
          type="search"
          name="q"
          bind:value={query}
          placeholder="Search titles, authors, genres…"
          autocomplete="off"
          enterkeyhint="search"
          class="h-11 min-w-0 flex-1 rounded-[var(--radius-control)] border border-stone-300 bg-white px-3 text-sm text-stone-900 placeholder:text-stone-400 focus:border-primary-500 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
        />
        <Button type="submit" variant="primary" size="sm" class="shrink-0">Search</Button>
      </div>
    </form>
  {/if}
</header>
