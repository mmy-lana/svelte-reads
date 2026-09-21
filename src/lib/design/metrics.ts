/**
 * Design-system geometry contracts.
 *
 * These constants are the machine-readable half of the mobile certification in
 * the specification: every interactive control must expose a target of at least
 * 44x44 CSS pixels on mobile viewports (360px, 390px, 430px). Atoms consume the
 * class strings from these maps, and the unit tests assert that the numeric
 * contract and the Tailwind classes can never drift apart.
 */

/** Minimum interactive target edge, in CSS pixels (Apple HIG / WCAG 2.5.5 sizing). */
export const TOUCH_TARGET_MIN_PX = 44;

/** The same contract expressed in rem, matching Tailwind's `min-h-11`. */
export const TOUCH_TARGET_MIN_REM = 2.75;

/** Tailwind utility that produces a 2.75rem (44px) minimum height. */
export const TOUCH_TARGET_MIN_HEIGHT_CLASS = 'min-h-11';

/** Tailwind utility that produces a 2.75rem (44px) minimum width. */
export const TOUCH_TARGET_MIN_WIDTH_CLASS = 'min-w-11';

/** Browsers resolve rem against the root font size; the design assumes 16px. */
export const ROOT_FONT_SIZE_PX = 16;

/** Tailwind's spacing scale step (0.25rem per unit). */
export const SPACING_UNIT_REM = 0.25;

export type ControlSize = 'sm' | 'md' | 'lg';

export function remToPx(rem: number): number {
  return Math.round(rem * ROOT_FONT_SIZE_PX * 100) / 100;
}

/** True when a rendered box satisfies the mobile touch-target contract. */
export function meetsTouchTarget(widthRem: number, heightRem: number): boolean {
  return widthRem >= TOUCH_TARGET_MIN_REM && heightRem >= TOUCH_TARGET_MIN_REM;
}

export interface StarGeometry {
  /** Star glyph edge, rem. */
  iconRem: number;
  iconClass: string;
  /** Visual gap between glyphs, rem. */
  gapRem: number;
  gapClass: string;
}

export const STAR_GEOMETRY: Record<ControlSize, StarGeometry> = {
  sm: { iconRem: 1, iconClass: 'h-4 w-4', gapRem: 0.125, gapClass: 'gap-0.5' },
  md: { iconRem: 1.5, iconClass: 'h-6 w-6', gapRem: 0.25, gapClass: 'gap-1' },
  lg: { iconRem: 2, iconClass: 'h-8 w-8', gapRem: 0.25, gapClass: 'gap-1' }
};

/**
 * The glyphs form one composite control (an ARIA slider), so the certified
 * interactive box is the track — never the individual glyph zones.
 */
export const STAR_TRACK_MIN_HEIGHT_REM = TOUCH_TARGET_MIN_REM;
export const STAR_TRACK_MIN_HEIGHT_CLASS = TOUCH_TARGET_MIN_HEIGHT_CLASS;

/** Width of the composite star track, rem. */
export function starTrackWidthRem(size: ControlSize, max = 5): number {
  const geometry = STAR_GEOMETRY[size];
  return max * geometry.iconRem + (max - 1) * geometry.gapRem;
}

export function starTrackWidthPx(size: ControlSize, max = 5): number {
  return remToPx(starTrackWidthRem(size, max));
}

export interface ButtonGeometry {
  minHeightRem: number;
  minHeightClass: string;
  paddingClass: string;
  textClass: string;
}

/**
 * Button geometry per size. `sm` keeps the 44px minimum height on mobile and
 * relaxes to compact density at the `sm` breakpoint, where pointer accuracy
 * replaces finger accuracy.
 */
export const BUTTON_GEOMETRY: Record<ControlSize, ButtonGeometry> = {
  sm: {
    minHeightRem: 2.75,
    minHeightClass: 'min-h-11 sm:min-h-9',
    paddingClass: 'px-3',
    textClass: 'text-xs'
  },
  md: {
    minHeightRem: 2.75,
    minHeightClass: 'min-h-11',
    paddingClass: 'px-4',
    textClass: 'text-sm'
  },
  lg: {
    minHeightRem: 3,
    minHeightClass: 'min-h-12',
    paddingClass: 'px-6',
    textClass: 'text-base'
  }
};

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface AvatarGeometry {
  /** Rendered edge in CSS pixels; also emitted as width/height attributes to prevent CLS. */
  px: number;
  sizeClass: string;
  initialsClass: string;
  glyphClass: string;
}

export const AVATAR_GEOMETRY: Record<AvatarSize, AvatarGeometry> = {
  xs: { px: 24, sizeClass: 'h-6 w-6', initialsClass: 'text-[10px]', glyphClass: 'h-3.5 w-3.5' },
  sm: { px: 32, sizeClass: 'h-8 w-8', initialsClass: 'text-xs', glyphClass: 'h-4 w-4' },
  md: { px: 40, sizeClass: 'h-10 w-10', initialsClass: 'text-sm', glyphClass: 'h-5 w-5' },
  lg: { px: 56, sizeClass: 'h-14 w-14', initialsClass: 'text-lg', glyphClass: 'h-7 w-7' },
  xl: { px: 80, sizeClass: 'h-20 w-20', initialsClass: 'text-2xl', glyphClass: 'h-10 w-10' }
};

export interface ProgressGeometry {
  heightRem: number;
  heightClass: string;
}

/** Progress tracks stay perceptually similar while `md` matches the card rhythm. */
export const PROGRESS_GEOMETRY: Record<ControlSize, ProgressGeometry> = {
  sm: { heightRem: 0.375, heightClass: 'h-1.5' },
  md: { heightRem: 0.5, heightClass: 'h-2' },
  lg: { heightRem: 0.75, heightClass: 'h-3' }
};

export interface BadgeGeometry {
  paddingClass: string;
  textClass: string;
}

/** Badges are informational, so they are exempt from the 44px target contract. */
export const BADGE_GEOMETRY: Record<'sm' | 'md', BadgeGeometry> = {
  sm: { paddingClass: 'px-2 py-0.5', textClass: 'text-[11px]' },
  md: { paddingClass: 'px-2.5 py-1', textClass: 'text-xs' }
};
