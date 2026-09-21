import { doc, setDoc, collection, query, where, getDocs, runTransaction, increment } from 'firebase/firestore';
import { db } from '$lib/firebase/client';
import { authState } from '$lib/state/auth.svelte';
import type { UserBookShelf, ShelfStatus, Book, Review, ReviewLike } from '$lib/types/domain';
import { transitionShelfState } from '$lib/utils/shelf-state-machine';
import { updateRatingDistribution, calculateBayesianRating } from '$lib/utils/ratings';

class ShelfStore {
  shelvedBooks = $state<Map<string, UserBookShelf>>(new Map());
  inFlightBooks = $state<Set<string>>(new Set());
  isLoading = $state<boolean>(false);

  async loadUserShelves() {
    if (!authState.user) return;
    this.isLoading = true;
    try {
      const q = query(
        collection(db, 'userShelves'),
        where('userId', '==', authState.user.uid)
      );
      const querySnap = await getDocs(q);
      const newMap = new Map<string, UserBookShelf>();
      querySnap.forEach((docSnap) => {
        const data = docSnap.data() as UserBookShelf;
        newMap.set(data.bookId, data);
      });
      this.shelvedBooks = newMap;
    } catch (error) {
      console.error('[ShelfStore] Failed to load shelves:', error);
    } finally {
      this.isLoading = false;
    }
  }

  getShelfForBook(bookId: string): UserBookShelf | undefined {
    return this.shelvedBooks.get(bookId);
  }

  isBookUpdating(bookId: string): boolean {
    return this.inFlightBooks.has(bookId);
  }

  private createDefaultShelfRecord(book: Book, uid: string, status: ShelfStatus): UserBookShelf {
    const shelfId = `${uid}_${book.id}`;
    const now = new Date().toISOString();
    return {
      id: shelfId,
      userId: uid,
      bookId: book.id,
      bookTitle: book.title,
      bookAuthors: book.authors,
      bookCoverUrl: book.coverUrl,
      bookPageCount: book.pageCount,
      status,
      rating: 0,
      progressPages: 0,
      progressPercentage: 0,
      startedAt: status === 'currently-reading' ? now : null,
      finishedAt: status === 'read' ? now : null,
      reReadsCount: 0,
      privateNotes: '',
      createdAt: now,
      updatedAt: now
    };
  }

  async setShelfStatus(book: Book, nextStatus: ShelfStatus): Promise<void> {
    if (!authState.user) throw new Error('Must be authenticated to shelve books');
    if (this.inFlightBooks.has(book.id)) return;

    this.inFlightBooks.add(book.id);
    const shelfId = `${authState.user.uid}_${book.id}`;
    const shelfDocRef = doc(db, 'userShelves', shelfId);
    const existing = this.shelvedBooks.get(book.id);
    const baseRecord = existing ? { ...existing } : this.createDefaultShelfRecord(book, authState.user.uid, nextStatus);

    let updated: UserBookShelf;
    if (nextStatus === 'currently-reading') {
      updated = transitionShelfState(baseRecord, { type: 'MOVE_TO_CURRENTLY_READING' });
    } else if (nextStatus === 'read') {
      updated = transitionShelfState(baseRecord, { type: 'MOVE_TO_READ' });
    } else if (nextStatus === 'did-not-finish') {
      updated = transitionShelfState(baseRecord, { type: 'MOVE_TO_DNF' });
    } else {
      updated = transitionShelfState(baseRecord, { type: 'MOVE_TO_WANT_TO_READ' });
    }

    this.shelvedBooks.set(book.id, updated);

    try {
      await setDoc(shelfDocRef, updated);
    } catch (err) {
      if (existing) {
        this.shelvedBooks.set(book.id, existing);
      } else {
        this.shelvedBooks.delete(book.id);
      }
      throw err;
    } finally {
      this.inFlightBooks.delete(book.id);
    }
  }

  async submitRating(book: Book, newRating: number): Promise<void> {
    if (!authState.user) throw new Error('Must be authenticated to rate books');
    if (this.inFlightBooks.has(book.id)) return;

    this.inFlightBooks.add(book.id);
    const shelfId = `${authState.user.uid}_${book.id}`;
    const shelfDocRef = doc(db, 'userShelves', shelfId);
    const bookDocRef = doc(db, 'books', book.id);
    const existing = this.shelvedBooks.get(book.id);
    const oldRating = existing ? existing.rating : null;

    const fullRecord: UserBookShelf = existing
      ? { ...existing, rating: newRating, updatedAt: new Date().toISOString() }
      : { ...this.createDefaultShelfRecord(book, authState.user.uid, 'read'), rating: newRating };

    this.shelvedBooks.set(book.id, fullRecord);

    try {
      await runTransaction(db, async (transaction) => {
        const bookSnap = await transaction.get(bookDocRef);
        if (!bookSnap.exists()) {
          throw new Error('Book not found in catalog');
        }
        const currentBookData = bookSnap.data() as Book;
        const distResult = updateRatingDistribution(
          currentBookData.ratingDistribution,
          oldRating && oldRating > 0 ? oldRating : null,
          newRating
        );

        const newBayesian = calculateBayesianRating(distResult.newCount, distResult.newAverage);

        transaction.update(bookDocRef, {
          ratingDistribution: distResult.distribution,
          averageRating: distResult.newAverage,
          ratingsCount: distResult.newCount,
          bayesianRating: newBayesian,
          updatedAt: new Date().toISOString()
        });

        transaction.set(shelfDocRef, fullRecord);
      });
    } catch (err) {
      if (existing) {
        this.shelvedBooks.set(book.id, existing);
      } else {
        this.shelvedBooks.delete(book.id);
      }
      throw err;
    } finally {
      this.inFlightBooks.delete(book.id);
    }
  }

  async createReview(
    book: Book,
    rating: number,
    title: string,
    content: string,
    containsSpoilers: boolean
  ): Promise<void> {
    if (!authState.user || !authState.profile) throw new Error('Must be authenticated');

    const reviewId = `${authState.user.uid}_${book.id}`;
    const reviewDocRef = doc(db, 'reviews', reviewId);
    const bookDocRef = doc(db, 'books', book.id);
    const userDocRef = doc(db, 'users', authState.user.uid);
    const now = new Date().toISOString();

    const newReview: Review = {
      id: reviewId,
      bookId: book.id,
      bookTitle: book.title,
      bookCoverUrl: book.coverUrl,
      userId: authState.user.uid,
      userDisplayName: authState.profile.displayName,
      userHandle: authState.profile.handle,
      userAvatarUrl: authState.profile.avatarUrl,
      rating,
      title,
      content,
      containsSpoilers,
      likesCount: 0,
      commentsCount: 0,
      tags: [],
      createdAt: now,
      updatedAt: now
    };

    await runTransaction(db, async (transaction) => {
      const existingSnap = await transaction.get(reviewDocRef);
      if (existingSnap.exists()) {
        throw new Error('A review by this user already exists for this book.');
      }
      transaction.set(reviewDocRef, newReview);
      transaction.update(bookDocRef, { reviewsCount: increment(1) });
      transaction.update(userDocRef, { 'stats.reviewsCount': increment(1) });
    });
  }

  async toggleLike(reviewId: string, currentlyLiked: boolean): Promise<void> {
    if (!authState.user) throw new Error('Must be authenticated');

    const likeId = `${reviewId}_${authState.user.uid}`;
    const likeDocRef = doc(db, 'reviewLikes', likeId);
    const reviewDocRef = doc(db, 'reviews', reviewId);

    if (currentlyLiked) {
      await runTransaction(db, async (transaction) => {
        transaction.delete(likeDocRef);
        transaction.update(reviewDocRef, { likesCount: increment(-1) });
      });
    } else {
      const newLike: ReviewLike = {
        id: likeId,
        reviewId,
        userId: authState.user.uid,
        createdAt: new Date().toISOString()
      };
      await runTransaction(db, async (transaction) => {
        transaction.set(likeDocRef, newLike);
        transaction.update(reviewDocRef, { likesCount: increment(1) });
      });
    }
  }
}

export const shelfStore = new ShelfStore();
