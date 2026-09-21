import { dev } from '$app/environment';
import { error } from '@sveltejs/kit';

/**
 * The molecule gallery exists to certify Phase 3 compounds at 360px, 390px, and
 * 430px plus the 768px popover breakpoint. Development-only: it 404s in builds.
 */
export function load(): void {
  if (!dev) {
    error(404, 'Not found');
  }
}
