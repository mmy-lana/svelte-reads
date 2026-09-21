/**
 * Firebase environment resolution.
 *
 * Keeping config resolution in a pure module (rather than inlining
 * `import.meta.env` reads inside the client bootstrap) means the same logic can
 * be unit tested with synthetic environments and reused by CLI verification
 * scripts.
 */

/** Local Docker emulator ports. Must stay in sync with `firebase.json`. */
export const FIREBASE_EMULATOR_PORTS = {
  auth: 9099,
  firestore: 8080,
  storage: 9199,
  ui: 4000
} as const;

export const DEFAULT_EMULATOR_HOST = '127.0.0.1';
export const DEFAULT_PROJECT_ID = 'book-review-community-dev';

/** Shape of the Vite environment this module consumes. */
export interface FirebaseEnvSource {
  DEV?: boolean;
  PROD?: boolean;
  VITE_FIREBASE_API_KEY?: string;
  VITE_FIREBASE_AUTH_DOMAIN?: string;
  VITE_FIREBASE_PROJECT_ID?: string;
  VITE_FIREBASE_STORAGE_BUCKET?: string;
  VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  VITE_FIREBASE_APP_ID?: string;
  VITE_FIREBASE_MEASUREMENT_ID?: string;
  VITE_FIREBASE_USE_EMULATOR?: string;
  VITE_FIREBASE_EMULATOR_HOST?: string;
}

export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId?: string;
}

export interface EmulatorConnectionConfig {
  /** Whether the client should bind to the local Docker emulator suite. */
  enabled: boolean;
  host: string;
  ports: typeof FIREBASE_EMULATOR_PORTS;
  authUrl: string;
  firestoreOrigin: string;
  storageOrigin: string;
  uiUrl: string;
}

/** Treats empty and whitespace-only environment values as absent. */
function readEnvValue(value: string | undefined, fallback: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed.length > 0 ? trimmed : fallback;
}

export function resolveFirebaseWebConfig(env: FirebaseEnvSource): FirebaseWebConfig {
  const projectId = readEnvValue(env.VITE_FIREBASE_PROJECT_ID, DEFAULT_PROJECT_ID);

  const config: FirebaseWebConfig = {
    apiKey: readEnvValue(env.VITE_FIREBASE_API_KEY, 'fake-api-key-for-emulator'),
    authDomain: readEnvValue(env.VITE_FIREBASE_AUTH_DOMAIN, `${projectId}.firebaseapp.com`),
    projectId,
    storageBucket: readEnvValue(env.VITE_FIREBASE_STORAGE_BUCKET, `${projectId}.appspot.com`),
    messagingSenderId: readEnvValue(env.VITE_FIREBASE_MESSAGING_SENDER_ID, '1234567890'),
    appId: readEnvValue(env.VITE_FIREBASE_APP_ID, '1:1234567890:web:abcdef')
  };

  const measurementId = readEnvValue(env.VITE_FIREBASE_MEASUREMENT_ID, '');
  if (measurementId.length > 0) {
    config.measurementId = measurementId;
  }

  return config;
}

/**
 * Emulator routing decision.
 *
 * Precedence: an explicit `VITE_FIREBASE_USE_EMULATOR` value always wins so a
 * developer can opt out of the emulator during `vite dev`. Otherwise the
 * emulator is used in development and never in a production build.
 */
export function resolveEmulatorConfig(env: FirebaseEnvSource): EmulatorConnectionConfig {
  const flag = readEnvValue(env.VITE_FIREBASE_USE_EMULATOR, '').toLowerCase();
  const enabled = flag === 'true' ? true : flag === 'false' ? false : env.DEV === true;
  const host = readEnvValue(env.VITE_FIREBASE_EMULATOR_HOST, DEFAULT_EMULATOR_HOST);

  return {
    enabled,
    host,
    ports: FIREBASE_EMULATOR_PORTS,
    authUrl: `http://${host}:${FIREBASE_EMULATOR_PORTS.auth}`,
    firestoreOrigin: `http://${host}:${FIREBASE_EMULATOR_PORTS.firestore}`,
    storageOrigin: `http://${host}:${FIREBASE_EMULATOR_PORTS.storage}`,
    uiUrl: `http://${host}:${FIREBASE_EMULATOR_PORTS.ui}`
  };
}

const PLACEHOLDER_VALUES = new Set([
  '',
  'fake-api-key-for-emulator',
  '1234567890',
  '1:1234567890:web:abcdef',
  'your-api-key',
  'changeme'
]);

/** Environment keys that must hold real values in a production deployment. */
type FirebaseRequiredEnvKey =
  | 'VITE_FIREBASE_API_KEY'
  | 'VITE_FIREBASE_AUTH_DOMAIN'
  | 'VITE_FIREBASE_PROJECT_ID'
  | 'VITE_FIREBASE_STORAGE_BUCKET'
  | 'VITE_FIREBASE_MESSAGING_SENDER_ID'
  | 'VITE_FIREBASE_APP_ID';

/**
 * Reports configuration problems that would silently break a production build.
 * Returns an empty array when the environment is production-ready.
 */
export function inspectFirebaseConfig(env: FirebaseEnvSource): string[] {
  const issues: string[] = [];
  const usingEmulator = resolveEmulatorConfig(env).enabled;

  if (usingEmulator) {
    return issues;
  }

  const required: readonly FirebaseRequiredEnvKey[] = [
    'VITE_FIREBASE_API_KEY',
    'VITE_FIREBASE_AUTH_DOMAIN',
    'VITE_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_STORAGE_BUCKET',
    'VITE_FIREBASE_MESSAGING_SENDER_ID',
    'VITE_FIREBASE_APP_ID'
  ];

  for (const key of required) {
    const value = readEnvValue(env[key], '');
    if (PLACEHOLDER_VALUES.has(value)) {
      issues.push(`${key} is missing or still set to a placeholder value.`);
    }
  }

  return issues;
}

/** Throws when the resolved configuration cannot be used. Used by CLI verification. */
export function assertFirebaseConfig(env: FirebaseEnvSource): void {
  const issues = inspectFirebaseConfig(env);
  if (issues.length > 0) {
    throw new Error(`Invalid Firebase configuration:\n- ${issues.join('\n- ')}`);
  }
}

/**
 * Live environment captured at module load. `import.meta.env` is statically
 * replaced by Vite, so this object is safe in both SSR and the browser bundle;
 * outside Vite (Node CLI scripts) it degrades to an empty environment.
 */
const runtimeEnv: FirebaseEnvSource = (import.meta.env as FirebaseEnvSource | undefined) ?? {};

export const firebaseWebConfig: FirebaseWebConfig = resolveFirebaseWebConfig(runtimeEnv);
export const firebaseEmulatorConfig: EmulatorConnectionConfig = resolveEmulatorConfig(runtimeEnv);
export const firebaseConfigIssues: string[] = inspectFirebaseConfig(runtimeEnv);
