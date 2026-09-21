import { describe, expect, it } from 'vitest';
import {
  createAuthStore,
  type AuthGateway,
  type AuthUser
} from '$lib/state/auth.svelte';
import { AuthenticationRequiredError } from '$lib/data/errors';
import { FIXED_NOW, makeProfile, makeUser } from '$lib/testing/fixtures';
import type { UserProfile } from '$lib/types/domain';

/** In-memory auth backend: no Firebase app, no browser session. */
class FakeAuthGateway implements AuthGateway {
  observeCalls = 0;
  profile: UserProfile | null = null;
  created: UserProfile[] = [];
  written: Array<{ uid: string; changes: Partial<UserProfile> }> = [];
  signedOut = 0;
  failNext: unknown = null;
  #listener: ((user: AuthUser | null) => void) | null = null;

  observe(listener: (user: AuthUser | null) => void): () => void {
    this.observeCalls += 1;
    this.#listener = listener;
    return () => {
      this.#listener = null;
    };
  }

  /** Simulates an auth state event. */
  emit(user: AuthUser | null): void {
    this.#listener?.(user);
  }

  async readProfile(uid: string): Promise<UserProfile | null> {
    if (this.failNext) throw this.failNext;
    return this.profile && this.profile.uid === uid ? this.profile : null;
  }

  async createProfile(profile: UserProfile): Promise<void> {
    if (this.failNext) throw this.failNext;
    this.created.push(profile);
    this.profile = profile;
  }

  async writeProfile(uid: string, changes: Partial<UserProfile>): Promise<void> {
    if (this.failNext) throw this.failNext;
    this.written.push({ uid, changes });
    if (this.profile) this.profile = { ...this.profile, ...changes };
  }

  async signIn(): Promise<void> {
    if (this.failNext) throw this.failNext;
  }

  async signUp(): Promise<void> {
    if (this.failNext) throw this.failNext;
  }

  async signInWithGoogle(): Promise<void> {
    if (this.failNext) throw this.failNext;
  }

  async sendPasswordReset(): Promise<void> {
    if (this.failNext) throw this.failNext;
  }

  async signOut(): Promise<void> {
    this.signedOut += 1;
  }
}

function buildHarness(): { store: ReturnType<typeof createAuthStore>; gateway: FakeAuthGateway } {
  const gateway = new FakeAuthGateway();
  const store = createAuthStore({
    gateway,
    shouldObserve: () => true,
    currentYear: () => 2025,
    now: () => FIXED_NOW
  });
  return { store, gateway };
}

describe('AuthStore session handling', () => {
  it('bootstraps a profile on the first sign-in', async () => {
    const { store, gateway } = buildHarness();

    const ready = store.init();
    gateway.emit(makeUser());
    await ready;

    expect(store.status).toBe('authenticated');
    expect(store.isAuthenticated).toBe(true);
    expect(gateway.created).toHaveLength(1);
    expect(gateway.created[0]).toMatchObject({
      uid: 'reader-1',
      displayName: 'Ada Lovelace',
      handle: 'ada_lovelace_read',
      avatarUrl: '',
      readingGoal: { year: 2025, targetBooks: 12, completedBooks: 0 },
      stats: { reviewsCount: 0, ratingsCount: 0, booksReadCount: 0, pagesReadTotal: 0 }
    });
    expect(store.profile?.createdAt).toBe(FIXED_NOW);
  });

  it('reuses an existing profile instead of overwriting it', async () => {
    const { store, gateway } = buildHarness();
    gateway.profile = makeProfile({ displayName: 'Existing Reader', handle: 'existing' });

    const ready = store.init();
    gateway.emit(makeUser());
    await ready;

    expect(gateway.created).toHaveLength(0);
    expect(store.profile?.displayName).toBe('Existing Reader');
  });

  it('subscribes exactly once across repeated init calls', async () => {
    const { store, gateway } = buildHarness();

    const first = store.init();
    const second = store.init();
    expect(first).toBe(second);

    gateway.emit(makeUser());
    await first;
    await store.init();

    expect(gateway.observeCalls).toBe(1);
  });

  it('clears the session on sign-out', async () => {
    const { store, gateway } = buildHarness();
    const ready = store.init();
    gateway.emit(makeUser());
    await ready;
    expect(store.profile).not.toBeNull();

    gateway.emit(null);

    expect(store.status).toBe('anonymous');
    expect(store.user).toBeNull();
    expect(store.profile).toBeNull();

    await store.signOut();
    expect(gateway.signedOut).toBe(1);
    expect(store.isAuthenticated).toBe(false);
  });

  it('reports a bootstrap failure as an actionable error state', async () => {
    const { store, gateway } = buildHarness();
    gateway.failNext = Object.assign(new Error('denied'), { code: 'permission-denied' });

    const ready = store.init();
    gateway.emit(makeUser());
    await ready;

    expect(store.status).toBe('error');
    expect(store.error).toContain('permission');
    expect(store.profile).toBeNull();
  });

  it('refuses privileged reads while anonymous', () => {
    const { store } = buildHarness();

    expect(() => store.requireUser('write a review')).toThrow(AuthenticationRequiredError);
    expect(() => store.requireProfile('write a review')).toThrow('Sign in to write a review.');
  });

  it('reports auth action failures with reader-facing copy', async () => {
    const { store, gateway } = buildHarness();
    gateway.failNext = Object.assign(new Error('bad credentials'), { code: 'auth/invalid-credential' });

    await expect(store.signIn('reader@example.test', 'secret')).rejects.toBeTruthy();

    expect(store.error).toBe('We could not sign you in with those details.');
    expect(store.isBusy).toBe(false);
  });
});

describe('AuthStore profile writes', () => {
  it('updates the profile optimistically and adopts the write on success', async () => {
    const { store, gateway } = buildHarness();
    const ready = store.init();
    gateway.emit(makeUser());
    await ready;

    await store.updateProfile({ bio: 'Reads two books at once.' });

    expect(store.profile?.bio).toBe('Reads two books at once.');
    expect(store.profile?.updatedAt).toBe(FIXED_NOW);
    expect(gateway.written[0]).toMatchObject({
      uid: 'reader-1',
      changes: { bio: 'Reads two books at once.', updatedAt: FIXED_NOW }
    });
  });

  it('restores the previous profile when the write is rejected', async () => {
    const { store, gateway } = buildHarness();
    const ready = store.init();
    gateway.emit(makeUser());
    await ready;

    const before = store.profile;
    gateway.failNext = Object.assign(new Error('offline'), { code: 'unavailable' });

    await expect(store.updateProfile({ bio: 'Lost to the network' })).rejects.toBeTruthy();

    expect(store.profile).toEqual(before);
    expect(store.error).toContain('offline');
  });

  it('re-reads the profile on demand', async () => {
    const { store, gateway } = buildHarness();
    const ready = store.init();
    gateway.emit(makeUser());
    await ready;

    gateway.profile = { ...makeProfile(), displayName: 'Changed Elsewhere' };
    await store.refreshProfile();

    expect(store.profile?.displayName).toBe('Changed Elsewhere');
  });
});
