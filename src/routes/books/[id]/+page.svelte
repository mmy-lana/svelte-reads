<script lang="ts">
  import { page } from '$app/state';
  import Avatar from '$lib/components/atoms/Avatar.svelte';
  import Badge from '$lib/components/atoms/Badge.svelte';
  import Button from '$lib/components/atoms/Button.svelte';
  import RatingStars from '$lib/components/atoms/RatingStars.svelte';
  import RatingDistributionBar from '$lib/components/molecules/RatingDistributionBar.svelte';
  import ReadingProgressWidget from '$lib/components/molecules/ReadingProgressWidget.svelte';
  import ShelfSelector from '$lib/components/molecules/ShelfSelector.svelte';
  import SpoilerGuard from '$lib/components/molecules/SpoilerGuard.svelte';
  import CardGridSkeleton from '$lib/components/shells/CardGridSkeleton.svelte';
  import EmptyState from '$lib/components/shells/EmptyState.svelte';
  import { authState } from '$lib/state/auth.svelte';
  import { catalogStore } from '$lib/state/catalog.svelte';
  import { reviewStore } from '$lib/state/review.svelte';
  import { shelfStore } from '$lib/state/shelf.svelte';
  import { REVIEW_SORT_OPTIONS } from '$lib/state/review.svelte';
  import {
    RATING_BOUNDS,
    bayesianFromDistribution,
    distributionAverage,
    formatRating,
    totalRatings
  } from '$lib/utils/ratings';
  import { countLabel, formatDate, formatNumber, formatPageCount, formatRelativeDate } from '$lib/utils/format';
  import {
    decideRatingSubmission,
    ratingFailureNotice,
    reviewPayloadFromDraft
  } from '$lib/utils/review-submission';
  import { SHELF_STATUS_LABELS } from '$lib/utils/shelf-state-machine';
  import type { ReviewDraft, ReviewSortOption, ShelfStatus } from '$lib/types/domain';

  /**
   * Editorial detail page.
   *
   * Shows the catalog metadata, the community score with its confidence
   * explanation, the reader's own shelf/progress/rating controls, and the review
   * feed. Each asynchronous surface owns its loading, empty, and error state.
   */
  const bookId = $derived(page.params.id ?? '');

  let requestedBookId = $state<string | null>(null);
  let composerOpen = $state(false);
  let draft = $state<ReviewDraft>({ rating: 0, title: '', content: '', containsSpoilers: false });
  let composerError = $state<string | null>(null);
  let composerStatus = $state<string | null>(null);
  /**
   * Set when the review half of a submission landed but the rating half did
   * not. Kept separate from `composerError` so the warning survives the
   * reviewer's next keystroke instead of reading as a fresh form error.
   */
  let ratingWarning = $state<string | null>(null);
  let isSubmittingReview = $state(false);
  let isDeletingReview = $state(false);
  let confirmDelete = $state(false);
  let shelfFailure = $state<string | null>(null);
  // One generated id per component; suffixes keep the label/control pairs unique.
  const uid = $props.id();
  const titleFieldId = `${uid}-review-title`;
  const contentFieldId = `${uid}-review-content`;
  const spoilerFieldId = `${uid}-review-spoilers`;
  const sortFieldId = `${uid}-review-sort`;
  const composerHeadingId = `${uid}-composer-heading`;

  $effect(() => {
    const id = bookId;
    if (!id || requestedBookId === id) return;
    requestedBookId = id;
    void (async () => {
      await catalogStore.loadBook(id);
      await reviewStore.loadReviews(id, { refresh: true });
    })();
  });

  const book = $derived(bookId ? catalogStore.bookFor(bookId) : undefined);
  const isLoadingBook = $derived(bookId ? catalogStore.isLoadingBook(bookId) : false);
  const bookError = $derived(bookId ? catalogStore.bookError(bookId) : null);
  const notFound = $derived(!isLoadingBook && !book && !bookError && requestedBookId === bookId);

  const shelf = $derived(bookId ? shelfStore.shelfFor(bookId) : undefined);
  const aggregates = $derived(book ? shelfStore.aggregatesFor(book) : null);
  const reviews = $derived(bookId ? reviewStore.reviewsFor(bookId) : []);
  const reviewsLoading = $derived(bookId ? reviewStore.isLoading(bookId) : false);
  const reviewsError = $derived(bookId ? reviewStore.failureFor(bookId) : null);
  const reviewsHasMore = $derived(bookId ? reviewStore.hasMore(bookId) : false);
  const ownReview = $derived(bookId ? reviewStore.ownReview(bookId) : null);
  const sortOption = $derived<ReviewSortOption>(bookId ? reviewStore.sortFor(bookId) : 'newest');
  const readerRating = $derived(shelf?.rating ?? 0);
  const ratingPending = $derived(bookId ? shelfStore.isPending(bookId) : false);
  const ratingFailure = $derived(bookId ? shelfStore.failureFor(bookId) : null);

  const distribution = $derived(aggregates?.ratingDistribution ?? book?.ratingDistribution ?? null);
  const ratingsCount = $derived(aggregates?.ratingsCount ?? book?.ratingsCount ?? 0);
  // `aggregatesFor` already prefers this session's optimistic values over the
  // stored book document, so the score reflects a rating the moment it is chosen.
  const bayesianScore = $derived(aggregates?.bayesianRating ?? book?.bayesianRating ?? 0);
  const simpleAverage = $derived(
    distribution
      ? totalRatings(distribution) > 0
        ? distributionAverage(distribution)
        : 0
      : (book?.averageRating ?? 0)
  );
  const confidenceGap = $derived(Math.max(simpleAverage - bayesianScore, 0));


  function openComposer(mode: 'create' | 'edit'): void {
    composerOpen = true;
    composerError = null;
    composerStatus = null;
    ratingWarning = null;

    if (mode === 'edit' && ownReview) {
      draft = {
        rating: ownReview.rating,
        title: ownReview.title,
        content: ownReview.content,
        containsSpoilers: ownReview.containsSpoilers
      };
      return;
    }

    draft = {
      rating: readerRating > 0 ? readerRating : 0,
      title: '',
      content: '',
      containsSpoilers: false
    };
  }

  function validateDraft(): string | null {
    if (draft.rating < RATING_BOUNDS.MIN) return 'Choose a rating between 0.5 and 5 stars.';
    if (draft.title.trim().length < 2) return 'Give your review a title of at least 2 characters.';
    if (draft.title.trim().length > 120) return 'Keep the title under 120 characters.';
    if (draft.content.trim().length < 20) {
      return 'Write at least 20 characters so readers know what you thought.';
    }
    if (draft.content.trim().length > 10_000) return 'Reviews are limited to 10,000 characters.';
    return null;
  }

  /** Prefers the typed, reader-facing message a store already produced. */
  function describeComposerError(error: unknown, fallback: string): string {
    return error instanceof Error && error.message.length > 0 ? error.message : fallback;
  }

  async function submitReview(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!book || isSubmittingReview) return;

    const problem = validateDraft();
    if (problem) {
      composerError = problem;
      return;
    }

    if (!authState.user) {
      composerError = 'Sign in to publish a review — your draft is kept below.';
      return;
    }

    isSubmittingReview = true;
    composerError = null;
    ratingWarning = null;

    const payload = reviewPayloadFromDraft(draft);

    // The shelf row is snapshotted up front: the review write refreshes the
    // store, so reading `shelf.rating` after the await would compare the new
    // rating against itself and skip the write.
    const previousRating = shelf?.rating ?? 0;
    const ratingDecision = decideRatingSubmission(payload.rating, previousRating);
    const wasEditing = ownReview !== null;

    try {
      if (wasEditing && ownReview) {
        await reviewStore.updateReview(book.id, ownReview.id, payload);
      } else {
        await reviewStore.createReview(book, payload);
      }
    } catch (error) {
      // The review itself failed, so nothing was persisted and nothing is
      // half-written: keep the composer open with the draft intact.
      composerError = describeComposerError(error, 'Your review could not be saved. Try again.');
      isSubmittingReview = false;
      return;
    }

    if (!ratingDecision.submit) {
      composerOpen = false;
      composerStatus = wasEditing ? 'Review updated.' : 'Review published.';
      isSubmittingReview = false;
      return;
    }

    // DATA-02: the rating is a second, independent write. It used to be fired
    // with `.catch(() => undefined)`, which reported success while silently
    // dropping the star rating. It is now awaited and its failure is surfaced.
    try {
      await shelfStore.submitRating(book, payload.rating);
      composerOpen = false;
      composerStatus = wasEditing
        ? 'Review updated and your rating saved.'
        : 'Review published and your rating saved.';
    } catch (error) {
      // `submitRating` rolls its own optimistic row and aggregates back before
      // it rejects, so no partial rating survives this failure. The review is a
      // valid standalone document and stays published; the reviewer is told
      // exactly which half of the submission did not land.
      composerError = ratingFailureNotice({
        wasEditing,
        reason: describeComposerError(error, 'your rating could not be saved')
      });
      ratingWarning = composerError;
      composerOpen = true;
      composerStatus = null;
    } finally {
      isSubmittingReview = false;
    }
  }

  async function deleteReview(): Promise<void> {
    if (!bookId || !ownReview || isDeletingReview) return;
    isDeletingReview = true;
    try {
      await reviewStore.deleteReview(bookId, ownReview.id);
      composerStatus = 'Review deleted.';
      composerOpen = false;
      confirmDelete = false;
      ratingWarning = null;
    } catch (error) {
      composerError = describeComposerError(
        error,
        'Your review could not be deleted. Try again.'
      );
    } finally {
      isDeletingReview = false;
    }
  }

  async function changeShelf(status: ShelfStatus): Promise<void> {
    if (!book) return;
    shelfFailure = null;
    try {
      await shelfStore.setStatus(book, status);
    } catch (error) {
      shelfFailure = shelfStore.failureFor(book.id) ?? (error instanceof Error ? error.message : 'That change could not be saved.');
    }
  }

  async function changeRating(value: number): Promise<void> {
    if (!book) return;
    shelfFailure = null;
    try {
      await shelfStore.submitRating(book, value);
    } catch (error) {
      shelfFailure = shelfStore.failureFor(book.id) ?? (error instanceof Error ? error.message : 'That rating could not be saved.');
    }
  }

  async function changeProgress(pages: number): Promise<void> {
    if (!book) return;
    shelfFailure = null;
    try {
      await shelfStore.updateProgress(book, pages);
    } catch (error) {
      shelfFailure = shelfStore.failureFor(book.id) ?? (error instanceof Error ? error.message : 'That progress could not be saved.');
    }
  }
</script>

<svelte:head>
  <title>{book ? `${book.title} — SvelteReads` : 'Book — SvelteReads'}</title>
  <meta
    name="description"
    content={book
      ? `Reviews, ratings, and community score for ${book.title} by ${book.authors.join(', ')}.`
      : 'Book details, reviews, and ratings on SvelteReads.'}
  />
</svelte:head>

{#if isLoadingBook && !book}
  <div class="flex flex-col gap-6">
    <p class="sr-only" role="status">Loading book details…</p>
    <div class="h-8 w-2/3 animate-pulse rounded-[var(--radius-pill)] bg-stone-200 motion-reduce:animate-none dark:bg-stone-800"></div>
    <CardGridSkeleton count={4} label="Loading book details…" />
  </div>
{:else if bookError}
  <EmptyState
    tone="warning"
    title="This book could not be loaded"
    description={bookError}
    icon="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
  >
    {#snippet action()}
      <Button variant="primary" size="sm" href="/">Back to discovery</Button>
    {/snippet}
  </EmptyState>
{:else if notFound || !book}
  <EmptyState
    title="We could not find that book"
    description="The link may be outdated, or the title is no longer in the catalog."
    icon="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
  >
    {#snippet action()}
      <Button variant="primary" size="sm" href="/search">Search the catalog</Button>
    {/snippet}
  </EmptyState>
{:else}
  <nav aria-label="Breadcrumb" class="mb-4">
    <ol class="flex flex-wrap items-center gap-1 text-sm text-stone-500 dark:text-stone-400">
      <li><a href="/" class="rounded-[var(--radius-control)] px-1 hover:text-stone-800 dark:hover:text-stone-100">Explore</a></li>
      <li aria-hidden="true">/</li>
      <li><a href="/search" class="rounded-[var(--radius-control)] px-1 hover:text-stone-800 dark:hover:text-stone-100">Catalog</a></li>
      <li aria-hidden="true">/</li>
      <li class="min-w-0 truncate px-1 font-medium text-stone-700 dark:text-stone-300" aria-current="page">
        {book.title}
      </li>
    </ol>
  </nav>

  <article class="grid gap-6 lg:grid-cols-[260px_1fr]">
    <div class="flex flex-col gap-4">
      <div class="overflow-hidden rounded-[var(--radius-card)] border border-stone-200 bg-stone-100 dark:border-stone-800 dark:bg-stone-800">
        {#if book.coverUrl}
          <img
            src={book.coverUrl}
            alt="Cover of {book.title}"
            width={400}
            height={600}
            fetchpriority="high"
            decoding="async"
            class="h-auto w-full object-cover"
          />
        {:else}
          <div class="grid aspect-[2/3] place-items-center p-4 text-center" aria-hidden="true">
            <span class="font-serif text-sm text-stone-600 dark:text-stone-300">{book.title}</span>
          </div>
        {/if}
      </div>

      <dl class="grid grid-cols-2 gap-3 rounded-[var(--radius-card)] border border-stone-200 bg-white p-4 text-sm dark:border-stone-800 dark:bg-stone-900 lg:grid-cols-1">
        <div class="min-w-0">
          <dt class="text-xs uppercase tracking-wide text-stone-500 dark:text-stone-400">Pages</dt>
          <dd class="font-medium tabular-nums text-stone-800 dark:text-stone-200">{formatPageCount(book.pageCount)}</dd>
        </div>
        <div class="min-w-0">
          <dt class="text-xs uppercase tracking-wide text-stone-500 dark:text-stone-400">Published</dt>
          <dd class="font-medium text-stone-800 dark:text-stone-200">{formatDate(book.publishedDate)}</dd>
        </div>
        <div class="min-w-0">
          <dt class="text-xs uppercase tracking-wide text-stone-500 dark:text-stone-400">Publisher</dt>
          <dd class="truncate font-medium text-stone-800 dark:text-stone-200">{book.publisher || 'Not recorded'}</dd>
        </div>
        <div class="min-w-0">
          <dt class="text-xs uppercase tracking-wide text-stone-500 dark:text-stone-400">Language</dt>
          <dd class="truncate font-medium text-stone-800 dark:text-stone-200">{book.language || 'Not recorded'}</dd>
        </div>
        <div class="col-span-2 min-w-0 lg:col-span-1">
          <dt class="text-xs uppercase tracking-wide text-stone-500 dark:text-stone-400">ISBN-13</dt>
          <dd class="truncate font-mono text-xs text-stone-800 dark:text-stone-200" translate="no">{book.isbn13 || 'Not recorded'}</dd>
        </div>
      </dl>
    </div>

    <div class="min-w-0">
      <header>
        <h1 class="text-balance font-serif text-3xl font-semibold leading-tight text-stone-900 sm:text-4xl dark:text-stone-50">
          {book.title || 'Untitled'}
        </h1>
        {#if book.subtitle}
          <p class="mt-1 text-lg text-stone-600 dark:text-stone-400">{book.subtitle}</p>
        {/if}
        <p class="mt-2 text-base text-stone-700 dark:text-stone-300">
          by {book.authors.length > 0 ? book.authors.join(', ') : 'Unknown author'}
        </p>

        {#if book.genres.length > 0}
          <ul class="mt-3 flex flex-wrap gap-2">
            {#each book.genres as genre (genre)}
              <li>
                <a
                  href={`/search?genre=${encodeURIComponent(genre)}`}
                  class="inline-flex rounded-[var(--radius-pill)] border border-stone-300 px-3 py-1 text-xs font-medium text-stone-700 hover:border-primary-400 hover:text-primary-800 focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-stone-700 dark:text-stone-300 dark:hover:border-primary-500 dark:hover:text-primary-200"
                >
                  {genre}
                </a>
              </li>
            {/each}
          </ul>
        {/if}
      </header>

      {#if book.description}
        <section class="mt-5" aria-labelledby="synopsis-heading">
          <h2 id="synopsis-heading" class="font-serif text-lg font-semibold text-stone-900 dark:text-stone-100">Synopsis</h2>
          <p class="mt-2 max-w-prose text-pretty leading-relaxed text-stone-700 dark:text-stone-300">{book.description}</p>
        </section>
      {/if}

      <section class="mt-6 rounded-[var(--radius-card)] border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900" aria-labelledby="score-heading">
        <h2 id="score-heading" class="font-serif text-lg font-semibold text-stone-900 dark:text-stone-100">
          Community score
        </h2>

        <div class="mt-3 grid gap-5 sm:grid-cols-[auto_1fr] sm:items-start">
          <div>
            <p class="flex items-baseline gap-2">
              <span class="font-serif text-4xl font-semibold tabular-nums text-stone-900 dark:text-stone-50">
                {formatRating(bayesianScore)}
              </span>
              <span class="text-sm text-stone-500 dark:text-stone-400">Bayesian score</span>
            </p>
            <p class="mt-1 text-sm text-stone-600 dark:text-stone-400">
              {formatRating(simpleAverage)} simple average from {countLabel(ratingsCount, 'rating')}
            </p>
            <p class="mt-2 max-w-xs text-pretty text-xs text-stone-500 dark:text-stone-400">
              {#if ratingsCount === 0}
                No ratings yet, so the score sits at the catalog baseline until readers weigh in.
              {:else if confidenceGap > 0.05}
                Pulled {formatRating(confidenceGap)} below the raw average to discount for the small number of ratings.
              {:else}
                Close to the raw average because this title has enough ratings to be confident.
              {/if}
            </p>
          </div>

          {#if distribution}
            <RatingDistributionBar
              {distribution}
              totalOverride={ratingsCount}
              title={`Rating distribution for ${book.title}`}
            />
          {/if}
        </div>
      </section>

      <section class="mt-6 rounded-[var(--radius-card)] border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900" aria-labelledby="your-books-heading">
        <h2 id="your-books-heading" class="font-serif text-lg font-semibold text-stone-900 dark:text-stone-100">
          Your reading
        </h2>

        {#if !authState.user}
          <p class="mt-2 text-sm text-stone-600 dark:text-stone-400">
            Sign in to shelve this book, track your page, and rate it.
          </p>
          <Button variant="primary" size="sm" href="/profile" class="mt-3">Sign in</Button>
        {:else}
          <div class="mt-4 flex flex-col gap-5">
            <div>
              <p class="text-sm font-medium text-stone-700 dark:text-stone-300">Shelf</p>
              <div class="mt-2 flex flex-wrap items-center gap-3">
                <ShelfSelector
                  bookId={book.id}
                  bookTitle={book.title}
                  currentStatus={shelf?.status ?? null}
                  disabled={ratingPending}
                  onSelect={(status) => changeShelf(status)}
                />
                {#if shelf}
                  <span class="text-xs text-stone-500 dark:text-stone-400">
                    Last updated {formatRelativeDate(shelf.updatedAt)}
                  </span>
                {/if}
              </div>
            </div>

            <div>
              <p class="text-sm font-medium text-stone-700 dark:text-stone-300">Your rating</p>
              <div class="mt-2 flex flex-wrap items-center gap-3">
                <RatingStars
                  value={readerRating}
                  showValue
                  size="lg"
                  label={`Your rating for ${book.title}`}
                  disabled={ratingPending}
                  onChange={(value) => void changeRating(value)}
                />
                {#if readerRating > 0}
                  <span class="text-xs text-stone-500 dark:text-stone-400">
                    {SHELF_STATUS_LABELS[shelf?.status ?? 'read']} · rated {formatRating(readerRating)}
                  </span>
                {/if}
              </div>
            </div>

            {#if shelf && shelf.status !== 'want-to-read'}
              <div>
                <p class="text-sm font-medium text-stone-700 dark:text-stone-300">Progress</p>
                <div class="mt-2 max-w-md">
                  <ReadingProgressWidget
                    bookId={book.id}
                    pageCount={book.pageCount}
                    bookTitle={book.title}
                    currentPage={shelf.progressPages}
                    disabled={ratingPending}
                    onProgressChange={(pages) => changeProgress(pages)}
                  />
                </div>
              </div>
            {/if}
          </div>
        {/if}

        {#if shelfFailure || ratingFailure}
          <p class="mt-4 text-sm font-medium text-rose-700 dark:text-rose-300" role="alert">
            {shelfFailure ?? ratingFailure}
          </p>
        {/if}
      </section>

      <section class="mt-6" aria-labelledby="reviews-heading">
        <div class="flex flex-wrap items-end justify-between gap-3">
          <div class="min-w-0">
            <h2 id="reviews-heading" class="font-serif text-2xl font-semibold text-stone-900 dark:text-stone-50">
              Reader reviews
            </h2>
            <p class="mt-1 text-sm text-stone-600 dark:text-stone-400">
              {countLabel(reviews.length, 'review')} shown
              {#if reviewsHasMore}of many more{/if}
            </p>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <label class="text-sm text-stone-600 dark:text-stone-400" for={sortFieldId}>Sort</label>
            <select
              id={sortFieldId}
              value={sortOption}
              onchange={(event) => reviewStore.reorder(book.id, event.currentTarget.value as ReviewSortOption)}
              class="h-11 rounded-[var(--radius-control)] border border-stone-300 bg-white px-3 text-sm text-stone-900 focus:border-primary-500 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
            >
              {#each REVIEW_SORT_OPTIONS as option (option.value)}
                <option value={option.value}>{option.label}</option>
              {/each}
            </select>

            <Button variant={ownReview ? 'secondary' : 'primary'} size="sm" onclick={() => openComposer(ownReview ? 'edit' : 'create')}>
              {ownReview ? 'Edit your review' : 'Write a review'}
            </Button>
          </div>
        </div>

        <div aria-live="polite" class="sr-only">{composerStatus ?? ''}</div>

        {#if ratingWarning && !composerOpen}
          <p
            class="mt-4 rounded-[var(--radius-control)] border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
            role="alert"
          >
            {ratingWarning}
            <button type="button" class="ml-2 underline" onclick={() => (ratingWarning = null)}>
              Dismiss
            </button>
          </p>
        {/if}

        {#if composerOpen}
          <form
            class="mt-4 rounded-[var(--radius-card)] border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900"
            onsubmit={(event) => void submitReview(event)}
            aria-labelledby={composerHeadingId}
            novalidate
          >
            <h3 id={composerHeadingId} class="font-serif text-lg font-semibold text-stone-900 dark:text-stone-100">
              {ownReview ? 'Edit your review' : `Review ${book.title}`}
            </h3>

            {#if !authState.user}
              <p class="mt-2 text-sm text-stone-600 dark:text-stone-400">
                Sign in to publish. Your text stays in this form.
              </p>
            {/if}

            <div class="mt-4 flex flex-col gap-4">
              <div>
                <p class="text-sm font-medium text-stone-700 dark:text-stone-300">Rating</p>
                <div class="mt-1">
                  <RatingStars
                    bind:value={draft.rating}
                    showValue
                    size="lg"
                    label={`Rating for ${book.title}`}
                  />
                </div>
              </div>

              <div class="flex flex-col gap-1">
                <label class="text-sm font-medium text-stone-700 dark:text-stone-300" for={titleFieldId}>
                  Review title
                </label>
                <input
                  id={titleFieldId}
                  name="title"
                  type="text"
                  bind:value={draft.title}
                  maxlength="120"
                  autocomplete="off"
                  spellcheck="true"
                  placeholder="Summarise your take in a few words…"
                  aria-describedby={composerError ? `${titleFieldId}-error` : undefined}
                  class="h-11 w-full rounded-[var(--radius-control)] border border-stone-300 bg-white px-3 text-sm text-stone-900 placeholder:text-stone-400 focus:border-primary-500 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
                />
              </div>

              <div class="flex flex-col gap-1">
                <label class="text-sm font-medium text-stone-700 dark:text-stone-300" for={contentFieldId}>
                  Your review
                </label>
                <textarea
                  id={contentFieldId}
                  name="content"
                  bind:value={draft.content}
                  rows="6"
                  maxlength="10000"
                  spellcheck="true"
                  placeholder="What worked, what did not, and who should read it…"
                  class="w-full rounded-[var(--radius-control)] border border-stone-300 bg-white px-3 py-2 text-sm leading-relaxed text-stone-900 placeholder:text-stone-400 focus:border-primary-500 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
                ></textarea>
                <p class="text-xs text-stone-500 dark:text-stone-400">
                  {draft.content.trim().length} of 10,000 characters
                </p>
              </div>

              <div class="flex items-start gap-3">
                <input
                  id={spoilerFieldId}
                  name="containsSpoilers"
                  type="checkbox"
                  bind:checked={draft.containsSpoilers}
                  class="mt-0.5 h-5 w-5 shrink-0 rounded border-stone-300 text-primary-600 focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-stone-600"
                />
                <label class="text-sm text-stone-700 dark:text-stone-300" for={spoilerFieldId}>
                  This review contains spoilers
                  <span class="block text-xs text-stone-500 dark:text-stone-400">
                    Spoiler reviews stay masked behind a reveal control.
                  </span>
                </label>
              </div>
            </div>

            {#if composerError}
              <p id={`${titleFieldId}-error`} class="mt-3 text-sm font-medium text-rose-700 dark:text-rose-300" role="alert">
                {composerError}
              </p>
            {/if}

            <div class="mt-4 flex flex-wrap items-center gap-2">
              <Button type="submit" variant="primary" size="sm" loading={isSubmittingReview}>
                {#if isSubmittingReview}
                  Saving…
                {:else if ownReview}
                  Save changes
                {:else}
                  Publish review
                {/if}
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={isSubmittingReview} onclick={() => (composerOpen = false)}>
                Cancel
              </Button>
              {#if ownReview}
                {#if confirmDelete}
                  <span class="ml-auto flex flex-wrap items-center gap-2 text-sm text-stone-600 dark:text-stone-400">
                    Delete this review?
                    <Button type="button" variant="danger" size="sm" loading={isDeletingReview} onclick={() => void deleteReview()}>
                      Yes, delete
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onclick={() => (confirmDelete = false)}>Keep it</Button>
                  </span>
                {:else}
                  <Button type="button" variant="ghost" size="sm" class="ml-auto" onclick={() => (confirmDelete = true)}>
                    Delete review
                  </Button>
                {/if}
              {/if}
            </div>
          </form>
        {/if}

        {#if reviewsError}
          <EmptyState tone="warning" title="Reviews could not be loaded" description={reviewsError} class="mt-4 py-8">
            {#snippet action()}
              <Button variant="primary" size="sm" onclick={() => void reviewStore.loadReviews(book.id, { refresh: true })}>
                Try again
              </Button>
            {/snippet}
          </EmptyState>
        {:else if reviewsLoading && reviews.length === 0}
          <div class="mt-4">
            <CardGridSkeleton count={2} columns="rows" label="Loading reviews…" />
          </div>
        {:else if reviews.length === 0}
          <EmptyState
            title="No reviews yet"
            description="Be the first to say what you thought. A few sentences is plenty."
            class="mt-4 py-8"
          >
            {#snippet action()}
              <Button variant={ownReview ? 'secondary' : 'primary'} size="sm" onclick={() => openComposer(ownReview ? 'edit' : 'create')}>
                {ownReview ? 'Edit your review' : 'Write the first review'}
              </Button>
            {/snippet}
          </EmptyState>
        {:else}
          <ul class="mt-4 flex flex-col gap-4">
            {#each reviews as review (review.id)}
              <li class="rounded-[var(--radius-card)] border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
                <article>
                  <header class="flex flex-wrap items-start gap-3">
                    <Avatar src={review.userAvatarUrl} alt="" name={review.userDisplayName} size="sm" />
                    <div class="min-w-0 flex-1">
                      <p class="truncate text-sm font-semibold text-stone-900 dark:text-stone-100">
                        {review.userDisplayName || 'Reader'}
                      </p>
                      <p class="truncate font-mono text-xs text-stone-500 dark:text-stone-400">
                        @{review.userHandle || 'reader'}
                      </p>
                    </div>
                    <div class="flex flex-col items-end gap-1">
                      <RatingStars value={review.rating} readonly size="sm" label={`${review.userDisplayName || 'Reader'} rated this ${formatRating(review.rating)}`} />
                      <time datetime={review.createdAt} class="text-xs text-stone-500 dark:text-stone-400" title={formatDate(review.createdAt)}>
                        {formatRelativeDate(review.createdAt)}
                      </time>
                    </div>
                  </header>

                  <div class="mt-3">
                    <SpoilerGuard containsSpoilers={review.containsSpoilers}>
                      <h3 class="font-serif text-lg font-semibold text-stone-900 dark:text-stone-100">
                        {review.title || 'Untitled review'}
                      </h3>
                      <p class="mt-2 whitespace-pre-line text-pretty leading-relaxed text-stone-700 dark:text-stone-300">
                        {review.content}
                      </p>
                    </SpoilerGuard>
                  </div>

                  {#if review.tags.length > 0}
                    <ul class="mt-3 flex flex-wrap gap-2">
                      {#each review.tags as tag (tag)}
                        <li>
                          <Badge tone="stone">{tag}</Badge>
                        </li>
                      {/each}
                    </ul>
                  {/if}

                  <footer class="mt-3 flex flex-wrap items-center gap-4 text-xs text-stone-500 dark:text-stone-400">
                    <span>{countLabel(review.likesCount, 'helpful vote')}</span>
                    <span>{countLabel(review.commentsCount, 'comment')}</span>
                    {#if ownReview?.id === review.id}
                      <span class="font-medium text-primary-700 dark:text-primary-300">Your review</span>
                    {/if}
                  </footer>
                </article>
              </li>
            {/each}
          </ul>

          {#if reviewsHasMore}
            <div class="mt-4 flex justify-center">
              <Button variant="secondary" size="md" loading={reviewsLoading} onclick={() => void reviewStore.loadMoreReviews(book.id)}>
                {reviewsLoading ? 'Loading…' : 'Load more reviews'}
              </Button>
            </div>
          {/if}
        {/if}
      </section>
    </div>
  </article>
{/if}
