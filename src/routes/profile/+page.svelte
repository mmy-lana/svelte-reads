<script lang="ts">
  import { goto } from '$app/navigation';
  import Avatar from '$lib/components/atoms/Avatar.svelte';
  import Button from '$lib/components/atoms/Button.svelte';
  import EmptyState from '$lib/components/shells/EmptyState.svelte';
  import { authState } from '$lib/state/auth.svelte';
  import { shelfStore } from '$lib/state/shelf.svelte';
  import { readingGoalTarget } from '$lib/utils/profile';
  import { countLabel, formatNumber } from '$lib/utils/format';

  /**
   * Account and reading stats.
   *
   * Anonymous readers get the sign-in form; signed-in readers get their profile,
   * shelf counters, reading-challenge target, and the sign-out control. Auth
   * failures are reported inline next to the form rather than as a toast that can
   * disappear before it is read.
   */
  type Mode = 'sign-in' | 'sign-up';

  const emailFieldId = $props.id();
  const passwordFieldId = `${emailFieldId}-password`;
  const displayNameFieldId = `${emailFieldId}-name`;
  const goalFieldId = `${emailFieldId}-goal`;
  const formHeadingId = `${emailFieldId}-heading`;

  let mode = $state<Mode>('sign-in');
  let email = $state('');
  let password = $state('');
  let displayName = $state('');
  let goalDraft = $state('');
  let formError = $state<string | null>(null);
  let goalStatus = $state<string | null>(null);
  let isSubmitting = $state(false);
  let isSavingGoal = $state(false);

  const profile = $derived(authState.profile);
  const counts = $derived(shelfStore.counts);
  const goal = $derived(profile?.readingGoal ?? null);
  const goalTarget = $derived(Number.parseInt(goalDraft, 10));

  $effect(() => {
    // DEF-01: seed the goal input from the loaded profile. The read is extracted
    // into `readingGoalTarget` because `readingGoal` is optional at runtime even
    // though the schema requires it — a legacy document written before the field
    // existed, or an optimistic sign-up write, arrives without it, and the
    // original `profile?.readingGoal.targetBooks` threw on `undefined.targetBooks`.
    const target = readingGoalTarget(profile);
    if (target !== null && goalDraft === '') goalDraft = String(target);
  });

  async function submitCredentials(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (isSubmitting) return;

    const trimmedEmail = email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmedEmail)) {
      formError = 'Enter a valid email address, for example reader@example.com.';
      return;
    }
    if (password.length < 6) {
      formError = 'Passwords need at least 6 characters.';
      return;
    }
    if (mode === 'sign-up' && displayName.trim().length < 2) {
      formError = 'Add a display name of at least 2 characters so readers can recognise you.';
      return;
    }

    isSubmitting = true;
    formError = null;

    try {
      if (mode === 'sign-up') {
        await authState.signUp(trimmedEmail, password, displayName.trim());
      } else {
        await authState.signIn(trimmedEmail, password);
      }
      password = '';
      await goto('/my-books');
    } catch (error) {
      formError = describe(error, 'We could not sign you in. Check your details and try again.');
    } finally {
      isSubmitting = false;
    }
  }

  async function submitGoogle(): Promise<void> {
    isSubmitting = true;
    formError = null;
    try {
      await authState.signInWithGoogle();
      await goto('/my-books');
    } catch (error) {
      formError = describe(error, 'Google sign-in did not complete. Try again or use your email.');
    } finally {
      isSubmitting = false;
    }
  }

  async function sendReset(): Promise<void> {
    const trimmedEmail = email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmedEmail)) {
      formError = 'Enter your email address first, then request a reset link.';
      return;
    }
    try {
      await authState.sendPasswordReset(trimmedEmail);
      formError = null;
      goalStatus = 'Reset link sent. Check your inbox.';
    } catch (error) {
      formError = describe(error, 'That reset email could not be sent. Try again shortly.');
    }
  }

  async function saveGoal(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (isSavingGoal) return;

    if (!Number.isFinite(goalTarget) || goalTarget < 1 || goalTarget > 500) {
      goalStatus = 'Choose a target between 1 and 500 books.';
      return;
    }

    isSavingGoal = true;
    goalStatus = null;
    try {
      await authState.updateProfile({
        readingGoal: {
          year: goal?.year ?? new Date().getFullYear(),
          targetBooks: goalTarget,
          completedBooks: counts.read
        }
      });
      goalStatus = `Target saved: ${countLabel(goalTarget, 'book')} this year.`;
    } catch (error) {
      goalStatus = describe(error, 'That target could not be saved. Try again.');
    } finally {
      isSavingGoal = false;
    }
  }

  async function signOut(): Promise<void> {
    await authState.signOut();
    shelfStore.clear();
    await goto('/');
  }

  function describe(error: unknown, fallback: string): string {
    return error instanceof Error && error.message.length > 0 ? error.message : fallback;
  }
</script>

<svelte:head>
  <title>Your profile — SvelteReads</title>
  <meta name="description" content="Your reading stats, yearly goal, and account settings on SvelteReads." />
</svelte:head>

{#if authState.status === 'initializing'}
  <div class="mx-auto max-w-xl">
    <p class="sr-only" role="status">Loading your session…</p>
    <div class="h-40 animate-pulse rounded-[var(--radius-card)] bg-stone-200 motion-reduce:animate-none dark:bg-stone-800"></div>
  </div>
{:else if !authState.user || !profile}
  <div class="mx-auto max-w-md">
    <h1 class="text-balance font-serif text-3xl font-semibold text-stone-900 dark:text-stone-50">
      {mode === 'sign-in' ? 'Sign in to SvelteReads' : 'Create your reader account'}
    </h1>
    <p class="mt-2 text-sm text-stone-600 dark:text-stone-400">
      Shelves, progress, ratings, and reviews are stored against your account.
    </p>

    {#if authState.status === 'error' && authState.error}
      <p class="mt-4 rounded-[var(--radius-control)] border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200" role="alert">
        {authState.error}
      </p>
    {/if}

    <form
      class="mt-6 flex flex-col gap-4 rounded-[var(--radius-card)] border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900"
      onsubmit={(event) => void submitCredentials(event)}
      aria-labelledby={formHeadingId}
      novalidate
    >
      <h2 id={formHeadingId} class="font-serif text-lg font-semibold text-stone-900 dark:text-stone-100">
        {mode === 'sign-in' ? 'Email and password' : 'Account details'}
      </h2>

      {#if mode === 'sign-up'}
        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium text-stone-700 dark:text-stone-300" for={displayNameFieldId}>
            Display name
          </label>
          <input
            id={displayNameFieldId}
            name="displayName"
            type="text"
            bind:value={displayName}
            autocomplete="name"
            maxlength="60"
            placeholder="Ada Lovelace"
            class="h-11 w-full rounded-[var(--radius-control)] border border-stone-300 bg-white px-3 text-sm text-stone-900 placeholder:text-stone-400 focus:border-primary-500 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
          />
        </div>
      {/if}

      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium text-stone-700 dark:text-stone-300" for={emailFieldId}>Email</label>
        <input
          id={emailFieldId}
          name="email"
          type="email"
          inputmode="email"
          autocomplete="email"
          spellcheck="false"
          bind:value={email}
          placeholder="reader@example.com"
          class="h-11 w-full rounded-[var(--radius-control)] border border-stone-300 bg-white px-3 text-sm text-stone-900 placeholder:text-stone-400 focus:border-primary-500 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
        />
      </div>

      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium text-stone-700 dark:text-stone-300" for={passwordFieldId}>Password</label>
        <input
          id={passwordFieldId}
          name="password"
          type="password"
          autocomplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
          bind:value={password}
          minlength="6"
          placeholder="At least 6 characters"
          class="h-11 w-full rounded-[var(--radius-control)] border border-stone-300 bg-white px-3 text-sm text-stone-900 placeholder:text-stone-400 focus:border-primary-500 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
        />
      </div>

      {#if formError}
        <p class="text-sm font-medium text-rose-700 dark:text-rose-300" role="alert">{formError}</p>
      {/if}

      <Button type="submit" variant="primary" size="md" loading={isSubmitting} fullWidth>
        {#if isSubmitting}
          Working…
        {:else if mode === 'sign-in'}
          Sign in
        {:else}
          Create account
        {/if}
      </Button>

      <Button type="button" variant="secondary" size="md" disabled={isSubmitting} fullWidth onclick={() => void submitGoogle()}>
        Continue with Google
      </Button>

      <div class="flex flex-wrap items-center justify-between gap-2 text-sm">
        <button
          type="button"
          class="rounded-[var(--radius-control)] px-2 py-1 font-medium text-primary-700 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 dark:text-primary-300"
          onclick={() => {
            mode = mode === 'sign-in' ? 'sign-up' : 'sign-in';
            formError = null;
          }}
        >
          {mode === 'sign-in' ? 'Create an account instead' : 'I already have an account'}
        </button>

        {#if mode === 'sign-in'}
          <button
            type="button"
            class="rounded-[var(--radius-control)] px-2 py-1 text-stone-600 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 dark:text-stone-400"
            onclick={() => void sendReset()}
          >
            Forgot password
          </button>
        {/if}
      </div>
    </form>
  </div>
{:else}
  <div class="flex flex-col gap-8">
    <header class="flex flex-wrap items-center gap-4">
      <Avatar
        src={profile.avatarUrl}
        alt=""
        name={profile.displayName}
        size="lg"
      />
      <div class="min-w-0">
        <h1 class="text-balance font-serif text-3xl font-semibold text-stone-900 dark:text-stone-50">
          {profile.displayName}
        </h1>
        <p class="font-mono text-sm text-stone-500 dark:text-stone-400">@{profile.handle}</p>
        <p class="mt-1 text-sm text-stone-600 dark:text-stone-400">{profile.email}</p>
      </div>
      <Button variant="secondary" size="sm" class="ml-auto" onclick={() => void signOut()}>Sign out</Button>
    </header>

    <section aria-labelledby="stats-heading">
      <h2 id="stats-heading" class="font-serif text-xl font-semibold text-stone-900 dark:text-stone-50">
        Your reading
      </h2>
      <dl class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div class="rounded-[var(--radius-card)] border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
          <dt class="text-xs uppercase tracking-wide text-stone-500 dark:text-stone-400">On shelves</dt>
          <dd class="mt-1 font-serif text-2xl font-semibold tabular-nums text-stone-900 dark:text-stone-50">
            {formatNumber(counts.all)}
          </dd>
        </div>
        <div class="rounded-[var(--radius-card)] border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
          <dt class="text-xs uppercase tracking-wide text-stone-500 dark:text-stone-400">Reading now</dt>
          <dd class="mt-1 font-serif text-2xl font-semibold tabular-nums text-stone-900 dark:text-stone-50">
            {formatNumber(counts['currently-reading'])}
          </dd>
        </div>
        <div class="rounded-[var(--radius-card)] border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
          <dt class="text-xs uppercase tracking-wide text-stone-500 dark:text-stone-400">Finished</dt>
          <dd class="mt-1 font-serif text-2xl font-semibold tabular-nums text-stone-900 dark:text-stone-50">
            {formatNumber(counts.read)}
          </dd>
        </div>
        <div class="rounded-[var(--radius-card)] border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
          <dt class="text-xs uppercase tracking-wide text-stone-500 dark:text-stone-400">Reviews</dt>
          <dd class="mt-1 font-serif text-2xl font-semibold tabular-nums text-stone-900 dark:text-stone-50">
            {formatNumber(profile.stats.reviewsCount)}
          </dd>
        </div>
      </dl>
    </section>

    <section aria-labelledby="goal-heading" class="max-w-xl">
      <h2 id="goal-heading" class="font-serif text-xl font-semibold text-stone-900 dark:text-stone-50">
        {goal ? `${goal.year} reading challenge` : 'Reading challenge'}
      </h2>
      <p class="mt-1 text-sm text-stone-600 dark:text-stone-400">
        Set how many books you want to finish this year. Books marked Read count automatically.
      </p>

      <form class="mt-3 flex flex-wrap items-end gap-3" onsubmit={(event) => void saveGoal(event)}>
        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium text-stone-700 dark:text-stone-300" for={goalFieldId}>
            Target books
          </label>
          <input
            id={goalFieldId}
            name="targetBooks"
            type="number"
            inputmode="numeric"
            min="1"
            max="500"
            step="1"
            bind:value={goalDraft}
            class="h-11 w-28 rounded-[var(--radius-control)] border border-stone-300 bg-white px-3 text-sm tabular-nums text-stone-900 focus:border-primary-500 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
          />
        </div>
        <Button type="submit" variant="primary" size="md" loading={isSavingGoal}>
          {isSavingGoal ? 'Saving…' : 'Save target'}
        </Button>
      </form>

      <div aria-live="polite" class="mt-2 min-h-5 text-sm text-stone-600 dark:text-stone-400">
        {goalStatus ?? ''}
      </div>
    </section>

    <section aria-labelledby="shelves-heading" class="max-w-xl">
      <h2 id="shelves-heading" class="font-serif text-xl font-semibold text-stone-900 dark:text-stone-50">
        Manage your books
      </h2>
      <p class="mt-1 text-sm text-stone-600 dark:text-stone-400">
        {countLabel(counts.all, 'book')} on your shelves — open a tab to update progress or ratings.
      </p>
      <div class="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" size="md" href="/my-books">Go to my shelves</Button>
        <Button variant="secondary" size="md" href="/my-books?tab=currently-reading">Continue reading</Button>
        <Button variant="secondary" size="md" href="/search">Find something new</Button>
      </div>
    </section>

    {#if counts.all === 0}
      <EmptyState
        title="Your shelves are still empty"
        description="Shelve a book from discovery or search and it appears here with progress tracking."
      >
        {#snippet action()}
          <Button variant="primary" size="sm" href="/search">Browse the catalog</Button>
        {/snippet}
      </EmptyState>
    {/if}
  </div>
{/if}
