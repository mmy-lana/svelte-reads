/**
 * Firebase client bootstrap.
 *
 * Initialises the Firebase app exactly once (safe under Vite HMR), wires the
 * three service handles, and — in development or when explicitly requested —
 * binds them to the local Docker emulator suite defined in `firebase.json`.
 */
import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';
import { connectStorageEmulator, getStorage, type FirebaseStorage } from 'firebase/storage';
import {
  firebaseConfigIssues,
  firebaseEmulatorConfig,
  firebaseWebConfig,
  type EmulatorConnectionConfig
} from '$lib/firebase/config';

declare global {
  /** Survives Vite HMR module re-evaluation so emulators are never bound twice. */
  // eslint-disable-next-line no-var
  var __svelteReadsEmulatorApps: WeakSet<FirebaseApp> | undefined;
}

export const app: FirebaseApp =
  getApps().length === 0 ? initializeApp(firebaseWebConfig) : getApp();

export const auth: Auth = getAuth(app);
export const db: Firestore = getFirestore(app);
export const storage: FirebaseStorage = getStorage(app);

export interface EmulatorConnectionStatus {
  enabled: boolean;
  connected: boolean;
  host: string;
  ports: EmulatorConnectionConfig['ports'];
  /** Human readable explanation used by the dev-only status surface. */
  detail: string;
}

function emulatorRegistry(): WeakSet<FirebaseApp> {
  globalThis.__svelteReadsEmulatorApps ??= new WeakSet<FirebaseApp>();
  return globalThis.__svelteReadsEmulatorApps;
}

let lastStatus: EmulatorConnectionStatus = {
  enabled: firebaseEmulatorConfig.enabled,
  connected: false,
  host: firebaseEmulatorConfig.host,
  ports: firebaseEmulatorConfig.ports,
  detail: firebaseEmulatorConfig.enabled
    ? 'Emulator connection pending (browser runtime only).'
    : 'Emulator disabled; using the configured Firebase project.'
};

/**
 * Binds Auth, Firestore, and Storage to the local emulator suite.
 *
 * Idempotent: repeated calls (hot reload, multiple component imports) are free
 * because each app instance is registered once. Server-side calls are no-ops —
 * emulator routing is a browser concern.
 */
export function connectToEmulators(config: EmulatorConnectionConfig = firebaseEmulatorConfig): EmulatorConnectionStatus {
  if (!config.enabled) {
    lastStatus = {
      enabled: false,
      connected: false,
      host: config.host,
      ports: config.ports,
      detail: 'Emulator disabled; using the configured Firebase project.'
    };
    return lastStatus;
  }

  if (typeof window === 'undefined') {
    lastStatus = {
      enabled: true,
      connected: false,
      host: config.host,
      ports: config.ports,
      detail: 'Skipped during SSR; the browser client connects on hydration.'
    };
    return lastStatus;
  }

  const registry = emulatorRegistry();
  if (registry.has(app)) {
    lastStatus = {
      enabled: true,
      connected: true,
      host: config.host,
      ports: config.ports,
      detail: `Already connected to ${config.host} (Auth ${config.ports.auth}, Firestore ${config.ports.firestore}, Storage ${config.ports.storage}).`
    };
    return lastStatus;
  }

  try {
    // disableWarnings silences the "insecure auth emulator" banner; the
    // connection is plain HTTP by design and never leaves localhost.
    connectAuthEmulator(auth, config.authUrl, { disableWarnings: true });
    connectFirestoreEmulator(db, config.host, config.ports.firestore);
    connectStorageEmulator(storage, config.host, config.ports.storage);
    registry.add(app);

    lastStatus = {
      enabled: true,
      connected: true,
      host: config.host,
      ports: config.ports,
      detail: `Connected to local Docker emulators on ${config.host}.`
    };
    console.info(
      `[Firebase] Connected to local emulators on http://${config.host} — Auth :${config.ports.auth}, Firestore :${config.ports.firestore}, Storage :${config.ports.storage}, UI :${config.ports.ui}`
    );
  } catch (error) {
    lastStatus = {
      enabled: true,
      connected: false,
      host: config.host,
      ports: config.ports,
      detail: `Failed to bind emulators: ${error instanceof Error ? error.message : String(error)}`
    };
    console.error('[Firebase] Emulator connection failed:', error);
  }

  return lastStatus;
}

/** Current emulator wiring state, without attempting a new connection. */
export function getEmulatorConnectionStatus(): EmulatorConnectionStatus {
  if (lastStatus.connected && !emulatorRegistry().has(app)) {
    return { ...lastStatus, connected: false, detail: 'Emulator handles were reset by HMR.' };
  }
  return lastStatus;
}

/** Emulator endpoints resolved from the environment, for health checks and UI. */
export function getEmulatorEndpoints(): EmulatorConnectionConfig {
  return firebaseEmulatorConfig;
}

/** Configuration problems detected at boot; empty when the environment is valid. */
export function getFirebaseConfigIssues(): string[] {
  return firebaseConfigIssues;
}

connectToEmulators();
