/**
 * Minimal class-name joiner.
 *
 * Atoms accept an optional `class` prop so callers can extend the built-in
 * styling; this helper keeps conditional class composition readable without
 * pulling in a dependency.
 */
export type ClassValue = string | false | null | undefined;

export function cx(...values: ClassValue[]): string {
  return values.filter((value): value is string => typeof value === 'string' && value.length > 0).join(' ');
}
