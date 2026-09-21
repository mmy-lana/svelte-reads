import { describe, expect, it } from 'vitest';
import {
  AVATAR_GEOMETRY,
  BADGE_GEOMETRY,
  BUTTON_GEOMETRY,
  meetsTouchTarget,
  PROGRESS_GEOMETRY,
  remToPx,
  ROOT_FONT_SIZE_PX,
  SPACING_UNIT_REM,
  STAR_GEOMETRY,
  STAR_TRACK_MIN_HEIGHT_CLASS,
  STAR_TRACK_MIN_HEIGHT_REM,
  starTrackWidthPx,
  starTrackWidthRem,
  TOUCH_TARGET_MIN_HEIGHT_CLASS,
  TOUCH_TARGET_MIN_PX,
  TOUCH_TARGET_MIN_REM,
  TOUCH_TARGET_MIN_WIDTH_CLASS,
  type ControlSize
} from '$lib/design/metrics';

const CONTROL_SIZES: readonly ControlSize[] = ['sm', 'md', 'lg'];

/** Resolves a Tailwind spacing utility such as `h-4` or `min-h-11` back to rem. */
function spacingRemFromClass(classList: string, prefix: string): number | null {
  const match = new RegExp(`(?:^|\\s)${prefix}-([0-9]+(?:\\.[0-9]+)?)(?:\\s|$)`).exec(classList);
  if (!match?.[1]) return null;
  return Number(match[1]) * SPACING_UNIT_REM;
}

describe('touch target contract', () => {
  it('pins the mobile minimum at 44 CSS pixels', () => {
    expect(TOUCH_TARGET_MIN_PX).toBe(44);
    expect(TOUCH_TARGET_MIN_REM).toBe(2.75);
    expect(remToPx(TOUCH_TARGET_MIN_REM)).toBe(TOUCH_TARGET_MIN_PX);
  });

  it('exposes matching min-height and min-width utilities', () => {
    expect(spacingRemFromClass(TOUCH_TARGET_MIN_HEIGHT_CLASS, 'min-h')).toBe(TOUCH_TARGET_MIN_REM);
    expect(spacingRemFromClass(TOUCH_TARGET_MIN_WIDTH_CLASS, 'min-w')).toBe(TOUCH_TARGET_MIN_REM);
  });

  it('scores boxes against the contract', () => {
    expect(meetsTouchTarget(2.75, 2.75)).toBe(true);
    expect(meetsTouchTarget(12, 3)).toBe(true);
    expect(meetsTouchTarget(2.74, 3)).toBe(false);
    expect(meetsTouchTarget(3, 2.74)).toBe(false);
    expect(meetsTouchTarget(0, 0)).toBe(false);
  });

  it('rounds rem conversions to the pixel grid', () => {
    expect(ROOT_FONT_SIZE_PX).toBe(16);
    expect(remToPx(0.375)).toBe(6);
    expect(remToPx(1.125)).toBe(18);
    expect(remToPx(2.75)).toBe(44);
  });
});

describe('star rating geometry', () => {
  it('keeps the composite track at or above 44px in both dimensions', () => {
    expect(remToPx(STAR_TRACK_MIN_HEIGHT_REM)).toBe(TOUCH_TARGET_MIN_PX);
    expect(spacingRemFromClass(STAR_TRACK_MIN_HEIGHT_CLASS, 'min-h')).toBe(STAR_TRACK_MIN_HEIGHT_REM);

    for (const size of CONTROL_SIZES) {
      const heightRem = STAR_TRACK_MIN_HEIGHT_REM;
      const widthRem = starTrackWidthRem(size, 5);
      expect(meetsTouchTarget(widthRem, heightRem), `${size} track is ${widthRem}x${heightRem}rem`).toBe(
        true
      );
      expect(starTrackWidthPx(size, 5)).toBeGreaterThanOrEqual(TOUCH_TARGET_MIN_PX);
    }
  });

  it('keeps glyph and gap classes in sync with their rem values', () => {
    for (const size of CONTROL_SIZES) {
      const geometry = STAR_GEOMETRY[size];
      expect(spacingRemFromClass(geometry.iconClass, 'h'), `${size} icon height`).toBe(
        geometry.iconRem
      );
      expect(spacingRemFromClass(geometry.iconClass, 'w'), `${size} icon width`).toBe(
        geometry.iconRem
      );
      expect(spacingRemFromClass(geometry.gapClass, 'gap'), `${size} gap`).toBe(geometry.gapRem);
    }
  });

  it('grows monotonically with size', () => {
    const widths = CONTROL_SIZES.map((size) => starTrackWidthRem(size, 5));
    expect(widths[0]).toBeLessThan(widths[1]!);
    expect(widths[1]).toBeLessThan(widths[2]!);
  });

  it('scales with the number of stars', () => {
    expect(starTrackWidthRem('md', 10)).toBeGreaterThan(starTrackWidthRem('md', 5));
  });
});

describe('button geometry', () => {
  it('never drops below the 44px mobile minimum', () => {
    for (const size of CONTROL_SIZES) {
      const geometry = BUTTON_GEOMETRY[size];
      const parsedMinHeight = spacingRemFromClass(geometry.minHeightClass, 'min-h');

      expect(parsedMinHeight, `${size} min-height class`).not.toBeNull();
      expect(parsedMinHeight!).toBe(geometry.minHeightRem);
      expect(remToPx(geometry.minHeightRem)).toBeGreaterThanOrEqual(TOUCH_TARGET_MIN_PX);
      expect(geometry.paddingClass.length).toBeGreaterThan(0);
      expect(geometry.textClass.length).toBeGreaterThan(0);
    }
  });

  it('only relaxes density behind the pointer-friendly breakpoint', () => {
    const relaxed = BUTTON_GEOMETRY.sm.minHeightClass.split(/\s+/).filter((c) => c.startsWith('sm:'));
    expect(relaxed.length).toBe(1);
    const relaxedRem = spacingRemFromClass(relaxed[0]!.replace('sm:', ''), 'min-h');
    expect(relaxedRem).toBe(2.25);
  });
});

describe('avatar geometry', () => {
  const SIZES = ['xs', 'sm', 'md', 'lg', 'xl'] as const;

  it('maps every size class onto its pixel footprint', () => {
    for (const size of SIZES) {
      const geometry = AVATAR_GEOMETRY[size];
      const widthRem = spacingRemFromClass(geometry.sizeClass, 'w');
      const heightRem = spacingRemFromClass(geometry.sizeClass, 'h');

      expect(widthRem, `${size} width`).not.toBeNull();
      expect(remToPx(widthRem!)).toBe(geometry.px);
      expect(remToPx(heightRem!)).toBe(geometry.px);
      expect(geometry.initialsClass.length).toBeGreaterThan(0);
      expect(geometry.glyphClass.length).toBeGreaterThan(0);
    }
  });

  it('renders in ascending order', () => {
    const pixels = SIZES.map((size) => AVATAR_GEOMETRY[size].px);
    expect([...pixels].sort((a, b) => a - b)).toEqual(pixels);
  });
});

describe('progress and badge geometry', () => {
  it('keeps track heights small and consistent with their classes', () => {
    for (const size of CONTROL_SIZES) {
      const geometry = PROGRESS_GEOMETRY[size];
      expect(spacingRemFromClass(geometry.heightClass, 'h')).toBe(geometry.heightRem);
      expect(geometry.heightRem).toBeLessThan(TOUCH_TARGET_MIN_REM);
    }
  });

  it('documents badges as informational, compact controls', () => {
    expect(Object.keys(BADGE_GEOMETRY)).toEqual(['sm', 'md']);
    for (const key of ['sm', 'md'] as const) {
      expect(BADGE_GEOMETRY[key].paddingClass.length).toBeGreaterThan(0);
      expect(BADGE_GEOMETRY[key].textClass.length).toBeGreaterThan(0);
    }
  });
});
