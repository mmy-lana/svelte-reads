<script lang="ts">
  import '../app.css';
  import { onMount, type Snippet } from 'svelte';
  import AppHeader from '$lib/components/shells/AppHeader.svelte';
  import MobileBottomNav from '$lib/components/shells/MobileBottomNav.svelte';
  import { authState } from '$lib/state/auth.svelte';
  import { shelfStore } from '$lib/state/shelf.svelte';

  interface Props {
    children: Snippet;
  }

  let { children }: Props = $props();

  onMount(() => {
    if (authState.user) {
      shelfStore.loadUserShelves();
    }
  });

  $effect(() => {
    if (authState.user) {
      shelfStore.loadUserShelves();
    }
  });
</script>

<div class="min-h-screen flex flex-col bg-stone-50 dark:bg-stone-950 text-stone-900 dark:text-stone-100 font-sans antialiased selection:bg-amber-200 selection:text-amber-900">
  <AppHeader />

  <main class="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4 pb-24 md:pb-12">
    {@render children()}
  </main>

  <div class="md:hidden">
    <MobileBottomNav />
  </div>
</div>
