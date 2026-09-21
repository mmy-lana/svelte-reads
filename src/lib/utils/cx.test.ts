import { describe, expect, it } from 'vitest';
import { cx } from '$lib/utils/cx';

describe('cx', () => {
  it('joins truthy class names with a single space', () => {
    expect(cx('a', 'b', 'c')).toBe('a b c');
  });

  it('drops falsy and empty values', () => {
    expect(cx('a', false, null, undefined, '', 'b')).toBe('a b');
  });

  it('returns an empty string when nothing is usable', () => {
    expect(cx(false, null, undefined)).toBe('');
    expect(cx()).toBe('');
  });

  it('preserves caller order so later classes win in the cascade', () => {
    expect(cx('p-2', 'p-4')).toBe('p-2 p-4');
  });
});
