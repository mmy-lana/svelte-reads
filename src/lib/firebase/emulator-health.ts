/**
 * Emulator suite health probing.
 *
 * Shared by the browser dev surface and the `emulator:verify` CLI so a broken
 * emulator stack is reported with the exact endpoint that failed. The connection
 * config is injected rather than imported so this module stays runnable in the
 * browser, in SSR, and under plain Node (CLI scripts).
 */
import type { EmulatorConnectionConfig } from '$lib/firebase/config';

export type EmulatorServiceName = 'auth' | 'firestore' | 'storage' | 'ui';

export interface EmulatorServiceProbe {
  name: EmulatorServiceName;
  label: string;
  url: string;
  reachable: boolean;
  httpStatus: number | null;
  latencyMs: number;
  detail: string;
}

export interface EmulatorHealthReport {
  ok: boolean;
  enabled: boolean;
  host: string;
  checkedAt: string;
  services: EmulatorServiceProbe[];
  summary: string;
}

export interface EmulatorServiceDefinition {
  name: EmulatorServiceName;
  label: string;
  resolveUrl: (config: EmulatorConnectionConfig) => string;
}

export const EMULATOR_SERVICES: readonly EmulatorServiceDefinition[] = [
  { name: 'auth', label: 'Authentication', resolveUrl: (config) => config.authUrl },
  { name: 'firestore', label: 'Firestore', resolveUrl: (config) => config.firestoreOrigin },
  { name: 'storage', label: 'Cloud Storage', resolveUrl: (config) => config.storageOrigin },
  { name: 'ui', label: 'Emulator UI', resolveUrl: (config) => config.uiUrl }
];

export interface ProbeOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Probes a single emulator endpoint. Any HTTP response counts as reachable. */
export async function probeEmulatorService(
  definition: EmulatorServiceDefinition,
  url: string,
  options: ProbeOptions = {}
): Promise<EmulatorServiceProbe> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 3000;
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const base = {
    name: definition.name,
    label: definition.label,
    url,
    latencyMs: 0
  };

  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    const latencyMs = Date.now() - startedAt;
    return {
      ...base,
      latencyMs,
      reachable: true,
      httpStatus: response.status,
      detail: `HTTP ${response.status} in ${latencyMs}ms`
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const reason = error instanceof Error ? error.message : String(error);
    return {
      ...base,
      latencyMs,
      reachable: false,
      httpStatus: null,
      detail: `Unreachable: ${reason}`
    };
  } finally {
    clearTimeout(timer);
  }
}

export interface SuiteCheckOptions extends ProbeOptions {
  config: EmulatorConnectionConfig;
}

/** Probes every emulator service and summarises the suite state. */
export async function checkEmulatorSuite(options: SuiteCheckOptions): Promise<EmulatorHealthReport> {
  const { config, ...probeOptions } = options;
  const services = await Promise.all(
    EMULATOR_SERVICES.map((definition) =>
      probeEmulatorService(definition, definition.resolveUrl(config), probeOptions)
    )
  );

  const unreachable = services.filter((service) => !service.reachable);
  const ok = unreachable.length === 0;

  return {
    ok,
    enabled: config.enabled,
    host: config.host,
    checkedAt: new Date().toISOString(),
    services,
    summary: ok
      ? `All ${services.length} emulator endpoints responded on ${config.host}.`
      : `Unreachable: ${unreachable.map((service) => `${service.label} (${service.url})`).join(', ')}. Start the suite with "pnpm run emulator:up".`
  };
}
