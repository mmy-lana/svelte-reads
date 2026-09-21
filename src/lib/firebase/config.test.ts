import { describe, expect, it } from 'vitest';
import {
  assertFirebaseConfig,
  DEFAULT_EMULATOR_HOST,
  DEFAULT_PROJECT_ID,
  FIREBASE_EMULATOR_PORTS,
  inspectFirebaseConfig,
  resolveEmulatorConfig,
  resolveFirebaseWebConfig,
  type FirebaseEnvSource
} from '$lib/firebase/config';

const productionEnv: FirebaseEnvSource = {
  DEV: false,
  VITE_FIREBASE_API_KEY: 'AIzaSyDeploymentKey',
  VITE_FIREBASE_AUTH_DOMAIN: 'shelves-prod.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'shelves-prod',
  VITE_FIREBASE_STORAGE_BUCKET: 'shelves-prod.appspot.com',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '9876543210',
  VITE_FIREBASE_APP_ID: '1:9876543210:web:0123456789abcdef'
};

describe('resolveFirebaseWebConfig', () => {
  it('falls back to emulator-safe defaults for an empty environment', () => {
    const config = resolveFirebaseWebConfig({});
    expect(config.projectId).toBe(DEFAULT_PROJECT_ID);
    expect(config.apiKey).toBe('fake-api-key-for-emulator');
    expect(config.authDomain).toBe(`${DEFAULT_PROJECT_ID}.firebaseapp.com`);
    expect(config.storageBucket).toBe(`${DEFAULT_PROJECT_ID}.appspot.com`);
    expect(config.measurementId).toBeUndefined();
  });

  it('derives the auth domain and bucket from a custom project id', () => {
    const config = resolveFirebaseWebConfig({ VITE_FIREBASE_PROJECT_ID: 'shelves-dev' });
    expect(config.authDomain).toBe('shelves-dev.firebaseapp.com');
    expect(config.storageBucket).toBe('shelves-dev.appspot.com');
  });

  it('prefers explicit values and ignores blank strings', () => {
    const config = resolveFirebaseWebConfig({
      ...productionEnv,
      VITE_FIREBASE_API_KEY: '   ',
      VITE_FIREBASE_MEASUREMENT_ID: 'G-TEST123'
    });
    expect(config.projectId).toBe('shelves-prod');
    expect(config.apiKey).toBe('fake-api-key-for-emulator');
    expect(config.measurementId).toBe('G-TEST123');
  });
});

describe('resolveEmulatorConfig', () => {
  it('binds the emulator by default during development', () => {
    const config = resolveEmulatorConfig({ DEV: true });
    expect(config.enabled).toBe(true);
    expect(config.host).toBe(DEFAULT_EMULATOR_HOST);
    expect(config.authUrl).toBe(`http://${DEFAULT_EMULATOR_HOST}:9099`);
    expect(config.firestoreOrigin).toBe(`http://${DEFAULT_EMULATOR_HOST}:8080`);
    expect(config.storageOrigin).toBe(`http://${DEFAULT_EMULATOR_HOST}:9199`);
    expect(config.uiUrl).toBe(`http://${DEFAULT_EMULATOR_HOST}:4000`);
  });

  it('never binds the emulator in a production build by default', () => {
    expect(resolveEmulatorConfig({ DEV: false }).enabled).toBe(false);
    expect(resolveEmulatorConfig({}).enabled).toBe(false);
  });

  it('honours an explicit opt-in even in production', () => {
    expect(resolveEmulatorConfig({ DEV: false, VITE_FIREBASE_USE_EMULATOR: 'true' }).enabled).toBe(true);
  });

  it('honours an explicit opt-out during development', () => {
    expect(resolveEmulatorConfig({ DEV: true, VITE_FIREBASE_USE_EMULATOR: 'false' }).enabled).toBe(false);
    expect(resolveEmulatorConfig({ DEV: true, VITE_FIREBASE_USE_EMULATOR: ' FALSE ' }).enabled).toBe(false);
  });

  it('supports a remote emulator host for containerised setups', () => {
    const config = resolveEmulatorConfig({ DEV: true, VITE_FIREBASE_EMULATOR_HOST: 'firebase-emulator' });
    expect(config.host).toBe('firebase-emulator');
    expect(config.firestoreOrigin).toBe('http://firebase-emulator:8080');
  });

  it('keeps ports aligned with firebase.json', () => {
    expect(FIREBASE_EMULATOR_PORTS).toEqual({ auth: 9099, firestore: 8080, storage: 9199, ui: 4000 });
  });
});

describe('inspectFirebaseConfig', () => {
  it('reports no issues while the emulator is in use', () => {
    expect(inspectFirebaseConfig({ DEV: true })).toEqual([]);
    expect(inspectFirebaseConfig({ DEV: true, VITE_FIREBASE_USE_EMULATOR: 'true' })).toEqual([]);
  });

  it('lists every placeholder value in a production environment', () => {
    const issues = inspectFirebaseConfig({ DEV: false });
    expect(issues).toHaveLength(6);
    expect(issues[0]).toContain('VITE_FIREBASE_API_KEY');
    expect(issues.join(' ')).toContain('placeholder');
  });

  it('passes for a fully configured production environment', () => {
    expect(inspectFirebaseConfig(productionEnv)).toEqual([]);
  });

  it('flags partially configured production environments', () => {
    const issues = inspectFirebaseConfig({ ...productionEnv, VITE_FIREBASE_APP_ID: '' });
    expect(issues).toEqual(['VITE_FIREBASE_APP_ID is missing or still set to a placeholder value.']);
  });

  it('throws a readable error when the configuration cannot be used', () => {
    expect(() => assertFirebaseConfig({ DEV: false })).toThrow(/Invalid Firebase configuration/);
    expect(() => assertFirebaseConfig(productionEnv)).not.toThrow();
  });
});
