import { describe, expect, it } from 'vitest';
import { checkEmulatorSuite, EMULATOR_SERVICES, probeEmulatorService } from '$lib/firebase/emulator-health';
import { firebaseEmulatorConfig, resolveEmulatorConfig } from '$lib/firebase/config';

/**
 * Live emulator suite checks.
 *
 * Run with the Docker suite up: `pnpm run emulator:up && pnpm run test:emulator`
 */
const suiteConfig = resolveEmulatorConfig({
  DEV: true,
  VITE_FIREBASE_USE_EMULATOR: 'true',
  VITE_FIREBASE_EMULATOR_HOST: process.env.VITE_FIREBASE_EMULATOR_HOST ?? '127.0.0.1'
});

describe('emulator suite connectivity', () => {
  it('reaches every emulator endpoint defined in firebase.json', async () => {
    const report = await checkEmulatorSuite({ config: suiteConfig, timeoutMs: 5000 });

    expect(report.services).toHaveLength(4);
    expect(report.summary).toContain('responded');
    expect(report.ok, report.summary).toBe(true);

    for (const service of report.services) {
      expect(service.reachable, `${service.label} unreachable at ${service.url}`).toBe(true);
      expect(service.httpStatus).toBeGreaterThanOrEqual(100);
      expect(service.httpStatus).toBeLessThan(600);
      expect(service.latencyMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('serves the documented response for each emulator root path', async () => {
    const report = await checkEmulatorSuite({ config: suiteConfig, timeoutMs: 5000 });
    const statusByService = Object.fromEntries(
      report.services.map((service) => [service.name, service.httpStatus])
    );

    // Auth, Firestore, and the UI hub answer their root path with 200; the Storage
    // emulator only implements the GCS API paths and answers a bare GET with 501.
    expect(statusByService.auth).toBe(200);
    expect(statusByService.firestore).toBe(200);
    expect(statusByService.ui).toBe(200);
    expect(statusByService.storage).toBe(501);
  });

  it('serves the Firestore emulator root with a 200 response and no TLS', async () => {
    const probe = await probeEmulatorService(
      EMULATOR_SERVICES.find((service) => service.name === 'firestore')!,
      suiteConfig.firestoreOrigin,
      { timeoutMs: 5000 }
    );
    expect(probe.reachable).toBe(true);
    expect(probe.httpStatus).toBe(200);
    expect(probe.detail).toContain('HTTP 200');
  });

  it('reports unreachable endpoints with an actionable summary', async () => {
    const offline = resolveEmulatorConfig({
      DEV: true,
      VITE_FIREBASE_EMULATOR_HOST: '127.0.0.1'
    });
    const report = await checkEmulatorSuite({
      config: { ...offline, authUrl: 'http://127.0.0.1:1', firestoreOrigin: 'http://127.0.0.1:1', storageOrigin: 'http://127.0.0.1:1', uiUrl: 'http://127.0.0.1:1' },
      timeoutMs: 1000
    });

    expect(report.ok).toBe(false);
    expect(report.summary).toContain('Unreachable');
    expect(report.summary).toContain('pnpm run emulator:up');
    expect(report.services.every((service) => service.reachable === false)).toBe(true);
  });

  it('resolves the emulator host from the environment contract', () => {
    expect(firebaseEmulatorConfig.ports).toEqual({ auth: 9099, firestore: 8080, storage: 9199, ui: 4000 });
    expect(suiteConfig.enabled).toBe(true);
  });
});
