import { dev } from '$app/environment';
import { error } from '@sveltejs/kit';

/**
 * The atom gallery exists to certify Phase 2 primitives at 360px, 390px, and
 * 430px. It is a development-only surface and 404s in production builds.
 */
export function load(): void {
  if (!dev) {
    error(404, 'Not found');
  }
}
