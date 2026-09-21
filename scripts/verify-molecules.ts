#!/usr/bin/env node
/**
 * Mobile certification harness for the compound molecules (Phase 3).
 *
 * Drives a real headless Chrome over the DevTools Protocol and asserts the
 * Phase 3 acceptance criteria at 360 / 390 / 430 / 768 px:
 *
 *   1. BookCardClean clamps 1–4 line titles to exactly two lines and keeps
 *      sibling cards in a row the same height;
 *   2. card fixtures degrade correctly (missing/broken covers, unrated books,
 *      compact rating counts);
 *   3. ShelfSelector is a bottom sheet below 768px and a trigger-anchored
 *      popover at 768px, with Escape, arrow-key navigation, focus restoration,
 *      and an inline error when the write is rejected;
 *   4. ReadingProgressWidget recalculates percentages live, commits through its
 *      callback, fires completion exactly once at the final page, rolls back a
 *      rejected write, and explains the unavailable state;
 *   5. SpoilerGuard keeps masked copy out of the accessibility tree and out of
 *      the tab order, and reveals without moving the page;
 *   6. RatingDistributionBar reports exact counts and percentages, renders the
 *      "<1%" tier honestly, and handles an empty distribution.
 *
 * Usage (from the repository root):
 *   pnpm dev                      # keep this running in another terminal
 *   pnpm run verify:molecules     # add --url=, --chrome=, or --shots=<dir>
 */
import {
  SHEET_BREAKPOINT_PX,
  TOUCH_BREAKPOINT_PX,
  TOUCH_TARGET_MIN_PX,
  VIEWPORTS,
  accessibleNames,
  captureScreenshot,
  clickSelector,
  createReporter,
  ensureReachable,
  evaluate,
  launchChrome,
  measureInteractivity,
  navigate,
  parseArgs,
  pressKey,
  rectOf,
  resolveChrome,
  setViewport,
  sleep,
  type CdpSession,
  type Rect
} from './lib/cdp.ts';

const DEFAULT_URL = 'http://127.0.0.1:5173/dev/molecules';
const GALLERY = '#molecule-gallery';
const SPOILER_SENTENCE = 'middle third';

const reporter = createReporter();

interface CardReport {
  bookId: string;
  top: number;
  height: number;
  titleHeight: number;
  titleLineHeight: number;
  titleLines: number;
  titleClamped: boolean;
  hasCoverImage: boolean;
  ratingText: string;
  countText: string;
  countTitle: string | null;
  hasStarDisplay: boolean;
  shelfLabel: string;
}

const CARD_EXPRESSION = `(() => {
  const cards = Array.from(document.querySelectorAll('[data-book-grid] article'));
  return cards.map((card) => {
    const title = card.querySelector('a.line-clamp-2');
    const titleStyle = title ? getComputedStyle(title) : null;
    const titleRect = title ? title.getBoundingClientRect() : null;
    const cardRect = card.getBoundingClientRect();
    const ratingRow = card.querySelector('.border-t');
    const countNode = ratingRow ? ratingRow.querySelector('[title]') : null;
    const starDisplay = ratingRow ? ratingRow.querySelector('[role="img"]') : null;

    return {
      bookId: card.getAttribute('data-book-id') || '',
      top: cardRect.top,
      height: cardRect.height,
      titleHeight: titleRect ? titleRect.height : 0,
      titleLineHeight: titleStyle ? Number.parseFloat(titleStyle.lineHeight) : 0,
      titleLines: titleRect && titleStyle ? Math.round(titleRect.height / Number.parseFloat(titleStyle.lineHeight)) : 0,
      titleClamped: title ? title.scrollHeight > title.clientHeight + 1 : false,
      hasCoverImage: Boolean(card.querySelector('img')),
      ratingText: ratingRow && !countNode && !starDisplay ? ratingRow.textContent.trim() : '',
      countText: countNode ? countNode.textContent.trim() : '',
      countTitle: countNode ? countNode.getAttribute('title') : null,
      hasStarDisplay: Boolean(starDisplay),
      shelfLabel: (card.querySelector('button[aria-haspopup="listbox"]') || { textContent: '' }).textContent.trim()
    };
  });
})()`;

interface SelectorReport {
  panel: (Rect & { role: string | null }) | null;
  triggerLabel: string;
  activeOptionText: string | null;
  activeIsTrigger: boolean;
  alertText: string | null;
  updateCount: number;
}

const SELECTOR_EXPRESSION = `((scopeSelector) => {
  const scope = document.querySelector(scopeSelector);
  const panel = scope ? scope.querySelector('[role="listbox"]') : document.querySelector('[role="listbox"]');
  const rect = panel ? panel.getBoundingClientRect() : null;
  const trigger = scope ? scope.querySelector('button[aria-haspopup="listbox"]') : null;
  const active = document.activeElement;
  const alertNode = panel ? panel.querySelector('[role="alert"]') : null;
  const counter = document.querySelector('[data-shelf-updates]');

  return {
    panel: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom, role: panel.getAttribute('role') } : null,
    triggerLabel: trigger ? trigger.textContent.trim() : '',
    activeOptionText: active && active.getAttribute('role') === 'option' ? active.textContent.trim() : null,
    activeIsTrigger: Boolean(trigger) && active === trigger,
    alertText: alertNode ? alertNode.textContent.trim() : null,
    updateCount: counter ? Number(counter.textContent) : -1
  };
})`;

async function readSelector(session: CdpSession, scopeSelector: string): Promise<SelectorReport> {
  return evaluate<SelectorReport>(
    session,
    `${SELECTOR_EXPRESSION}(${JSON.stringify(scopeSelector)})`
  );
}

/**
 * Opens a shelf picker and waits out the slide-up animation, so the panel's
 * geometry is final before anything is measured or clicked.
 */
async function openSelector(session: CdpSession, scopeSelector: string): Promise<SelectorReport> {
  await clickSelector(session, `${scopeSelector} button[aria-haspopup="listbox"]`);
  await sleep(400);
  return readSelector(session, scopeSelector);
}

/** Focuses an option by index and activates it the way a keyboard user would. */
async function chooseOption(
  session: CdpSession,
  scopeSelector: string,
  index: number
): Promise<void> {
  const optionSelector = `${scopeSelector} [role="option"]`;
  await evaluate<boolean>(
    session,
    `(() => {
      const options = document.querySelectorAll(${JSON.stringify(optionSelector)});
      const target = options[${index}];
      if (!target) return false;
      target.focus();
      return document.activeElement === target;
    })()`
  );
  await pressKey(session, 'Enter', 'Enter', 13);
  await sleep(300);
}

async function verifyCards(session: CdpSession, viewportWidth: number): Promise<void> {
  const cards = await evaluate<CardReport[] | null>(session, CARD_EXPRESSION);
  if (!cards || cards.length === 0) throw new Error('Book cards were not rendered');

  reporter.heading(`BookCardClean (${viewportWidth}px viewport)`);
  reporter.assertEqual('cards rendered', cards.length, 7);

  const overflowed = cards.filter((card) => card.titleLines > 2);
  reporter.assertTrue(
    'every title renders in at most two lines',
    overflowed.length === 0,
    overflowed.map((card) => `${card.bookId}=${card.titleLines} lines`).join(', ') || 'all ≤ 2'
  );

  const longTitle = cards.find((card) => card.bookId === 'title-3');
  if (!longTitle) {
    reporter.fail('four-line fixture card missing');
  } else {
    reporter.assertEqual('four-line title occupies two lines', longTitle.titleLines, 2);
    reporter.assertTrue('four-line title is clamped by line-clamp', longTitle.titleClamped);
  }

  const shortTitle = cards.find((card) => card.bookId === 'title-1');
  if (!shortTitle) {
    reporter.fail('one-line fixture card missing');
  } else {
    reporter.assertEqual('one-line title occupies one line', shortTitle.titleLines, 1);
    reporter.assertTrue('one-line title is not clamped', shortTitle.titleClamped === false);
  }

  // Cards in the same grid row must stretch to a common height.
  const rows = new Map<number, CardReport[]>();
  for (const card of cards) {
    const key = Math.round(card.top);
    rows.set(key, [...(rows.get(key) ?? []), card]);
  }
  const mismatched = [...rows.values()]
    .filter((row) => row.length > 1)
    .map((row) => {
      const heights = row.map((card) => card.height);
      return Math.max(...heights) - Math.min(...heights);
    })
    .filter((spread) => spread > 1);

  reporter.assertTrue(
    'cards in a row share one height',
    mismatched.length === 0,
    mismatched.length === 0 ? `${rows.size} row(s)` : `row spreads: ${mismatched.join(', ')}px`
  );

  const covered = cards.filter((card) => card.hasCoverImage);
  reporter.assertEqual('cards with usable covers render an image', covered.length, 3);

  const unrated = cards.find((card) => card.bookId === 'title-4');
  if (!unrated) {
    reporter.fail('unrated fixture card missing');
  } else {
    reporter.assertTrue('unrated card shows the empty rating state', unrated.ratingText.includes('No ratings yet'), unrated.ratingText);
    reporter.assertTrue('unrated card renders no star display', unrated.hasStarDisplay === false);
  }

  const hugeCount = cards.find((card) => card.bookId === 'title-5');
  if (!hugeCount) {
    reporter.fail('large-count fixture card missing');
  } else {
    reporter.assertEqual('large rating counts are compacted', hugeCount.countText, '4.1M');
    reporter.assertEqual('exact count stays available in the title', hugeCount.countTitle, '4,123,456 ratings');
  }

  const shelfLabeled = cards.find((card) => card.bookId === 'title-2');
  reporter.assertEqual('shelf status drives the selector label', shelfLabeled?.shelfLabel, 'Want to Read');
}

async function verifySelectorMobile(session: CdpSession, viewportHeight: number, viewportWidth: number): Promise<void> {
  reporter.heading('ShelfSelector · mobile bottom sheet');

  const scope = '[data-section="shelf-selector"] > div:first-of-type';
  let state = await openSelector(session, scope);

  if (!state.panel) {
    reporter.fail('bottom sheet did not open');
    return;
  }

  reporter.assertClose('sheet is pinned to the viewport bottom', state.panel.bottom, viewportHeight, 2);
  reporter.assertClose('sheet spans the viewport width', state.panel.width, viewportWidth, 2);
  reporter.assertEqual('opening focuses the current shelf', state.activeOptionText, 'Currently Reading');

  await pressKey(session, 'Escape', 'Escape', 27);
  state = await readSelector(session, scope);
  reporter.assertTrue('Escape closes the sheet', state.panel === null);
  reporter.assertTrue('focus returns to the trigger', state.activeIsTrigger);

  await openSelector(session, scope);
  await pressKey(session, 'ArrowDown', 'ArrowDown', 40);
  state = await readSelector(session, scope);
  reporter.assertEqual('ArrowDown moves to the next shelf', state.activeOptionText, 'Read');

  await pressKey(session, 'ArrowDown', 'ArrowDown', 40);
  await pressKey(session, 'ArrowUp', 'ArrowUp', 38);
  state = await readSelector(session, scope);
  reporter.assertEqual('ArrowUp returns to the previous shelf', state.activeOptionText, 'Read');

  await pressKey(session, 'Enter', 'Enter', 13);
  await sleep(300);
  state = await readSelector(session, scope);
  reporter.assertTrue('activating an option closes the sheet', state.panel === null);
  reporter.assertEqual('trigger uses the short shelf label', state.triggerLabel, 'Finished');
  reporter.assertEqual('shelf update callback fired once', state.updateCount, 1);
}

async function verifySelectorDesktop(session: CdpSession): Promise<void> {
  reporter.heading('ShelfSelector · desktop popover');

  const scope = '[data-section="shelf-selector"] > div:first-of-type';
  const state = await openSelector(session, scope);
  const trigger = await rectOf(session, `${scope} button[aria-haspopup="listbox"]`);

  if (!state.panel || !trigger) {
    reporter.fail('popover did not open at the desktop breakpoint');
    return;
  }

  reporter.assertTrue(
    'popover opens below its trigger',
    state.panel.top >= trigger.bottom - 2,
    `panel.top=${Math.round(state.panel.top)} trigger.bottom=${Math.round(trigger.bottom)}`
  );
  reporter.assertTrue(
    'popover is narrower than the viewport',
    state.panel.width <= 320,
    `${Math.round(state.panel.width)}px`
  );

  await pressKey(session, 'Escape', 'Escape', 27);
  const closed = await readSelector(session, scope);
  reporter.assertTrue('Escape closes the popover', closed.panel === null);
}

async function verifySelectorFailure(session: CdpSession): Promise<void> {
  reporter.heading('ShelfSelector · rejected write');

  const scope = '[data-book-id="title-7"]';
  const opened = await openSelector(session, scope);
  reporter.assertEqual(
    'rejecting card opens with no shelf selected',
    opened.activeOptionText,
    'Want to Read'
  );

  // Index 1 is "Reading": different from the card's shelf, so the write runs.
  await chooseOption(session, scope, 1);
  const state = await readSelector(session, scope);

  reporter.assertEqual('trigger keeps the previous shelf on rejection', state.triggerLabel, 'Add to Shelf');
  reporter.assertTrue(
    'rejected write surfaces an inline error',
    (state.alertText ?? '').includes('Could not move'),
    state.alertText ?? 'none'
  );
  reporter.assertTrue('panel stays open for a retry', state.panel !== null);

  await pressKey(session, 'Escape', 'Escape', 27);
}

interface ProgressReport {
  state: string;
  pageText: string;
  valueNow: number | null;
  valueText: string | null;
  commits: number;
  completions: number;
  hasRange: boolean;
  alertText: string | null;
  completedCopy: boolean;
}

const PROGRESS_EXPRESSION = `((scopeSelector) => {
  const scope = document.querySelector(scopeSelector);
  if (!scope) return null;
  const root = scope.querySelector('[data-progress-state]');
  const counter = document.querySelector('[data-progress-commits]');
  const completions = document.querySelector('[data-progress-completions]');
  const bar = scope.querySelector('[role="progressbar"]');
  const alertNode = scope.querySelector('[role="alert"]');

  return {
    state: root ? root.getAttribute('data-progress-state') : '',
    pageText: root ? root.textContent.replace(/\\s+/g, ' ').trim() : '',
    valueNow: bar ? Number(bar.getAttribute('aria-valuenow')) : null,
    valueText: bar ? bar.getAttribute('aria-valuetext') : null,
    commits: counter ? Number(counter.textContent) : -1,
    completions: completions ? Number(completions.textContent) : -1,
    hasRange: Boolean(scope.querySelector('input[type="range"]')),
    alertText: alertNode ? alertNode.textContent.trim() : null,
    completedCopy: root ? root.textContent.includes('moving this book to your Read shelf') : false
  };
})`;

async function readProgress(session: CdpSession, scope: string): Promise<ProgressReport> {
  const report = await evaluate<ProgressReport | null>(
    session,
    `${PROGRESS_EXPRESSION}(${JSON.stringify(scope)})`
  );
  if (!report) throw new Error(`Progress widget not found: ${scope}`);
  return report;
}

async function verifyProgress(session: CdpSession): Promise<void> {
  reporter.heading('ReadingProgressWidget');

  const scope = '[data-progress="interactive"]';
  let state = await readProgress(session, scope);

  reporter.assertEqual('starts in the active state', state.state, 'active');
  reporter.assertTrue('reflects the seeded page', state.pageText.includes('120 / 601 pages'), state.pageText);
  reporter.assertTrue(
    'progressbar exposes a human-readable value',
    (state.valueText ?? '').includes('120 of 601 pages'),
    state.valueText ?? 'none'
  );
  reporter.assertEqual('no completions before finishing', state.completions, 0);

  const rangeSelector = `${scope} input[type="range"]`;
  await evaluate<boolean>(
    session,
    `(() => { document.querySelector(${JSON.stringify(rangeSelector)}).focus(); return true; })()`
  );

  await pressKey(session, 'ArrowRight', 'ArrowRight', 39);
  await pressKey(session, 'ArrowRight', 'ArrowRight', 39);
  await sleep(150);
  state = await readProgress(session, scope);
  reporter.assertEqual('page counter follows the slider', state.valueNow, 122);
  reporter.assertTrue('percentage recalculates live', state.pageText.includes('122 / 601 pages'), state.pageText);

  await pressKey(session, 'End', 'End', 35);
  await sleep(300);
  state = await readProgress(session, scope);
  reporter.assertEqual('reaching the last page completes the book', state.state, 'complete');
  reporter.assertEqual('completion callback fired exactly once', state.completions, 1);
  reporter.assertTrue('completion is explained to the reader', state.completedCopy);

  await pressKey(session, 'End', 'End', 35);
  await sleep(200);
  state = await readProgress(session, scope);
  reporter.assertEqual('completion does not fire twice', state.completions, 1);

  await pressKey(session, 'Home', 'Home', 36);
  await sleep(300);
  state = await readProgress(session, scope);
  reporter.assertEqual('returning to page 0 leaves the complete state', state.state, 'active');
  reporter.assertEqual('every commit reached the callback', state.commits, 4);

  const rejecting = '[data-progress="rejecting"]';
  const rejectingRange = `${rejecting} input[type="range"]`;
  await evaluate<boolean>(
    session,
    `(() => { document.querySelector(${JSON.stringify(rejectingRange)}).focus(); return true; })()`
  );
  await pressKey(session, 'End', 'End', 35);
  await sleep(300);
  const rejected = await readProgress(session, rejecting);
  reporter.assertTrue(
    'rejected write surfaces an actionable error',
    (rejected.alertText ?? '').includes('Could not save your progress'),
    rejected.alertText ?? 'none'
  );
  reporter.assertEqual('rejected write rolls the control back', rejected.valueNow, 40);

  const unavailable = await readProgress(session, '[data-progress="unavailable"]');
  reporter.assertEqual('editions without a page count report unavailable', unavailable.state, 'unavailable');
  reporter.assertTrue('unavailable state renders no slider', unavailable.hasRange === false);
  reporter.assertTrue(
    'unavailable state explains what to do instead',
    unavailable.pageText.includes('no page count'),
    unavailable.pageText.slice(0, 80)
  );
}

async function spoilerHeight(session: CdpSession, scope: string): Promise<number> {
  const rect = await rectOf(session, scope);
  return rect ? Math.round(rect.height * 100) / 100 : -1;
}

async function verifySpoilerGuard(session: CdpSession): Promise<void> {
  reporter.heading('SpoilerGuard');

  const scope = '[data-spoiler="masked"]';
  const guard = `${scope} [data-spoiler-state]`;

  const maskedNames = await accessibleNames(session);
  reporter.assertTrue(
    'masked copy is absent from the accessibility tree',
    !maskedNames.some((name) => name.includes(SPOILER_SENTENCE)),
    maskedNames.some((name) => name.includes(SPOILER_SENTENCE)) ? 'leaked' : 'hidden'
  );

  const flags = await evaluate<{
    state: string;
    ariaHidden: string | null;
    inert: boolean;
    pointerEvents: string;
    linkFound: boolean;
    focusable: boolean;
  }>(
    session,
    `(() => {
      const root = document.querySelector(${JSON.stringify(guard)});
      const wrapper = root.querySelector('[data-spoiler-content]');
      const link = wrapper.querySelector('a');
      if (link) link.focus();
      return {
        state: root.getAttribute('data-spoiler-state'),
        ariaHidden: wrapper.getAttribute('aria-hidden'),
        inert: wrapper.hasAttribute('inert'),
        pointerEvents: getComputedStyle(wrapper).pointerEvents,
        linkFound: Boolean(link),
        focusable: Boolean(link) && document.activeElement === link
      };
    })()`
  );

  reporter.assertEqual('masked block reports its state', flags.state, 'masked');
  reporter.assertEqual('masked copy is aria-hidden', flags.ariaHidden, 'true');
  reporter.assertTrue('masked copy is inert', flags.inert);
  reporter.assertTrue('the harness found the nested link it tests', flags.linkFound);
  reporter.assertEqual('masked copy ignores pointer input', flags.pointerEvents, 'none');
  reporter.assertTrue('nested links cannot take focus while masked', flags.focusable === false);

  const maskedHeight = await spoilerHeight(session, guard);

  await clickSelector(session, `${scope} button`);
  await sleep(250);

  const revealedNames = await accessibleNames(session);
  reporter.assertTrue(
    'revealed copy enters the accessibility tree',
    revealedNames.some((name) => name.includes(SPOILER_SENTENCE))
  );

  const revealed = await evaluate<{ state: string; ariaHidden: string | null; focusable: boolean }>(
    session,
    `(() => {
      const root = document.querySelector(${JSON.stringify(guard)});
      const link = root.querySelector('a');
      if (link) link.focus();
      const wrapper = root.querySelector('[data-spoiler-content]');
      return {
        state: root.getAttribute('data-spoiler-state'),
        ariaHidden: wrapper.hasAttribute('aria-hidden') ? wrapper.getAttribute('aria-hidden') : null,
        focusable: Boolean(link) && document.activeElement === link
      };
    })()`
  );

  reporter.assertEqual('revealed block reports its state', revealed.state, 'revealed');
  reporter.assertEqual('aria-hidden is removed after reveal', revealed.ariaHidden, null);
  const revealedInert = await evaluate<boolean>(
    session,
    `document.querySelector(${JSON.stringify(`${guard} [data-spoiler-content]`)}).hasAttribute('inert')`
  );
  reporter.assertTrue('inert is removed after reveal', revealedInert === false);
  reporter.assertTrue('nested links become focusable after reveal', revealed.focusable);

  const revealedHeight = await spoilerHeight(session, guard);
  reporter.assertClose('revealing does not move the page', revealedHeight, maskedHeight, 1);

  await clickSelector(session, `${scope} button:last-of-type`);
  await sleep(200);
  const remasked = await evaluate<string | null>(
    session,
    `document.querySelector(${JSON.stringify(guard)}).getAttribute('data-spoiler-state')`
  );
  reporter.assertEqual('spoilers can be hidden again', remasked, 'masked');

  const clean = await evaluate<{ state: string; header: number }>(
    session,
    `(() => {
      const root = document.querySelector('[data-spoiler="clean"] [data-spoiler-state]');
      return {
        state: root.getAttribute('data-spoiler-state'),
        header: root.querySelectorAll('button').length
      };
    })()`
  );
  reporter.assertEqual('spoiler-free reviews render unmasked', clean.state, 'clean');
  reporter.assertEqual('spoiler-free reviews show no reveal control', clean.header, 0);
}

interface DistributionReport {
  rows: Array<{ tier: string; count: string; percentage: string; barWidth: number }>;
  caption: string | null;
  emptyCopy: string;
  hasTable: boolean;
}

const DISTRIBUTION_EXPRESSION = `((scopeSelector) => {
  const scope = document.querySelector(scopeSelector);
  if (!scope) return null;
  const rows = Array.from(scope.querySelectorAll('tbody tr')).map((row) => {
    const cells = row.querySelectorAll('td');
    const bar = cells[0] ? cells[0].querySelector('div > div') : null;
    return {
      tier: (row.querySelector('th') || { textContent: '' }).textContent.trim(),
      count: cells[1] ? cells[1].textContent.trim() : '',
      percentage: cells[2] ? cells[2].textContent.trim() : '',
      barWidth: bar ? bar.getBoundingClientRect().width : 0
    };
  });
  const caption = scope.querySelector('caption');

  return {
    rows,
    caption: caption ? caption.textContent.trim() : null,
    emptyCopy: scope.textContent.replace(/\\s+/g, ' ').trim(),
    hasTable: scope.querySelectorAll('table').length > 0
  };
})`;

async function readDistribution(session: CdpSession, scope: string): Promise<DistributionReport> {
  const report = await evaluate<DistributionReport | null>(
    session,
    `${DISTRIBUTION_EXPRESSION}(${JSON.stringify(scope)})`
  );
  if (!report) throw new Error(`Distribution not found: ${scope}`);
  return report;
}

async function verifyDistribution(session: CdpSession): Promise<void> {
  reporter.heading('RatingDistributionBar');

  const typical = await readDistribution(session, '[data-distribution="typical"]');
  reporter.assertEqual('five tiers are rendered', typical.rows.length, 5);
  reporter.assertEqual('caption names the table', typical.caption, 'Typical spread');
  reporter.assertEqual(
    'tiers descend from five stars',
    typical.rows.map((row) => row.tier).join(','),
    '5,4,3,2,1'
  );
  reporter.assertEqual(
    'exact counts are reported',
    typical.rows.map((row) => row.count).join(','),
    '2,418,1,086,214,38,12'
  );
  reporter.assertEqual(
    'percentages are computed from the total',
    typical.rows.map((row) => row.percentage).join(','),
    '64%,29%,6%,1%,<1%'
  );

  const skewed = await readDistribution(session, '[data-distribution="skewed"]');
  reporter.assertEqual('rare tiers report below one percent', skewed.rows[0]?.percentage, '<1%');
  reporter.assertTrue(
    'rare tiers keep a visible bar',
    (skewed.rows[0]?.barWidth ?? 0) >= 1.5,
    `${Math.round(skewed.rows[0]?.barWidth ?? 0)}px`
  );

  const empty = await readDistribution(session, '[data-distribution="empty"]');
  reporter.assertTrue('empty distribution explains itself', empty.emptyCopy.includes('No ratings yet'), empty.emptyCopy);
  reporter.assertTrue('empty distribution renders no table', empty.hasTable === false);
}

async function verifyGeometry(session: CdpSession, label: string, width: number): Promise<void> {
  const report = await measureInteractivity(session, GALLERY);
  if (!report) throw new Error('Molecule gallery root was not rendered');

  reporter.heading(`${label} — ${report.interactiveCount} interactive targets`);

  if (report.violations.length === 0) {
    reporter.pass(
      `all ${report.interactiveCount} interactive targets are ≥ ${TOUCH_TARGET_MIN_PX}x${TOUCH_TARGET_MIN_PX}px`
    );
  } else if (width < TOUCH_BREAKPOINT_PX) {
    for (const violation of report.violations) {
      reporter.fail(
        `${violation.tag}${violation.role ? `[role=${violation.role}]` : ''} "${violation.label}" is ` +
          `${violation.width}x${violation.height}px`
      );
    }
  } else {
    reporter.note(
      `desktop density: ${report.violations.length} compact target(s) — the 44px rule is a mobile contract`
    );
  }

  if (report.textLinks.length > 0) {
    reporter.note(
      `${report.textLinks.length} inline text link(s) below 44px, exempt under WCAG 2.5.8 ` +
        '(the tap area follows the line height of the surrounding text): ' +
        report.textLinks.map((link) => `"${link.label}" ${link.width}x${link.height}px`).join(', ')
    );
  }

  reporter.assertEqual('gallery horizontal overflow', report.containerOverflow, 0);

  if (report.documentOverflow > 0) {
    reporter.note(`document-wide horizontal overflow of ${report.documentOverflow}px (shell, later phase)`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2), DEFAULT_URL);
  await ensureReachable(args.url);

  const chromePath = resolveChrome(args.chrome);
  console.log(`Molecule certification against ${args.url}`);
  console.log(`Chrome: ${chromePath}`);

  const browser = await launchChrome({ chromePath });
  const session = browser.session;

  try {
    for (const viewport of VIEWPORTS) {
      await setViewport(session, viewport, { colorScheme: 'light' });
      await navigate(session, args.url);
      await verifyGeometry(session, viewport.label, viewport.width);
      await verifyCards(session, viewport.width);

      if (args.shots && viewport.width !== 768) {
        const target = `${args.shots}/molecules-${viewport.width}.png`;
        await captureScreenshot(session, target, viewport.width);
        reporter.note(`screenshot written to ${target}`);
      }

      if (viewport.width === 390) {
        await verifySelectorMobile(session, viewport.height, viewport.width);
      }

      if (viewport.width === SHEET_BREAKPOINT_PX) {
        await verifySelectorDesktop(session);
      }
    }

    await setViewport(session, { width: 390, height: 844 }, { colorScheme: 'light' });
    await navigate(session, args.url);
    await verifySelectorFailure(session);

    await navigate(session, args.url);
    await verifyProgress(session);
    await verifySpoilerGuard(session);
    await verifyDistribution(session);
  } finally {
    await browser.close();
  }

  process.exitCode = reporter.summary('✓ Molecule certification passed at 360 / 390 / 430 / 768 px');
}

main().catch((error: unknown) => {
  console.error(
    `\n✗ Molecule certification could not run: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exitCode = 1;
});
