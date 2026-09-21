<script lang="ts">
  import { page } from '$app/state';
  import type { Book, Review, ShelfStatus } from '$lib/types/domain';
  import RatingStars from '$lib/components/atoms/RatingStars.svelte';
  import ShelfSelector from '$lib/components/molecules/ShelfSelector.svelte';
  import SpoilerGuard from '$lib/components/molecules/SpoilerGuard.svelte';
  import { shelfStore } from '$lib/state/shelf.svelte';
  import { reviewStore } from '$lib/state/review.svelte';
  import { authState } from '$lib/state/auth.svelte';

  const bookId = $derived(page.params.id || '9780143127741');

  const bookData: Book = $state({
    id: '9780143127741',
    isbn13: '9780143127741',
    isbn10: '0143127748',
    title: 'East of Eden',
    subtitle: '',
    authors: ['John Steinbeck'],
    publisher: 'Penguin Books',
    publishedDate: '2014-09-02',
    description: 'Set in the rich farmland of California\'s Salinas Valley, this sprawling and often brutal novel follows the intertwined destinies of two families.',
    pageCount: 601,
    genres: ['Classics', 'Fiction', 'Historical Fiction'],
    coverUrl: 'https://images-na.ssl-images-amazon.com/images/S/compressed.photo.goodreads.com/books/1356819428i/4406.jpg',
    thumbnailUrl: '',
    language: 'en',
    averageRating: 4.38,
    bayesianRating: 4.32,
    ratingsCount: 642100,
    reviewsCount: 31200,
    ratingDistribution: { 1: 12000, 2: 24000, 3: 72000, 4: 210000, 5: 324100 },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  let reviews = $state<Review[]>([
    {
      id: 'demo_user_1_9780143127741',
      bookId: '9780143127741',
      bookTitle: 'East of Eden',
      bookCoverUrl: 'https://images-na.ssl-images-amazon.com/images/S/compressed.photo.goodreads.com/books/1356819428i/4406.jpg',
      userId: 'demo_user_1',
      userDisplayName: 'Eleanor Vance',
      userHandle: 'eleanor_v',
      userAvatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Eleanor',
      rating: 5.0,
      title: 'A towering masterpiece of American literature',
      content: 'Steinbeck explores free will versus predestination through the concept of Timshel. The prose is patient and evocative.',
      containsSpoilers: false,
      likesCount: 34,
      commentsCount: 3,
      tags: ['Classics'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ]);

  const userShelf = $derived(shelfStore.shelfFor(bookData.id));
  let isWritingReview = $state(false);
  let reviewTitle = $state('');
  let reviewContent = $state('');
  let reviewRating = $state(5.0);
  let reviewSpoiler = $state(false);
  let isSubmitting = $state(false);

  async function handleShelfChange(status: ShelfStatus) {
    await shelfStore.setStatus(bookData, status);
  }

  async function handleRatingChange(rating: number) {
    await shelfStore.submitRating(bookData, rating);
  }

  async function submitReview() {
    if (!authState.user) return;
    isSubmitting = true;
    try {
      await reviewStore.createReview(bookData, {
        rating: reviewRating,
        title: reviewTitle,
        content: reviewContent,
        containsSpoilers: reviewSpoiler
      });
      reviews = [
        {
          id: `${authState.user.uid}_${bookData.id}`,
          bookId: bookData.id,
          bookTitle: bookData.title,
          bookCoverUrl: bookData.coverUrl,
          userId: authState.user.uid,
          userDisplayName: authState.profile?.displayName || 'Reader',
          userHandle: authState.profile?.handle || 'reader',
          userAvatarUrl: authState.profile?.avatarUrl || '',
          rating: reviewRating,
          title: reviewTitle,
          content: reviewContent,
          containsSpoilers: reviewSpoiler,
          likesCount: 0,
          commentsCount: 0,
          tags: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        ...reviews
      ];
      isWritingReview = false;
      reviewTitle = '';
      reviewContent = '';
    } finally {
      isSubmitting = false;
    }
  }
</script>

<div class="space-y-8">
  <section class="grid grid-cols-1 md:grid-cols-12 gap-8 items-start">
    <div class="md:col-span-4 lg:col-span-3 flex flex-col items-center gap-4">
      <div class="w-48 sm:w-56 md:w-full max-w-[260px] aspect-[2/3] rounded-xl overflow-hidden shadow-xl border border-stone-200 dark:border-stone-800 bg-stone-100 dark:bg-stone-800">
        <img
          src={bookData.coverUrl}
          alt={`Cover of ${bookData.title}`}
          class="w-full h-full object-cover"
        />
      </div>

      <div class="w-full max-w-[260px] space-y-3">
        <ShelfSelector
          bookId={bookData.id}
          currentStatus={userShelf?.status}
          onSelect={handleShelfChange}
        />

        <div class="bg-stone-100/70 dark:bg-stone-900/70 p-3 rounded-lg border border-stone-200/60 dark:border-stone-800 text-center">
          <span class="block text-xs font-medium text-stone-500 dark:text-stone-400 mb-1">
            My Rating
          </span>
          <RatingStars
            value={userShelf?.rating || 0}
            size="md"
            onChange={handleRatingChange}
          />
        </div>
      </div>
    </div>

    <div class="md:col-span-8 lg:col-span-9 space-y-6">
      <div class="space-y-2">
        <div class="flex flex-wrap gap-2">
          {#each bookData.genres as genre}
            <span class="px-2.5 py-0.5 rounded-full text-xs font-medium bg-stone-200 dark:bg-stone-800 text-stone-700 dark:text-stone-300">
              {genre}
            </span>
          {/each}
        </div>
        <h1 class="text-2xl sm:text-3xl lg:text-4xl font-serif font-bold text-stone-900 dark:text-stone-50 tracking-tight">
          {bookData.title}
        </h1>
        <p class="text-base font-medium text-stone-700 dark:text-stone-300">
          by {bookData.authors.join(', ')}
        </p>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 shadow-xs">
        <div class="flex flex-col justify-center items-center sm:items-start p-2 border-b sm:border-b-0 sm:border-r border-stone-100 dark:border-stone-800">
          <div class="flex items-baseline gap-2">
            <span class="text-4xl font-serif font-black text-stone-900 dark:text-stone-100">
              {bookData.averageRating.toFixed(2)}
            </span>
            <span class="text-xs text-stone-400 font-mono">/ 5.0</span>
          </div>
          <RatingStars value={bookData.averageRating} readonly size="sm" />
          <p class="text-xs text-stone-500 dark:text-stone-400 mt-2 font-mono">
            {bookData.ratingsCount.toLocaleString()} community ratings
          </p>
          <div class="mt-1 flex items-center gap-1.5">
            <span class="text-[11px] font-semibold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 px-2 py-0.5 rounded border border-amber-200 dark:border-amber-800/50">
              Bayesian Weighted: {bookData.bayesianRating.toFixed(2)}
            </span>
          </div>
        </div>

        <div class="flex flex-col justify-center space-y-1.5 p-2">
          {#each [5, 4, 3, 2, 1] as star}
            {@const count = bookData.ratingDistribution[star as 1|2|3|4|5] || 0}
            {@const pct = bookData.ratingsCount > 0 ? (count / bookData.ratingsCount) * 100 : 0}
            <div class="flex items-center text-xs gap-2">
              <span class="w-3 text-right font-mono text-stone-500">{star}</span>
              <div class="flex-1 h-2 bg-stone-100 dark:bg-stone-800 rounded-full overflow-hidden">
                <div class="h-full bg-amber-500 rounded-full" style="width: {pct}%"></div>
              </div>
              <span class="w-10 text-right font-mono text-stone-400 text-[11px]">
                {Math.round(pct)}%
              </span>
            </div>
          {/each}
        </div>
      </div>

      <div class="prose prose-stone dark:prose-invert max-w-none text-sm sm:text-base leading-relaxed">
        <h3 class="text-sm font-sans font-semibold uppercase tracking-wider text-stone-400">Synopsis</h3>
        <p>{bookData.description}</p>
      </div>

      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs border-y border-stone-200 dark:border-stone-800 py-3">
        <div>
          <span class="text-stone-400 block">Pages</span>
          <span class="font-semibold text-stone-800 dark:text-stone-200 font-mono">{bookData.pageCount}</span>
        </div>
        <div>
          <span class="text-stone-400 block">Published</span>
          <span class="font-semibold text-stone-800 dark:text-stone-200">{bookData.publishedDate}</span>
        </div>
        <div>
          <span class="text-stone-400 block">Publisher</span>
          <span class="font-semibold text-stone-800 dark:text-stone-200 truncate block">{bookData.publisher}</span>
        </div>
        <div>
          <span class="text-stone-400 block">ISBN</span>
          <span class="font-semibold text-stone-800 dark:text-stone-200 font-mono">{bookData.isbn13}</span>
        </div>
      </div>
    </div>
  </section>

  <section class="space-y-6 pt-6 border-t border-stone-200 dark:border-stone-800">
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <h2 class="text-xl sm:text-2xl font-serif font-bold text-stone-900 dark:text-stone-100">
          Community Reviews
        </h2>
        <p class="text-xs text-stone-500 font-mono mt-0.5">
          {reviews.length} written thoughts from readers
        </p>
      </div>

      {#if !isWritingReview}
        <button
          type="button"
          class="min-h-[44px] px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-medium text-xs sm:text-sm rounded-lg shadow-xs transition-colors self-start sm:self-auto active:scale-98"
          onclick={() => (isWritingReview = true)}
        >
          Write a Review
        </button>
      {/if}
    </div>

    {#if isWritingReview}
      <form
        class="bg-white dark:bg-stone-900 p-5 rounded-xl border border-stone-300 dark:border-stone-700 shadow-md space-y-4"
        onsubmit={(e) => { e.preventDefault(); submitReview(); }}
      >
        <div class="flex items-center justify-between">
          <h3 class="font-serif font-bold text-lg">Your Review</h3>
          <button
            type="button"
            class="text-stone-400 hover:text-stone-600 text-sm font-semibold p-1"
            onclick={() => (isWritingReview = false)}
          >
            Cancel
          </button>
        </div>

        <div>
          <span class="block text-xs font-semibold text-stone-600 dark:text-stone-300 mb-1">
            Rating
          </span>
          <RatingStars bind:value={reviewRating} size="md" />
        </div>

        <div>
          <label for="review-title" class="block text-xs font-semibold text-stone-600 dark:text-stone-300 mb-1">
            Review Headline
          </label>
          <input
            id="review-title"
            type="text"
            required
            bind:value={reviewTitle}
            placeholder="Sum up your reading experience in a headline..."
            class="w-full px-3 py-2 text-sm bg-stone-50 dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
        </div>

        <div>
          <label for="review-content" class="block text-xs font-semibold text-stone-600 dark:text-stone-300 mb-1">
            Review Content
          </label>
          <textarea
            id="review-content"
            required
            rows="5"
            bind:value={reviewContent}
            placeholder="What resonated with you? Character development, pacing, style..."
            class="w-full px-3 py-2 text-sm bg-stone-50 dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 resize-y"
          ></textarea>
        </div>

        <div class="flex items-center gap-2">
          <input
            id="spoiler-checkbox"
            type="checkbox"
            bind:checked={reviewSpoiler}
            class="w-4 h-4 text-amber-600 rounded border-stone-300 focus:ring-amber-500"
          />
          <label for="spoiler-checkbox" class="text-xs text-stone-700 dark:text-stone-300">
            This review contains plot spoilers
          </label>
        </div>

        <div class="flex justify-end gap-3 pt-2">
          <button
            type="submit"
            disabled={isSubmitting}
            class="min-h-[44px] px-6 py-2 bg-stone-900 hover:bg-stone-800 dark:bg-amber-600 dark:hover:bg-amber-500 text-white font-semibold text-xs rounded-lg transition-colors disabled:opacity-50"
          >
            {isSubmitting ? 'Publishing...' : 'Publish Review'}
          </button>
        </div>
      </form>
    {/if}

    <div class="space-y-4">
      {#each reviews as review (review.id)}
        <article class="p-5 bg-white dark:bg-stone-900 rounded-xl border border-stone-200 dark:border-stone-800/80 shadow-xs space-y-3">
          <div class="flex items-start justify-between">
            <div class="flex items-center gap-3">
              <img
                src={review.userAvatarUrl}
                alt={review.userDisplayName}
                class="w-9 h-9 rounded-full object-cover border border-stone-200 dark:border-stone-700"
              />
              <div>
                <span class="block text-xs font-bold text-stone-900 dark:text-stone-100">
                  {review.userDisplayName}
                </span>
                <span class="text-[11px] text-stone-400 font-mono">
                  {new Date(review.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
              </div>
            </div>
            <RatingStars value={review.rating} readonly size="sm" />
          </div>

          <h4 class="font-serif font-bold text-base text-stone-900 dark:text-stone-100">
            {review.title}
          </h4>

          <SpoilerGuard containsSpoilers={review.containsSpoilers}>
            <p class="text-sm leading-relaxed text-stone-700 dark:text-stone-300 whitespace-pre-line">
              {review.content}
            </p>
          </SpoilerGuard>
        </article>
      {/each}
    </div>
  </section>
</div>
