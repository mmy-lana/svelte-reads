declare global {
  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }

  /** Firebase environment contract consumed by `$lib/firebase/config`. */
  interface ImportMetaEnv {
    readonly VITE_FIREBASE_API_KEY?: string;
    readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
    readonly VITE_FIREBASE_PROJECT_ID?: string;
    readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
    readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
    readonly VITE_FIREBASE_APP_ID?: string;
    readonly VITE_FIREBASE_MEASUREMENT_ID?: string;
    readonly VITE_FIREBASE_USE_EMULATOR?: string;
    readonly VITE_FIREBASE_EMULATOR_HOST?: string;
  }
}

export {};
