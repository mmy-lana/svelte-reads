#!/usr/bin/env node
/**
 * Mobile certification harness for the atomic component layer (Phase 2).
 *
 * The acceptance criteria are measured on a real engine, not asserted from
 * markup: a headless Chrome is driven over the DevTools Protocol at the
 * certified viewports (360 / 390 / 430 / 768 px).
 *
 * Usage (from the repository root):
 *   pnpm dev                    # keep this running in another terminal
 *   pnpm run verify:atoms       # add --url=, --chrome=, or --shots=<dir>
 *
 * Checks performed:
 *   1. every interactive atom exposes a target of at least 44x44 CSS pixels;
 *   2. the gallery never overflows horizontally at any certified width;
 *   3. touch tap, touch drag, mouse click, and keyboard all drive the star control;
 *   4. interacting with the star control never moves its bounding box (no jitter);
 *   5. fractional community averages render as clipped partial star fills;
 *   6. progress bars expose complete ARIA value semantics including edge states;
 *   7. design tokens resolve (paper/ochre/night), typography stacks load, and both
 *      the system and the explicit dark-mode branches switch the canvas.
 */
import {
  TOUCH_BREAKPOINT_PX,
  TOUCH_TARGET_MIN_PX,
  VIEWPORTS,
  captureScreenshot,
  clickPoint,
  createReporter,
  ensureReachable,
  evaluate,
  launchChrome,
  measureInteractivity,
  mouseClick,
  navigate,
  parseArgs,
  pressKey,
  resolveChrome,
  scrollIntoView,
  setViewport,
  sleep,
  touchDrag,
  type CdpSession,
  type Rect
} from './lib/cdp.ts';

const DEFAULT_URL = 'http://127.0.0.1:5173/dev/atoms';
const STAR_MAX = 5;
const GALLERY = '#atom-gallery';

const reporter = createReporter();

interface StarReport {
  valueNow: number;
  valueText: string | null;
  rect: Rect;
  starFills: number[];
}

interface TokenReport {
  bodyFont: string;
  headingFont: string;
  monoFont: string;
  canvas: string;
  primary: string;
  starFill: string;
  glyphTotal: number;
  glyphHeight: number;
  trackWidth: number;
  gapTotal: number;
}

const STAR_EXPRESSION = `(() => {
  const root = document.querySelector('${GALLERY}');
  const el = root && root.querySelector('[role="slider"]');
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  const stars = Array.from(el.querySelectorAll('span[aria-hidden="true"]'));
  return {
    valueNow: Number(el.getAttribute('aria-valuenow')),
    valueText: el.getAttribute('aria-valuetext'),
    rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom },
    starFills: stars.map((star) => {
      const overlay = star.querySelector('span[style]');
      return overlay ? Number.parseFloat(overlay.style.width) || 0 : 0;
    })
  };
})()`;

const TOKEN_EXPRESSION = `(() => {
  const root = document.querySelector('${GALLERY}');
  if (!root) return null;

  const heading = root.querySelector('h1');
  const mono = root.querySelector('[data-numeric]');
  const primaryButton = root.querySelector('button');
  const track = root.querySelector('[role="slider"]');
  const readOnlyTrack = root.querySelector('[role="img"][aria-label^="Rated"]');
  const glyphs = track ? Array.from(track.querySelectorAll('span[aria-hidden="true"]')) : [];
  const filled = readOnlyTrack ? readOnlyTrack.querySelector('span[aria-hidden="true"] span svg') : null;
  const trackRect = track ? track.getBoundingClientRect() : { width: 0, height: 0 };
  const glyphTotal = glyphs.reduce((sum, glyph) => sum + glyph.getBoundingClientRect().width, 0);

  return {
    bodyFont: getComputedStyle(document.body).fontFamily,
    headingFont: heading ? getComputedStyle(heading).fontFamily : '',
    monoFont: mono ? getComputedStyle(mono).fontFamily : '',
    canvas: getComputedStyle(document.body).backgroundColor,
    primary: primaryButton ? getComputedStyle(primaryButton).backgroundColor : '',
    starFill: filled ? getComputedStyle(filled).color : '',
    glyphTotal,
    glyphHeight: glyphs.length > 0 ? glyphs[0].getBoundingClientRect().height : 0,
    trackWidth: trackRect.width,
    gapTotal: Math.max(0, trackRect.width - glyphTotal)
  };
})()`;

const READONLY_EXPRESSION = `(() => {
  const root = document.querySelector('${GALLERY}');
  const el = root && root.querySelector('[role="img"][aria-label^="Rated"]');
  if (!el) return null;
  const stars = Array.from(el.querySelectorAll('span[aria-hidden="true"]'));
  return {
    label: el.getAttribute('aria-label'),
    starFills: stars.map((star) => {
      const overlay = star.querySelector('span[style]');
      return overlay ? Number.parseFloat(overlay.style.width) || 0 : 0;
    })
  };
})()`;

const PROGRESS_EXPRESSION = `(() => {
  const root = document.querySelector('${GALLERY}');
  if (!root) return null;
  const bars = Array.from(root.querySelectorAll('[role="progressbar"]'));
  return {
    valueTexts: bars.map((bar) => bar.getAttribute('aria-valuetext') || ''),
    emptyStates: bars.filter((bar) => Number(bar.getAttribute('aria-valuenow')) === 0).length,
    fullStates: bars.filter(
      (bar) => Number(bar.getAttribute('aria-valuenow')) === Number(bar.getAttribute('aria-valuemax'))
    ).length
  };
})()`;

function starPoint(rect: Rect, star: number, fraction: number): { x: number; y: number } {
  const zone = rect.width / STAR_MAX;
  return { x: rect.left + (star - 1) * zone + zone * fraction, y: rect.top + rect.height / 2 };
}

async function readStar(session: CdpSession): Promise<StarReport> {
  const report = await evaluate<StarReport | null>(session, STAR_EXPRESSION);
  if (!report) throw new Error('Star control not found in the gallery');
  return report;
}

async function readTokens(session: CdpSession): Promise<TokenReport> {
  const report = await evaluate<TokenReport | null>(session, TOKEN_EXPRESSION);
  if (!report) throw new Error('Atom gallery root was not rendered');
  return report;
}

async function verifyGeometry(session: CdpSession, label: string, width: number): Promise<void> {
  const report = await measureInteractivity(session, GALLERY);
  if (!report) throw new Error('Atom gallery root (#atom-gallery) was not rendered');

  reporter.heading(`${label} — ${report.interactiveCount} interactive targets (${width}px viewport)`);

  const enforceContract = width < TOUCH_BREAKPOINT_PX;

  if (report.violations.length === 0) {
    reporter.pass(
      `all ${report.interactiveCount} interactive targets are ≥ ${TOUCH_TARGET_MIN_PX}x${TOUCH_TARGET_MIN_PX}px`
    );
  } else if (enforceContract) {
    for (const violation of report.violations) {
      reporter.fail(
        `${violation.tag}${violation.role ? `[role=${violation.role}]` : ''} "${violation.label}" is ` +
          `${violation.width}x${violation.height}px`
      );
    }
  } else if (report.smallest) {
    reporter.note(
      `desktop density: ${report.violations.length} compact target(s), smallest is ` +
        `"${report.smallest.label}" at ${report.smallest.width}x${report.smallest.height}px`
    );
  }

  reporter.assertEqual('gallery horizontal overflow', report.containerOverflow, 0);

  if (report.documentOverflow > 0) {
    reporter.note(
      `document-wide horizontal overflow of ${report.documentOverflow}px (shell layout, later phase)`
    );
  }

  const counts = await evaluate<{ sliders: number; progress: number }>(
    session,
    `(() => {
      const root = document.querySelector('${GALLERY}');
      return {
        sliders: root.querySelectorAll('[role="slider"]').length,
        progress: root.querySelectorAll('[role="progressbar"]').length
      };
    })()`
  );

  reporter.assertEqual('star controls rendered', counts.sliders, 3);
  reporter.assertEqual('progress bars rendered', counts.progress, 6);
}

async function verifyDesignTokens(session: CdpSession): Promise<void> {
  reporter.heading('design tokens, typography and theme resolution');

  // Headless Chrome reports a dark system preference by default, so both
  // branches are pinned explicitly instead of inherited from the host.
  await setViewport(session, { width: 390, height: 844 }, { colorScheme: 'light' });
  await sleep(250);

  const tokens = await readTokens(session);
  reporter.assertEqual('body uses the sans stack', tokens.bodyFont.includes('Plus Jakarta Sans'), true);
  reporter.assertEqual('headings use the editorial serif', tokens.headingFont.includes('Newsreader'), true);
  reporter.assertEqual('metrics use the mono stack', tokens.monoFont.includes('JetBrains Mono'), true);
  reporter.assertEqual('light canvas resolves to the paper token', tokens.canvas, 'rgb(250, 250, 249)');
  reporter.assertEqual('primary button resolves to the ochre token', tokens.primary, 'rgb(217, 119, 6)');
  reporter.assertEqual('star fill resolves to the primary token', tokens.starFill, 'rgb(245, 158, 11)');
  reporter.assertClose(
    'star glyphs plus gaps fill the track exactly',
    tokens.glyphTotal + tokens.gapTotal,
    tokens.trackWidth,
    1.5
  );
  reporter.assertEqual('star glyph height matches the md icon size', Math.round(tokens.glyphHeight), 24);

  await setViewport(session, { width: 390, height: 844 }, { colorScheme: 'dark' });
  await sleep(250);
  const dark = await readTokens(session);
  reporter.assertEqual('system dark mode switches the canvas token', dark.canvas, 'rgb(12, 10, 9)');
  reporter.assertEqual('star fill brightens in dark mode', dark.starFill, 'rgb(251, 191, 36)');

  await evaluate<boolean>(
    session,
    `(() => { document.documentElement.classList.add('light'); return true; })()`
  );
  await sleep(200);
  reporter.assertEqual(
    'explicit .light class overrides system dark mode',
    (await readTokens(session)).canvas,
    'rgb(250, 250, 249)'
  );

  await evaluate<boolean>(
    session,
    `(() => {
      document.documentElement.classList.remove('light');
      document.documentElement.classList.add('dark');
      return true;
    })()`
  );
  await sleep(200);
  reporter.assertEqual(
    'explicit .dark class forces dark mode',
    (await readTokens(session)).canvas,
    'rgb(12, 10, 9)'
  );

  await evaluate<boolean>(
    session,
    `(() => { document.documentElement.classList.remove('dark'); return true; })()`
  );
  await setViewport(session, { width: 390, height: 844 }, { colorScheme: null });
  await sleep(200);
}

async function verifyInteractions(session: CdpSession): Promise<void> {
  reporter.heading('interaction contract (390px viewport)');

  // The gallery is tall, so the star control must be on screen before synthetic
  // touch and mouse coordinates can land on it.
  await scrollIntoView(session, `${GALLERY} [role="slider"]`);

  const initial = await readStar(session);
  const initialScroll = await evaluate<number>(session, 'window.scrollY');

  reporter.assertEqual('initial aria-valuenow (unrated)', initial.valueNow, 0);
  reporter.assertEqual(
    'initial aria-valuetext',
    initial.valueText,
    `Not rated out of ${STAR_MAX} stars`
  );

  await clickPoint(session, starPoint(initial.rect, 3, 0.75));
  let state = await readStar(session);
  reporter.assertClose('pointer click on star 3 (right half) sets', state.valueNow, 3);

  await clickPoint(session, starPoint(initial.rect, 2, 0.25));
  state = await readStar(session);
  reporter.assertClose('pointer click on star 2 (left half) sets half star', state.valueNow, 1.5);
  reporter.assertEqual('aria-valuetext follows the value', state.valueText, `1.5 out of ${STAR_MAX} stars`);

  await touchDrag(session, starPoint(initial.rect, 1, 0.75), starPoint(initial.rect, 4, 0.75));
  state = await readStar(session);
  reporter.assertClose('touch drag across stars ends at star 4', state.valueNow, 4);

  await mouseClick(session, starPoint(initial.rect, 2, 0.75));
  state = await readStar(session);
  reporter.assertClose('mouse click on star 2 (right half) sets', state.valueNow, 2);

  const afterPointer = await readStar(session);
  reporter.assertClose('track width is stable across pointer input', afterPointer.rect.width, initial.rect.width, 0.5);
  reporter.assertClose('track height is stable across pointer input', afterPointer.rect.height, initial.rect.height, 0.5);
  reporter.assertClose('track x is stable across pointer input', afterPointer.rect.left, initial.rect.left, 0.5);
  reporter.assertClose('track y is stable across pointer input', afterPointer.rect.top, initial.rect.top, 0.5);
  reporter.assertEqual(
    'page scroll position is unchanged by pointer input',
    await evaluate<number>(session, 'window.scrollY'),
    initialScroll
  );

  await evaluate<boolean>(
    session,
    `(() => { document.querySelector('${GALLERY} [role="slider"]').focus(); return true; })()`
  );

  await pressKey(session, 'End', 'End', 35);
  state = await readStar(session);
  reporter.assertClose('End key jumps to the maximum', state.valueNow, STAR_MAX);

  await pressKey(session, 'Home', 'Home', 36);
  state = await readStar(session);
  reporter.assertClose('Home key returns to the minimum', state.valueNow, 0.5);

  await pressKey(session, 'ArrowRight', 'ArrowRight', 39);
  state = await readStar(session);
  reporter.assertClose('ArrowRight increments by half a star', state.valueNow, 1);

  await pressKey(session, '4', 'Digit4', 52);
  state = await readStar(session);
  reporter.assertClose('digit key selects that star', state.valueNow, 4);

  const finalState = await readStar(session);
  reporter.assertClose('track width is stable for the whole session', finalState.rect.width, initial.rect.width, 0.5);
  reporter.assertClose('track height is stable for the whole session', finalState.rect.height, initial.rect.height, 0.5);
  reporter.assertEqual(
    'four whole stars fill completely after selecting 4',
    finalState.starFills.filter((fill) => fill === 100).length,
    4
  );
  reporter.assertEqual(
    'remaining star stays empty',
    finalState.starFills.filter((fill) => fill === 0).length,
    1
  );

  const readOnly = await evaluate<{ label: string; starFills: number[] } | null>(
    session,
    READONLY_EXPRESSION
  );
  if (!readOnly) {
    reporter.fail('read-only fractional star display not found');
  } else {
    reporter.assertEqual('read-only accessible name', readOnly.label, 'Rated 4.4 out of 5 stars');
    reporter.assertTrue(
      'read-only whole stars are fully filled',
      readOnly.starFills.slice(0, 4).every((fill) => fill === 100)
    );
    reporter.assertClose('read-only partial star shows 37% fill', readOnly.starFills[4] ?? -1, 37, 1.5);
  }

  const progress = await evaluate<{
    valueTexts: string[];
    emptyStates: number;
    fullStates: number;
  } | null>(session, PROGRESS_EXPRESSION);

  if (!progress) {
    reporter.fail('progress bars not found');
  } else {
    reporter.assertTrue(
      'every progress bar exposes aria-valuetext',
      progress.valueTexts.every((text) => text.length > 0)
    );
    reporter.assertEqual('zero-percent edge case rendered', progress.emptyStates, 1);
    reporter.assertEqual('complete edge case rendered', progress.fullStates, 1);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2), DEFAULT_URL);
  await ensureReachable(args.url);

  const chromePath = resolveChrome(args.chrome);
  console.log(`Atom certification against ${args.url}`);
  console.log(`Chrome: ${chromePath}`);

  const browser = await launchChrome({ chromePath });

  try {
    for (const viewport of VIEWPORTS) {
      await setViewport(browser.session, viewport, { colorScheme: 'light' });
      await navigate(browser.session, args.url);
      await verifyGeometry(browser.session, viewport.label, viewport.width);

      if (args.shots && viewport.width !== 768) {
        const target = `${args.shots}/atoms-${viewport.width}.png`;
        await captureScreenshot(browser.session, target, viewport.width);
        reporter.note(`screenshot written to ${target}`);
      }

      if (viewport.width === 390) {
        await verifyDesignTokens(browser.session);
        await verifyInteractions(browser.session);
      }
    }
  } finally {
    await browser.close();
  }

  process.exitCode = reporter.summary('✓ Atom certification passed at 360 / 390 / 430 / 768 px');
}

main().catch((error: unknown) => {
  console.error(
    `\n✗ Atom certification could not run: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exitCode = 1;
});
