import { onAuthStateChanged, type User as FirebaseUser, signOut as fbSignOut } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from '$lib/firebase/client';
import type { UserProfile } from '$lib/types/domain';

class AuthStore {
  user = $state<FirebaseUser | null>(null);
  profile = $state<UserProfile | null>(null);
  loading = $state<boolean>(true);
  initialized = $state<boolean>(false);

  constructor() {
    if (typeof window !== 'undefined') {
      onAuthStateChanged(auth, async (fbUser) => {
        this.user = fbUser;
        if (fbUser) {
          await this.loadUserProfile(fbUser.uid);
        } else {
          this.profile = null;
        }
        this.loading = false;
        this.initialized = true;
      });
    }
  }

  async loadUserProfile(uid: string) {
    try {
      const userRef = doc(db, 'users', uid);
      const snap = await getDoc(userRef);
      if (snap.exists()) {
        this.profile = snap.data() as UserProfile;
      } else if (this.user) {
        const newProfile: UserProfile = {
          uid: this.user.uid,
          email: this.user.email || '',
          displayName: this.user.displayName || 'Reader',
          handle: `user_${this.user.uid.slice(0, 7)}`,
          avatarUrl: this.user.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${this.user.displayName || 'Reader'}`,
          bio: '',
          location: '',
          website: '',
          readingGoal: {
            year: new Date().getFullYear(),
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
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        await setDoc(userRef, newProfile);
        this.profile = newProfile;
      }
    } catch (err) {
      console.error('[AuthStore] Failed loading profile:', err);
    }
  }

  async signOut() {
    await fbSignOut(auth);
    this.user = null;
    this.profile = null;
  }
}

export const authState = new AuthStore();
