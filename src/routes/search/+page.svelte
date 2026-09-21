<script lang="ts">
  import BookCardClean from '$lib/components/molecules/BookCardClean.svelte';
  import { shelfStore } from '$lib/state/shelf.svelte';
  import type { Book, ShelfStatus } from '$lib/types/domain';

  let searchQuery = $state('');

  const catalog: Book[] = [
    {
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
    },
    {
      id: '9780374602604',
      isbn13: '9780374602604',
      isbn10: '0374602603',
      title: 'Tomorrow, and Tomorrow, and Tomorrow',
      subtitle: '',
      authors: ['Gabrielle Zevin'],
      publisher: 'Knopf',
      publishedDate: '2022-07-05',
      description: 'A modern epic about two friends, often in love, but never lovers, who come together as creative partners in the world of video game design.',
      pageCount: 416,
      genres: ['Contemporary', 'Fiction'],
      coverUrl: 'https://images-na.ssl-images-amazon.com/images/S/compressed.photo.goodreads.com/books/1636978687i/58784475.jpg',
      thumbnailUrl: '',
      language: 'en',
      averageRating: 4.21,
      bayesianRating: 4.19,
      ratingsCount: 420000,
      reviewsCount: 45000,
      ratingDistribution: { 1: 9000, 2: 18000, 3: 65000, 4: 154000, 5: 174000 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: '9780062316097',
      isbn13: '9780062316097',
      isbn10: '0062316095',
      title: 'Sapiens: A Brief History of Humankind',
      subtitle: '',
      authors: ['Yuval Noah Harari'],
      publisher: 'Harper',
      publishedDate: '2015-02-10',
      description: '100,000 years ago, at least six human species inhabited the earth. Today there is just one. Us. Homo sapiens.',
      pageCount: 498,
      genres: ['Nonfiction', 'History'],
      coverUrl: 'https://images-na.ssl-images-amazon.com/images/S/compressed.photo.goodreads.com/books/1700360710i/23692271.jpg',
      thumbnailUrl: '',
      language: 'en',
      averageRating: 4.36,
      bayesianRating: 4.34,
      ratingsCount: 1100000,
      reviewsCount: 65000,
      ratingDistribution: { 1: 22000, 2: 38000, 3: 140000, 4: 410000, 5: 490000 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ];

  const searchResults = $derived(
    searchQuery.trim() === ''
      ? catalog
      : catalog.filter((b) =>
          b.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          b.authors.some((a) => a.toLowerCase().includes(searchQuery.toLowerCase())) ||
          b.genres.some((g) => g.toLowerCase().includes(searchQuery.toLowerCase()))
        )
  );

  async function handleShelfChange(book: Book, status: ShelfStatus) {
    await shelfStore.setStatus(book, status);
  }
</script>

<div class="space-y-6">
  <div class="space-y-1">
    <h1 class="font-serif text-2xl sm:text-3xl font-bold">Search Catalog</h1>
    <p class="text-xs sm:text-sm text-stone-500">Search by title, author, or genre.</p>
  </div>

  <div class="relative w-full">
    <input
      type="search"
      bind:value={searchQuery}
      placeholder="Start typing to search..."
      class="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-white dark:bg-stone-900 border border-stone-300 dark:border-stone-700 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 shadow-xs"
    />
  </div>

  <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
    {#each searchResults as book (book.id)}
      {@const currentShelf = shelfStore.shelfFor(book.id)?.status}
      <BookCardClean
        {book}
        {currentShelf}
        onShelfChange={(status) => handleShelfChange(book, status)}
      />
    {/each}
  </div>
</div>
