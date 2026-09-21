import { beforeEach, describe, expect, it } from 'vitest';
import {
  DuplicateReviewError,
  ReviewStore,
  createReviewStore,
  reviewIdFor,
  sortReviews
} from '$lib/state/review.svelte';
import { FakeReviewGateway, createDeferred, firestoreError } from '$lib/testing/fakes';
import { FIXED_NOW, makeBook, makeDraft, makeReview, makeUser } from '$lib/testing/fixtures';

function buildHarness(options: { signedIn?: boolean } = {}): {
  store: ReviewStore;
  gateway: FakeReviewGateway;
} {
  const gateway = new FakeReviewGateway();
  const store = createReviewStore({
    gateway,
    currentUser: () => (options.signedIn === false ? null : makeUser()),
    currentProfileSummary: () => ({
      displayName: 'Ada Lovelace',
      handle: 'ada_lovelace',
      avatarUrl: 'https://example.test/ada.png'
    }),
    now: () => FIXED_NOW,
    pageSize: 2
  });
  return { store, gateway };
}

describe('ReviewStore writing', () => {
  let harness: ReturnType<typeof buildHarness>;

  beforeEach(() => {
    harness = buildHarness();
  });

  it('publishes the review optimistically and keeps it after the write succeeds', async () => {
    const { store, gateway } = harness;
    const book = makeBook();
    gateway.hold = createDeferred<void>();

    const pending = store.createReview(book, makeDraft());

    const optimistic = store.reviewsFor(book.id);
    expect(optimistic).toHaveLength(1);
    expect(optimistic[0]).toMatchObject({
      id: reviewIdFor('reader-1', book.id),
      rating: 5,
      userHandle: 'ada_lovelace',
      likesCount: 0
    });
    expect(store.hasReviewed(book.id)).toBe(true);
    expect(store.isPending(book.id)).toBe(true);

    gateway.hold.resolve();
    gateway.hold = null;
    const review = await pending;

    expect(review.id).toBe(reviewIdFor('reader-1', book.id));
    expect(gateway.created).toHaveLength(1);
    expect(store.isPending(book.id)).toBe(false);
    expect(store.failureFor(book.id)).toBeNull();
  });

  it('removes the optimistic review when Firestore rejects the write', async () => {
    const { store, gateway } = harness;
    const book = makeBook();
    gateway.hold = createDeferred<void>();

    const pending = store.createReview(book, makeDraft());
    expect(store.reviewsFor(book.id)).toHaveLength(1);

    gateway.hold.reject(firestoreError('unavailable'));
    gateway.hold = null;

    await expect(pending).rejects.toMatchObject({ code: 'unavailable' });

    expect(store.reviewsFor(book.id)).toHaveLength(0);
    expect(store.hasReviewed(book.id)).toBe(false);
    expect(store.failureFor(book.id)).toContain('offline');
  });

  it('refuses a second review for the same book without touching Firestore', async () => {
    const { store, gateway } = harness;
    const book = makeBook();
    store.reviews.set(book.id, [makeReview()]);

    await expect(store.createReview(book, makeDraft())).rejects.toBeInstanceOf(DuplicateReviewError);
    expect(gateway.created).toHaveLength(0);
  });

  it('reports a duplicate detected server-side as a duplicate, not a generic failure', async () => {
    const { store, gateway } = harness;
    const book = makeBook();
    gateway.failNext = new DuplicateReviewError(book.id);

    await expect(store.createReview(book, makeDraft())).rejects.toBeInstanceOf(DuplicateReviewError);
    expect(store.failureFor(book.id)).toContain('already reviewed');
    expect(store.reviewsFor(book.id)).toHaveLength(0);
  });

  it('rolls an edit back when the write fails', async () => {
    const { store, gateway } = harness;
    const book = makeBook();
    const original = makeReview({ title: 'Original title here' });
    store.reviews.set(book.id, [original]);

    gateway.failNext = firestoreError('permission-denied');
    await expect(
      store.updateReview(book.id, original.id, makeDraft({ title: 'Edited title here' }))
    ).rejects.toBeTruthy();

    expect(store.reviewsFor(book.id)[0]?.title).toBe('Original title here');
    expect(store.failureFor(book.id)).toContain('permission');
    expect(gateway.updated).toHaveLength(0);
  });

  it('applies an edit optimistically and persists the same values', async () => {
    const { store, gateway } = harness;
    const book = makeBook();
    const original = makeReview({ title: 'Original title here' });
    store.reviews.set(book.id, [original]);
    gateway.hold = createDeferred<void>();

    const pending = store.updateReview(
      book.id,
      original.id,
      makeDraft({ title: 'Edited title here', rating: 4, containsSpoilers: true })
    );

    expect(store.reviewsFor(book.id)[0]).toMatchObject({
      title: 'Edited title here',
      rating: 4,
      containsSpoilers: true
    });

    gateway.hold.resolve();
    gateway.hold = null;
    await pending;

    expect(gateway.updated[0]).toMatchObject({
      reviewId: original.id,
      title: 'Edited title here',
      rating: 4,
      containsSpoilers: true,
      updatedAt: FIXED_NOW
    });
  });

  it('restores a deleted review when the delete is rejected', async () => {
    const { store, gateway } = harness;
    const book = makeBook();
    const review = makeReview();
    store.reviews.set(book.id, [review]);

    gateway.failNext = firestoreError('unavailable');
    await expect(store.deleteReview(book.id, review.id)).rejects.toBeTruthy();

    expect(store.reviewsFor(book.id)).toHaveLength(1);
    expect(gateway.deleted).toHaveLength(0);

    gateway.failNext = null;
    await store.deleteReview(book.id, review.id);
    expect(store.reviewsFor(book.id)).toHaveLength(0);
    expect(gateway.deleted).toEqual([review.id]);
  });

  it('requires a signed-in reader to write', async () => {
    const { store, gateway } = buildHarness({ signedIn: false });

    await expect(store.createReview(makeBook(), makeDraft())).rejects.toThrow('Sign in');
    expect(gateway.created).toHaveLength(0);
  });
});

describe('ReviewStore helpful votes', () => {
  let harness: ReturnType<typeof buildHarness>;
  /** A review with an existing tally, and the gateway that agrees with it. */
  function seed(harness: ReturnType<typeof buildHarness>, likesCount = 7) {
    const book = makeBook();
    const review = makeReview({ id: 'r-liked', likesCount });
    harness.store.reviews.set(book.id, [review]);
    harness.gateway.voteCounts.set(review.id, likesCount);
    return { book, review };
  }

  beforeEach(() => {
    harness = buildHarness();
  });

  it('counts the vote optimistically, then adopts the committed tally', async () => {
    const { store, gateway } = harness;
    const { book, review } = seed(harness, 7);
    gateway.hold = createDeferred<void>();

    const pending = store.toggleHelpfulVote(book.id, review.id);

    // Optimistic: the tap is answered before the round trip finishes.
    expect(store.reviewsFor(book.id)[0]?.likesCount).toBe(8);
    expect(store.hasVotedHelpful(review.id)).toBe(true);
    expect(store.isVotingHelpful(review.id)).toBe(true);

    gateway.hold.resolve();
    gateway.hold = null;
    await pending;

    expect(gateway.voteToggles).toEqual([review.id]);
    expect(gateway.votes.has(review.id)).toBe(true);
    expect(store.reviewsFor(book.id)[0]?.likesCount).toBe(8);
    expect(store.hasVotedHelpful(review.id)).toBe(true);
    expect(store.isVotingHelpful(review.id)).toBe(false);
    expect(store.helpfulVoteFailureFor(review.id)).toBeNull();
  });

  it('reconciles an optimistic upvote with the transaction that unvotes', async () => {
    const { store, gateway } = harness;
    const { book, review } = seed(harness, 5);
    // The reader already voted in an earlier session, which this client never
    // hydrated: the first click must therefore settle as a *removal*.
    gateway.votes.add(review.id);

    await store.toggleHelpfulVote(book.id, review.id);

    expect(store.reviewsFor(book.id)[0]?.likesCount).toBe(4);
    expect(store.hasVotedHelpful(review.id)).toBe(false);
    expect(gateway.votes.has(review.id)).toBe(false);
  });

  it('never lets the tally drift when the guess and the commit disagree', async () => {
    const { store, gateway } = harness;
    const { book, review } = seed(harness, 5);
    gateway.votes.add(review.id);

    await store.toggleHelpfulVote(book.id, review.id);
    const afterUnvote = store.reviewsFor(book.id)[0]?.likesCount;
    expect(afterUnvote).toBe(4);

    await store.toggleHelpfulVote(book.id, review.id);
    expect(store.reviewsFor(book.id)[0]?.likesCount).toBe(5);
    expect(gateway.voteCounts.get(review.id)).toBe(5);
  });

  it('restores the previous tally when the transaction is rejected', async () => {
    const { store, gateway } = harness;
    const { book, review } = seed(harness, 3);
    gateway.failNext = firestoreError('unavailable');

    await expect(store.toggleHelpfulVote(book.id, review.id)).rejects.toMatchObject({
      code: 'unavailable'
    });

    expect(store.reviewsFor(book.id)[0]?.likesCount).toBe(3);
    expect(store.hasVotedHelpful(review.id)).toBe(false);
    expect(store.isVotingHelpful(review.id)).toBe(false);
    expect(store.helpfulVoteFailureFor(review.id)).toContain('offline');
    // The feed failure channel is untouched: a failed vote must not blank the
    // review list, which renders `failureFor` as a full-page error state.
    expect(store.failureFor(book.id)).toBeNull();
  });

  it('drops a second tap while the first vote is still committing', async () => {
    const { store, gateway } = harness;
    const { book, review } = seed(harness, 2);
    gateway.hold = createDeferred<void>();

    const pending = store.toggleHelpfulVote(book.id, review.id);
    await store.toggleHelpfulVote(book.id, review.id);

    gateway.hold.resolve();
    gateway.hold = null;
    await pending;

    expect(gateway.voteToggles).toEqual([review.id]);
    expect(store.reviewsFor(book.id)[0]?.likesCount).toBe(3);
  });

  it('requires a signed-in reader to vote', async () => {
    const { store, gateway } = buildHarness({ signedIn: false });
    const book = makeBook();
    const review = makeReview({ id: 'r-liked', likesCount: 2 });
    store.reviews.set(book.id, [review]);

    await expect(store.toggleHelpfulVote(book.id, review.id)).rejects.toThrow('Sign in');
    expect(gateway.voteToggles).toHaveLength(0);
    expect(store.reviewsFor(book.id)[0]?.likesCount).toBe(2);
  });

  it('does not lend one reader the next reader’s vote state', async () => {
    const gateway = new FakeReviewGateway();
    let user: ReturnType<typeof makeUser> | null = makeUser();
    const store = createReviewStore({
      gateway,
      currentUser: () => user,
      now: () => FIXED_NOW
    });

    const book = makeBook();
    const review = makeReview({ id: 'r-liked', likesCount: 1 });
    store.reviews.set(book.id, [review]);

    await store.toggleHelpfulVote(book.id, review.id);
    expect(store.hasVotedHelpful(review.id)).toBe(true);

    // The store outlives the session: reviews are public data and nothing clears
    // it on sign-out, so the cached vote must not follow the next reader in.
    user = makeUser({ uid: 'reader-2' });
    expect(store.hasVotedHelpful(review.id)).toBe(false);

    user = null;
    expect(store.hasVotedHelpful(review.id)).toBe(false);
  });
});

describe('ReviewStore feeds', () => {
  it('loads a page, then appends the next one', async () => {
    const { store, gateway } = buildHarness();
    const book = makeBook();

    gateway.pages = [
      {
        items: [makeReview({ id: 'r-1', createdAt: '2025-02-10T00:00:00.000Z' })],
        nextCursorId: 'r-1',
        hasMore: true
      },
      {
        items: [makeReview({ id: 'r-2', createdAt: '2025-02-09T00:00:00.000Z' })],
        nextCursorId: null,
        hasMore: false
      }
    ];

    await store.loadReviews(book.id);
    expect(store.reviewsFor(book.id)).toHaveLength(1);
    expect(store.hasMore(book.id)).toBe(true);

    await store.loadMoreReviews(book.id);
    expect(store.reviewsFor(book.id).map((review) => review.id)).toEqual(['r-1', 'r-2']);
    expect(store.hasMore(book.id)).toBe(false);
    expect(gateway.listQueries[1]?.cursorId).toBe('r-1');
  });

  it('re-sorts the cached feed without another round trip', async () => {
    const { store, gateway } = buildHarness();
    const book = makeBook();

    gateway.pages = [
      {
        items: [
          makeReview({ id: 'r-1', rating: 3, likesCount: 40, createdAt: '2025-02-08T00:00:00.000Z' }),
          makeReview({ id: 'r-2', rating: 5, likesCount: 2, createdAt: '2025-02-10T00:00:00.000Z' }),
          makeReview({ id: 'r-3', rating: 4, likesCount: 12, createdAt: '2025-02-09T00:00:00.000Z' })
        ],
        nextCursorId: null,
        hasMore: false
      }
    ];

    await store.loadReviews(book.id);
    expect(store.reviewsFor(book.id).map((review) => review.id)).toEqual(['r-2', 'r-3', 'r-1']);

    store.reorder(book.id, 'highest-rated');
    expect(store.reviewsFor(book.id).map((review) => review.id)).toEqual(['r-2', 'r-3', 'r-1']);

    store.reorder(book.id, 'most-helpful');
    expect(store.reviewsFor(book.id).map((review) => review.id)).toEqual(['r-1', 'r-3', 'r-2']);
    expect(gateway.listQueries).toHaveLength(1);
  });

  it('reports a feed failure without discarding the cached list', async () => {
    const { store, gateway } = buildHarness();
    const book = makeBook();
    const cached = makeReview();
    store.reviews.set(book.id, [cached]);
    gateway.listFailure = firestoreError('permission-denied');

    await store.loadReviews(book.id, { refresh: true });

    // Reads report the read-oriented copy: nothing was rolled back, so the
    // message asks the reader to sign in again instead of claiming a revert.
    expect(store.failureFor(book.id)).toContain('Sign in again');
    expect(store.reviewsFor(book.id)).toEqual([cached]);
    expect(store.isLoading(book.id)).toBe(false);
  });
});

describe('sortReviews', () => {
  const reviews = [
    makeReview({ id: 'a', rating: 5, likesCount: 1, createdAt: '2025-02-01T00:00:00.000Z' }),
    makeReview({ id: 'b', rating: 3, likesCount: 9, createdAt: '2025-02-03T00:00:00.000Z' }),
    makeReview({ id: 'c', rating: 4, likesCount: 5, createdAt: '2025-02-02T00:00:00.000Z' })
  ];

  it('orders newest first', () => {
    expect(sortReviews(reviews, 'newest').map((review) => review.id)).toEqual(['b', 'c', 'a']);
  });

  it('orders by rating with recency as the tie-break', () => {
    expect(sortReviews(reviews, 'highest-rated').map((review) => review.id)).toEqual([
      'a',
      'c',
      'b'
    ]);
  });

  it('orders by helpfulness', () => {
    expect(sortReviews(reviews, 'most-helpful').map((review) => review.id)).toEqual([
      'b',
      'c',
      'a'
    ]);
  });

  it('does not mutate the input list', () => {
    const original = [...reviews];
    sortReviews(reviews, 'highest-rated');
    expect(reviews).toEqual(original);
  });
});
