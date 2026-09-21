/**
 * Presentation formatters.
 *
 * Every number and date that reaches the UI goes through `Intl`, so the app
 * follows the reader's locale instead of hardcoded patterns. Relative dates take
 * an explicit `now` so callers can render deterministically (tests and the
 * certification harness) and so server/client renders agree.
 */

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric'
});

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit'
});

const relativeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

const compactNumberFormatter = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1
});

const plainNumberFormatter = new Intl.NumberFormat(undefined);

const RELATIVE_UNITS: readonly { unit: Intl.RelativeTimeFormatUnit; seconds: number }[] = [
  { unit: 'year', seconds: 31_536_000 },
  { unit: 'month', seconds: 2_592_000 },
  { unit: 'week', seconds: 604_800 },
  { unit: 'day', seconds: 86_400 },
  { unit: 'hour', seconds: 3_600 },
  { unit: 'minute', seconds: 60 }
];

/** Parses an ISO timestamp, returning null for empty or malformed input. */
export function parseTimestamp(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** `19 Sep 1952`; unknown or malformed timestamps degrade gracefully. */
export function formatDate(value: string | null | undefined, fallback = 'Date unknown'): string {
  const date = parseTimestamp(value);
  return date ? dateFormatter.format(date) : fallback;
}

/** `19 Sep 1952, 09:30` for audit-style timestamps. */
export function formatDateTime(value: string | null | undefined, fallback = 'Never'): string {
  const date = parseTimestamp(value);
  return date ? dateTimeFormatter.format(date) : fallback;
}

/**
 * `3 days ago`, `in 2 months`, or `just now` for sub-minute differences.
 * Future timestamps are rendered as relative too, which keeps clock skew from
 * producing text like `in -1 days`.
 */
export function formatRelativeDate(
  value: string | null | undefined,
  now: number = Date.now(),
  fallback = 'Date unknown'
): string {
  const date = parseTimestamp(value);
  if (!date) return fallback;

  const deltaSeconds = (date.getTime() - now) / 1000;
  if (Math.abs(deltaSeconds) < 60) return 'just now';

  for (const { unit, seconds } of RELATIVE_UNITS) {
    if (Math.abs(deltaSeconds) >= seconds) {
      return relativeFormatter.format(Math.round(deltaSeconds / seconds), unit);
    }
  }

  return relativeFormatter.format(Math.round(deltaSeconds), 'second');
}

/** `1.2K` for dense stat rows. */
export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return Math.abs(value) >= 10_000
    ? compactNumberFormatter.format(value)
    : plainNumberFormatter.format(Math.round(value));
}

/** `1,204` for exact counters that readers may want to verify. */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return plainNumberFormatter.format(Math.round(value));
}

/** `412 pages`, `1 page`, or `Page count unknown` when the catalog lacks one. */
export function formatPageCount(pageCount: number): string {
  if (!Number.isFinite(pageCount) || pageCount <= 0) return 'Page count unknown';
  return `${formatNumber(pageCount)} ${pageCount === 1 ? 'page' : 'pages'}`;
}

/** `62%` for progress readouts. */
export function formatPercentage(value: number, fractionDigits = 0): string {
  const safe = Number.isFinite(value) ? Math.min(Math.max(value, 0), 100) : 0;
  return `${safe.toFixed(fractionDigits)}%`;
}

/** Trims a long synopsis to a sentence-safe excerpt ending in an ellipsis. */
export function truncate(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  const clipped = trimmed.slice(0, maxLength);
  const lastSpace = clipped.lastIndexOf(' ');
  return `${(lastSpace > maxLength * 0.6 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}…`;
}

/**
 * Builds a pluralised count phrase: `1 review`, `4 reviews`.
 * The number is always shown as a numeral, per the interface guidelines.
 */
export function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`;
}
