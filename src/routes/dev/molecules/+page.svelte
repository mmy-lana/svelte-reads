<script lang="ts">
  import BookCardClean from '$lib/components/molecules/BookCardClean.svelte';
  import RatingDistributionBar from '$lib/components/molecules/RatingDistributionBar.svelte';
  import ReadingProgressWidget from '$lib/components/molecules/ReadingProgressWidget.svelte';
  import ShelfSelector from '$lib/components/molecules/ShelfSelector.svelte';
  import SpoilerGuard from '$lib/components/molecules/SpoilerGuard.svelte';
  import type { Book, RatingDistribution, ShelfStatus } from '$lib/types/domain';

  /** Inline SVG cover: deterministic, offline, and identical in every run. */
  const inlineCover =
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600" viewBox="0 0 400 600">' +
        '<rect width="400" height="600" fill="#78350f"/>' +
        '<rect x="28" y="28" width="344" height="544" fill="none" stroke="#fcd34d" stroke-width="4"/>' +
        '<circle cx="200" cy="250" r="86" fill="#fbbf24"/>' +
        '<rect x="90" y="400" width="220" height="14" fill="#fde68a"/>' +
        '<rect x="120" y="430" width="160" height="14" fill="#fde68a"/>' +
        '</svg>'
    );

  /** Deterministic fixtures: the certification harness asserts against these. */
  function makeBook(overrides: Partial<Book> & Pick<Book, 'id' | 'title'>): Book {
    return {
      isbn13: '9780000000000',
      isbn10: '',
      subtitle: '',
      authors: ['Ada Okonkwo'],
      publisher: 'Halcyon Press',
      publishedDate: '2024-03-12',
      description: '',
      pageCount: 420,
      genres: ['Fiction'],
      coverUrl: '',
      thumbnailUrl: '',
      language: 'English',
      averageRating: 4.12,
      bayesianRating: 4.08,
      ratingsCount: 1842,
      reviewsCount: 96,
      ratingDistribution: { 1: 24, 2: 41, 3: 168, 4: 612, 5: 997 },
      createdAt: '2024-03-12T00:00:00.000Z',
      updatedAt: '2024-03-12T00:00:00.000Z',
      ...overrides
    };
  }

  const oneLineTitle = makeBook({ id: 'title-1', title: 'Salt', coverUrl: inlineCover });
  const twoLineTitle = makeBook({
    id: 'title-2',
    title: 'The Quiet Cartography of Small Towns',
    authors: ['Marco Silva', 'Yuki Tanaka']
  });
  const fourLineTitle = makeBook({
    id: 'title-3',
    title:
      'A Comprehensive and Unreasonably Detailed History of Every Library That Ever Burned Down, Rebuilt Itself, and Burned Down Again',
    authors: ['Nadia Haddad']
  });
  const unratedBook = makeBook({
    id: 'title-4',
    title: 'Unrated Manuscript',
    averageRating: 0,
    bayesianRating: 0,
    ratingsCount: 0,
    reviewsCount: 0,
    ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  });
  const hugeCountBook = makeBook({
    id: 'title-5',
    title: 'Perennial Reader',
    coverUrl: inlineCover,
    averageRating: 4.36,
    ratingsCount: 4123456,
    ratingDistribution: { 1: 41234, 2: 82469, 3: 412345, 4: 1832154, 5: 1850254 }
  });
  const rejectingWriteBook = makeBook({
    id: 'title-7',
    title: 'Rejected Writes',
    coverUrl: inlineCover
  });
  const unreachableCoverBook = makeBook({
    id: 'title-6',
    title: 'Missing Jacket',
    // Port 9 is the discard port: the connection is refused immediately, so the
    // cover-error fallback renders deterministically without touching the network.
    coverUrl: 'http://127.0.0.1:9/cover.png'
  });

  let firstShelf = $state<ShelfStatus | null>('currently-reading');
  const rejectShelf = $state<ShelfStatus | null>(null);
  let shelfUpdateCount = $state(0);

  let progressPage = $state(120);
  let progressCommitCount = $state(0);
  let completionCount = $state(0);
  let strictPage = $state(40);

  const distribution: RatingDistribution = { 1: 12, 2: 38, 3: 214, 4: 1086, 5: 2418 };
  const skewedDistribution: RatingDistribution = { 1: 4000, 2: 900, 3: 120, 4: 30, 5: 4 };
  const emptyDistribution: RatingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

  async function assignShelf(status: ShelfStatus): Promise<void> {
    firstShelf = status;
    shelfUpdateCount += 1;
  }

  async function rejectShelfChange(): Promise<void> {
    throw new Error('Simulated write failure');
  }

  async function saveProgress(pages: number, _percentage: number): Promise<void> {
    progressPage = pages;
    progressCommitCount += 1;
  }

  async function completeProgress(_pages: number): Promise<void> {
    completionCount += 1;
  }

  async function strictSave(): Promise<void> {
    throw new Error('Simulated progress write failure');
  }

  const longReview = [
    'The middle third is where the book earns its reputation: the narrator stops explaining and starts noticing.',
    'What follows is a slow collision between two families who cannot admit they need each other, and the ending refuses the comfort a lesser novel would offer.',
    'If you are allergic to ambiguity, this will frustrate you; everyone else should read it twice.'
  ];
</script>

<svelte:head>
  <title>Molecule Gallery · Development</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div id="molecule-gallery" class="mx-auto max-w-6xl space-y-12 pb-16">
  <header class="space-y-2">
    <p class="font-mono text-xs font-medium uppercase tracking-[0.2em] text-primary-700 dark:text-primary-300">
      Phase 3 · Compound Molecules
    </p>
    <h1 class="font-serif text-title text-stone-900 dark:text-stone-50">Molecule gallery</h1>
    <p class="max-w-2xl text-sm text-stone-600 dark:text-stone-300">
      Book cards with clamped titles, the responsive shelf picker, the progress widget, the spoiler
      guard, and the rating histogram — rendered here so their behaviour can be certified at 360,
      390, 430, and 768px.
    </p>
  </header>

  <section class="space-y-4" data-section="book-cards">
    <h2 class="font-serif text-2xl text-stone-900 dark:text-stone-50">BookCardClean</h2>

    <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" data-book-grid>
      <BookCardClean book={oneLineTitle} currentShelf={firstShelf} onShelfChange={assignShelf} />
      <BookCardClean book={twoLineTitle} currentShelf="want-to-read" />
      <BookCardClean book={fourLineTitle} currentShelf="read" />
      <BookCardClean book={unratedBook} />
      <BookCardClean book={hugeCountBook} currentShelf="did-not-finish" priority />
      <BookCardClean book={unreachableCoverBook} />
      <BookCardClean
        book={rejectingWriteBook}
        currentShelf={rejectShelf}
        onShelfChange={rejectShelfChange}
      />
    </div>

    <p class="font-mono text-[11px] text-stone-500 dark:text-stone-400" data-numeric>
      shelf updates committed: <span data-shelf-updates>{shelfUpdateCount}</span>
    </p>
  </section>

  <section class="space-y-4" data-section="shelf-selector">
    <h2 class="font-serif text-2xl text-stone-900 dark:text-stone-50">ShelfSelector (standalone)</h2>

    <div class="max-w-sm">
      <ShelfSelector
        bookId="standalone-selector"
        bookTitle="The Quiet Cartography of Small Towns"
        currentStatus={firstShelf}
        onSelect={assignShelf}
      />
    </div>

    <div class="max-w-sm">
      <ShelfSelector bookId="standalone-empty" bookTitle="Unrated Manuscript" />
    </div>
  </section>

  <section class="space-y-4" data-section="progress-widget">
    <h2 class="font-serif text-2xl text-stone-900 dark:text-stone-50">ReadingProgressWidget</h2>

    <div class="grid gap-4 md:grid-cols-2">
      <div data-progress="interactive">
        <ReadingProgressWidget
          bookId="progress-interactive"
          bookTitle="The Quiet Cartography of Small Towns"
          pageCount={601}
          bind:currentPage={progressPage}
          onProgressChange={saveProgress}
          onComplete={completeProgress}
        />
        <p class="mt-2 font-mono text-[11px] text-stone-500 dark:text-stone-400" data-numeric>
          commits: <span data-progress-commits>{progressCommitCount}</span> · completions:
          <span data-progress-completions>{completionCount}</span>
        </p>
      </div>

      <div data-progress="rejecting">
        <ReadingProgressWidget
          bookId="progress-rejecting"
          bookTitle="Rejected Writes"
          pageCount={320}
          bind:currentPage={strictPage}
          onProgressChange={strictSave}
        />
      </div>

      <div data-progress="unavailable">
        <ReadingProgressWidget bookId="progress-unavailable" pageCount={0} currentPage={0} />
      </div>

      <div data-progress="small">
        <ReadingProgressWidget
          bookId="progress-small"
          bookTitle="Salt"
          pageCount={48}
          currentPage={12}
        />
      </div>
    </div>
  </section>

  <section class="space-y-4" data-section="spoiler-guard">
    <h2 class="font-serif text-2xl text-stone-900 dark:text-stone-50">SpoilerGuard</h2>

    <div class="grid gap-4 md:grid-cols-2">
      <div data-spoiler="masked">
        <SpoilerGuard containsSpoilers>
          <p class="mb-2 text-sm leading-relaxed text-stone-700 dark:text-stone-200">
            {longReview[0]}
          </p>
          <p class="mb-2 text-sm leading-relaxed text-stone-700 dark:text-stone-200">
            {longReview[1]}
          </p>
          <a href="/dev/molecules" class="text-sm font-semibold text-primary-700 underline dark:text-primary-300">
            Nested link inside the spoiler block
          </a>
        </SpoilerGuard>
      </div>

      <div data-spoiler="clean">
        <SpoilerGuard containsSpoilers={false}>
          <p class="text-sm leading-relaxed text-stone-700 dark:text-stone-200">
            A spoiler-free review: the prose is precise, the pacing deliberate, and the final
            chapter lands without a single cheap trick.
          </p>
        </SpoilerGuard>
      </div>
    </div>
  </section>

  <section class="space-y-4" data-section="rating-distribution">
    <h2 class="font-serif text-2xl text-stone-900 dark:text-stone-50">RatingDistributionBar</h2>

    <div class="grid gap-6 md:grid-cols-3">
      <div class="rounded-[var(--radius-card)] border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900" data-distribution="typical">
        <RatingDistributionBar {distribution} title="Typical spread" />
      </div>

      <div class="rounded-[var(--radius-card)] border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900" data-distribution="skewed">
        <RatingDistributionBar distribution={skewedDistribution} size="sm" title="Polarising book" />
      </div>

      <div class="rounded-[var(--radius-card)] border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900" data-distribution="empty">
        <RatingDistributionBar distribution={emptyDistribution} title="No ratings" />
      </div>
    </div>
  </section>
</div>
