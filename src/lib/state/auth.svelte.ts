/**
 * Authentication and profile bootstrap.
 *
 * The store mirrors Firebase Auth state into Svelte 5 runes and guarantees one
 * thing the SDK does not: a reader always has a Firestore profile document. The
 * first sign-in creates it inside a transaction, so a double sign-in event can
 * never write two profiles or overwrite an existing one.
 *
 * The Firebase surface is hidden behind `AuthGateway` so the store can be unit
 * tested by driving the auth callback directly, without a browser or emulator.
 */
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  updateProfile as firebaseUpdateProfile,
  type User as FirebaseUser
} from 'firebase/auth';
import { doc, getDoc, runTransaction, updateDoc } from 'firebase/firestore';
import { auth, db } from '$lib/firebase/client';
import { USER_COLLECTION } from '$lib/data/shelf-gateway';
import {
  AuthenticationRequiredError,
  DataIntegrityError,
  describeWriteFailure
} from '$lib/data/errors';
import { normalizeHandle, parseUserProfile } from '$lib/validation/schemas';
import type { UserProfile } from '$lib/types/domain';

/** The subset of the Firebase user the app relies on. */
export interface AuthUser {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
}

export type AuthStatus = 'initializing' | 'anonymous' | 'authenticated' | 'error';

export interface AuthGateway {
  /** Subscribes to auth changes; the returned function unsubscribes. */
  observe(listener: (user: AuthUser | null) => void): () => void;
  readProfile(uid: string): Promise<UserProfile | null>;
  /** Creates the profile if and only if it does not exist yet. */
  createProfile(profile: UserProfile): Promise<void>;
  writeProfile(uid: string, changes: Partial<UserProfile>): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string, displayName: string): Promise<void>;
  signInWithGoogle(): Promise<void>;
  sendPasswordReset(email: string): Promise<void>;
  signOut(): Promise<void>;
}

export interface AuthStoreOptions {
  gateway?: AuthGateway;
  /** Injectable clock keeps the reading-goal year deterministic in tests. */
  currentYear?: () => number;
  now?: () => string;
  /**
   * Whether this runtime can hold a session. Sessions are browser-only, so the
   * default reports anonymous state during server rendering; tests opt in.
   */
  shouldObserve?: () => boolean;
}

function mapFirebaseUser(user: FirebaseUser): AuthUser {
  return {
    uid: user.uid,
    email: user.email ?? '',
    displayName: user.displayName ?? '',
    photoURL: user.photoURL ?? ''
  };
}

/** Firestore-backed implementation used by the application. */
export class FirebaseAuthGateway implements AuthGateway {
  observe(listener: (user: AuthUser | null) => void): () => void {
    return onAuthStateChanged(auth, (user) => listener(user ? mapFirebaseUser(user) : null));
  }

  async readProfile(uid: string): Promise<UserProfile | null> {
    const snapshot = await getDoc(doc(db, USER_COLLECTION, uid));
    if (!snapshot.exists()) return null;

    const result = parseUserProfile({ ...snapshot.data(), uid });
    if (!result.success) throw new DataIntegrityError(USER_COLLECTION, uid, result.errors);
    return result.data;
  }

  async createProfile(profile: UserProfile): Promise<void> {
    const profileRef = doc(db, USER_COLLECTION, profile.uid);

    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(profileRef);
      if (!snapshot.exists()) transaction.set(profileRef, profile);
    });
  }

  async writeProfile(uid: string, changes: Partial<UserProfile>): Promise<void> {
    await updateDoc(doc(db, USER_COLLECTION, uid), changes);
  }

  async signIn(email: string, password: string): Promise<void> {
    await signInWithEmailAndPassword(auth, email, password);
  }

  async signUp(email: string, password: string, displayName: string): Promise<void> {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    if (displayName.trim().length > 0) {
      await firebaseUpdateProfile(credential.user, { displayName: displayName.trim() });
    }
  }

  async signInWithGoogle(): Promise<void> {
    await signInWithPopup(auth, new GoogleAuthProvider());
  }

  async sendPasswordReset(email: string): Promise<void> {
    await sendPasswordResetEmail(auth, email);
  }

  async signOut(): Promise<void> {
    await firebaseSignOut(auth);
  }
}

export class AuthStore {
  status = $state<AuthStatus>('initializing');
  user = $state<AuthUser | null>(null);
  profile = $state<UserProfile | null>(null);
  /** Reader-facing message for the most recent failed action. */
  error = $state<string | null>(null);
  /** True while a sign-in, sign-up, or profile write is in flight. */
  isBusy = $state(false);

  #gateway: AuthGateway;
  #currentYear: () => number;
  #now: () => string;
  #shouldObserve: () => boolean;
  #readyPromise: Promise<void> | null = null;
  #resolveReady: (() => void) | null = null;
  #unsubscribe: (() => void) | null = null;

  constructor(options: AuthStoreOptions = {}) {
    this.#gateway = options.gateway ?? new FirebaseAuthGateway();
    this.#currentYear = options.currentYear ?? (() => new Date().getFullYear());
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#shouldObserve =
      options.shouldObserve ?? (() => typeof window !== 'undefined');
  }

  get isAuthenticated(): boolean {
    return this.user !== null;
  }

  get isLoading(): boolean {
    return this.status === 'initializing' || this.isBusy;
  }

  get displayName(): string {
    return this.profile?.displayName ?? this.user?.displayName ?? 'Reader';
  }

  /**
   * Starts observing auth state. Idempotent: the second call returns the same
   * promise, so layout mounts and hot reloads never double-subscribe.
   */
  init(): Promise<void> {
    if (this.#readyPromise) return this.#readyPromise;

    this.#readyPromise = new Promise<void>((resolve) => {
      this.#resolveReady = resolve;
    });

    if (!this.#shouldObserve()) {
      // Server rendering (and any runtime without a session store) reports the
      // anonymous state instead of subscribing to an SDK it cannot persist.
      this.status = 'anonymous';
      this.#resolveReady?.();
      return this.#readyPromise;
    }

    this.#unsubscribe = this.#gateway.observe((user) => {
      void this.#handleAuthChange(user);
    });

    return this.#readyPromise;
  }

  /** Resolves after the first auth event has been applied. */
  whenReady(): Promise<void> {
    return this.#readyPromise ?? this.init();
  }

  /** Stops observing; used by tests and by the rare teardown path. */
  dispose(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }

  /** Returns the signed-in reader or throws a typed, renderable error. */
  requireUser(action = 'continue'): AuthUser {
    if (!this.user) throw new AuthenticationRequiredError(action);
    return this.user;
  }

  /** Returns the loaded profile or throws, so callers never read half a session. */
  requireProfile(action = 'continue'): UserProfile {
    const user = this.requireUser(action);
    if (!this.profile || this.profile.uid !== user.uid) {
      throw new AuthenticationRequiredError(action);
    }
    return this.profile;
  }

  async signIn(email: string, password: string): Promise<void> {
    await this.#runAction(
      () => this.#gateway.signIn(email.trim(), password),
      'We could not sign you in with those details.'
    );
  }

  async signUp(email: string, password: string, displayName: string): Promise<void> {
    await this.#runAction(
      () => this.#gateway.signUp(email.trim(), password, displayName),
      'We could not create that account.'
    );
  }

  async signInWithGoogle(): Promise<void> {
    await this.#runAction(
      () => this.#gateway.signInWithGoogle(),
      'Google sign-in did not complete.'
    );
  }

  async sendPasswordReset(email: string): Promise<void> {
    await this.#runAction(
      () => this.#gateway.sendPasswordReset(email.trim()),
      'We could not send that reset email.'
    );
  }

  async signOut(): Promise<void> {
    await this.#runAction(async () => {
      await this.#gateway.signOut();
      this.user = null;
      this.profile = null;
      this.status = 'anonymous';
    }, 'Signing out failed. Try again.');
  }

  /** Re-reads the profile document, e.g. after a review count changed. */
  async refreshProfile(): Promise<void> {
    if (!this.user) return;
    try {
      const profile = await this.#gateway.readProfile(this.user.uid);
      if (profile) this.profile = profile;
    } catch (error) {
      this.error = describeWriteFailure(error, 'We could not refresh your profile.');
    }
  }

  /**
   * Writes profile changes optimistically and restores the previous document if
   * Firestore rejects the write (offline, permission, or validation failure).
   */
  async updateProfile(changes: Partial<UserProfile>): Promise<void> {
    const user = this.requireUser('update your profile');
    const previous = this.profile;
    const timestamp = this.#now();
    const projected = previous ? { ...previous, ...changes, updatedAt: timestamp } : null;

    if (projected) this.profile = projected;
    this.error = null;
    this.isBusy = true;

    try {
      await this.#gateway.writeProfile(user.uid, { ...changes, updatedAt: timestamp });
    } catch (error) {
      this.profile = previous;
      this.error = describeWriteFailure(error, 'Your profile changes were reverted.');
      throw error;
    } finally {
      this.isBusy = false;
    }
  }

  async #handleAuthChange(user: AuthUser | null): Promise<void> {
    this.user = user;

    if (!user) {
      this.profile = null;
      this.status = 'anonymous';
      this.#resolveReady?.();
      return;
    }

    try {
      this.profile = await this.#ensureProfile(user);
      this.status = 'authenticated';
      this.error = null;
    } catch (error) {
      this.status = 'error';
      this.error = describeWriteFailure(error, 'We could not load your reader profile.');
    } finally {
      this.#resolveReady?.();
    }
  }

  /** Loads the profile, creating it on first sign-in. */
  async #ensureProfile(user: AuthUser): Promise<UserProfile> {
    const existing = await this.#gateway.readProfile(user.uid);
    if (existing) return existing;

    const profile = this.#buildDefaultProfile(user);
    await this.#gateway.createProfile(profile);

    // Re-read so a concurrent writer's version wins over the local guess.
    const stored = await this.#gateway.readProfile(user.uid);
    return stored ?? profile;
  }

  #buildDefaultProfile(user: AuthUser): UserProfile {
    const timestamp = this.#now();
    const source = user.displayName.trim() || user.email.split('@')[0] || 'reader';
    // Handles appear in profile URLs, so they are folded to lower case.
    const base = normalizeHandle(source.toLowerCase()).replace(/^_+|_+$/g, '') || 'reader';
    const handle = `${base.slice(0, 14)}_${user.uid.slice(0, 4)}`.slice(0, 20);

    return {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName.trim() || base,
      handle,
      avatarUrl: user.photoURL,
      bio: '',
      location: '',
      website: '',
      readingGoal: {
        year: this.#currentYear(),
        targetBooks: 12,
        completedBooks: 0
      },
      stats: {
        reviewsCount: 0,
        ratingsCount: 0,
        booksReadCount: 0,
        pagesReadTotal: 0
      },
      preferences: {
        allowSpoilersDefault: false,
        isProfilePrivate: false,
        notifyOnLikes: true,
        notifyOnComments: true
      },
      createdAt: timestamp,
      updatedAt: timestamp
    };
  }

  async #runAction(action: () => Promise<void>, fallbackMessage: string): Promise<void> {
    this.isBusy = true;
    this.error = null;

    try {
      await action();
    } catch (error) {
      this.error = describeWriteFailure(error, fallbackMessage);
      throw error;
    } finally {
      this.isBusy = false;
    }
  }
}

/** Factory used by tests; the app imports the singleton below. */
export function createAuthStore(options: AuthStoreOptions = {}): AuthStore {
  return new AuthStore(options);
}

export const authState = createAuthStore();
