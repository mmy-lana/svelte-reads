import { describe, expect, it } from 'vitest';
import {
  countLabel,
  formatCompactNumber,
  formatDate,
  formatDateTime,
  formatNumber,
  formatPageCount,
  formatPercentage,
  formatRelativeDate,
  parseTimestamp,
  truncate
} from '$lib/utils/format';

const NOW = Date.parse('2025-02-14T09:30:00.000Z');

describe('timestamp parsing', () => {
  it('rejects empty and malformed values', () => {
    expect(parseTimestamp('')).toBeNull();
    expect(parseTimestamp(null)).toBeNull();
    expect(parseTimestamp('not-a-date')).toBeNull();
    expect(parseTimestamp('2025-02-14T09:30:00.000Z')?.toISOString()).toBe(
      '2025-02-14T09:30:00.000Z'
    );
  });
});

describe('absolute formats', () => {
  it('renders locale dates and falls back on bad input', () => {
    expect(formatDate('1952-09-19')).toBe(new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    }).format(new Date('1952-09-19')));
    expect(formatDate('')).toBe('Date unknown');
    expect(formatDateTime(null)).toBe('Never');
  });
});

describe('relative formats', () => {
  it('uses the largest sensible unit', () => {
    expect(formatRelativeDate('2025-02-14T09:29:40.000Z', NOW)).toBe('just now');
    expect(formatRelativeDate('2025-02-14T09:20:00.000Z', NOW)).toBe('10 minutes ago');
    expect(formatRelativeDate('2025-02-14T06:30:00.000Z', NOW)).toBe('3 hours ago');
    expect(formatRelativeDate('2025-02-11T09:30:00.000Z', NOW)).toBe('3 days ago');
    expect(formatRelativeDate('2025-01-14T09:30:00.000Z', NOW)).toBe('last month');
    expect(formatRelativeDate('2024-02-14T09:30:00.000Z', NOW)).toBe('last year');
  });

  it('renders future timestamps without negative text', () => {
    // `numeric: 'auto'` yields idiomatic phrases for ±1 units.
    expect(formatRelativeDate('2025-02-21T09:30:00.000Z', NOW)).toBe('next week');
    expect(formatRelativeDate('2025-02-18T09:30:00.000Z', NOW)).toBe('in 4 days');
    expect(formatRelativeDate('nonsense', NOW)).toBe('Date unknown');
  });
});

describe('numbers', () => {
  it('keeps small counts exact and compacts large ones', () => {
    expect(formatNumber(1234)).toBe(new Intl.NumberFormat(undefined).format(1234));
    expect(formatCompactNumber(1204)).toBe(new Intl.NumberFormat(undefined).format(1204));
    expect(formatCompactNumber(12_500)).toBe(
      new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(
        12_500
      )
    );
    expect(formatCompactNumber(Number.NaN)).toBe('0');
  });

  it('pluralises count phrases with numerals', () => {
    expect(countLabel(1, 'review')).toBe('1 review');
    expect(countLabel(4, 'review')).toBe('4 reviews');
    expect(countLabel(1, 'page', 'pages')).toBe('1 page');
  });

  it('formats page counts and percentages defensively', () => {
    expect(formatPageCount(601)).toBe('601 pages');
    expect(formatPageCount(1)).toBe('1 page');
    expect(formatPageCount(0)).toBe('Page count unknown');
    expect(formatPercentage(62.4)).toBe('62%');
    expect(formatPercentage(140)).toBe('100%');
    expect(formatPercentage(Number.NaN)).toBe('0%');
  });
});

describe('truncate', () => {
  it('returns short text untouched', () => {
    expect(truncate('A short blurb.', 40)).toBe('A short blurb.');
  });

  it('cuts on a word boundary and appends a single-character ellipsis', () => {
    const result = truncate('A very long synopsis that keeps going and going', 20);
    expect(result.endsWith('…')).toBe(true);
    expect(result.includes('...')).toBe(false);
    expect(result.length).toBeLessThanOrEqual(21);
  });
});
