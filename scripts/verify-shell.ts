/**
 * Phase 5 certification: responsive shell and assembled pages.
 *
 * Drives a running dev server through headless Chrome and asserts the acceptance
 * criteria of the final phase:
 *
 *   1. no horizontal overflow at 360, 390, 430, 768, and 1024+ pixels wide;
 *   2. the mobile bottom navigation appears only below the 768px breakpoint with
 *      four labelled destinations, ≥44px targets, and enough footer clearance
 *      that it never covers the end of the page;
 *   3. every interactive control below the 640px touch breakpoint meets the 44px
 *      contract (inline text links are reported as notes under WCAG 2.5.8);
 *   4. the header search reaches the search route with the term in the URL;
 *   5. signing in with a seeded reader loads their shelves and renders them;
 *   6. shelf tabs and the grid/table toggle are deep-linkable through the URL;
 *   7. seeded catalog data renders on discovery, search, and detail surfaces,
 *      including the Bayesian score, rating distribution, and review feed;
 *   8. the anonymous profile route shows a fully labelled sign-in form.
 *
 * Usage:
 *   pnpm run verify:shell                  # http://localhost:5173
 *   pnpm run verify:shell -- --url=...     # custom base URL
 *   pnpm run verify:shell -- --shots=<dir> # also write screenshots
 */
import {
  VIEWPORTS,
  captureScreenshot,
  createReporter,
  evaluate,
  launchChrome,
  measureInteractivity,
  navigate,
  parseArgs,
  rectOf,
  resolveChrome,
  setViewport,
  sleep,
  type CdpSession
} from './lib/cdp.ts';

const args = parseArgs(process.argv.slice(2), process.env.VERIFY_BASE_URL ?? 'http://localhost:5173');

/** Seeded by `pnpm run emulator:seed`; override for a different dataset. */
const READER = {
  email: process.env.VERIFY_READER_EMAIL ?? 'ada.reads@example.com',
  password: process.env.VERIFY_READER_PASSWORD ?? 'emulator-seed-pass-2026'
};

/** Seeded book that carries reviews, used for the detail-page assertions. */
const REVIEWED_BOOK_ID = process.env.VERIFY_BOOK_ID ?? '9780143127741';

const reporter = createReporter();

/**
 * Polls until a selector matches, so slow reads never masquerade as missing UI.
 * Returns false when the timeout expires.
 */
async function waitForSelector(
  session: CdpSession,
  selector: string,
  timeoutMs = 8000
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await evaluate<boolean>(
      session,
      `Boolean(document.querySelector(${JSON.stringify(selector)}))`
    );
    if (found) return true;
    await sleep(200);
  }
  return false;
}

/** Polls a boolean expression until it holds, so async feeds never race assertions. */
async function waitForCondition(
  session: CdpSession,
  expression: string,
  timeoutMs = 8000
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const settled = await evaluate<boolean>(session, expression);
    if (settled) return true;
    await sleep(200);
  }
  return false;
}

/** Reader-facing message currently rendered by a page, for failure diagnostics. */
async function visibleState(session: CdpSession): Promise<string> {
  return evaluate<string>(
    session,
    `(() => {
      const node = document.querySelector('main [role="alert"], main [role="status"]');
      const text = node?.textContent?.replace(/\\s+/g, ' ').trim() ?? 'none';
      return text.slice(0, 120);
    })()`
  );
}

interface RouteCheck {
  path: string;
  marker: string;
  label: string;
}

const ROUTES: readonly RouteCheck[] = [
  { path: '/', marker: 'main h1', label: 'discovery' },
  { path: '/search', marker: 'main form[role="search"]', label: 'search' },
  { path: '/my-books', marker: 'main h1', label: 'my shelves' },
  { path: '/profile', marker: 'main h1', label: 'profile' }
];

/**
 * Sets the value of the *visible* match for a selector. Responsive layouts render
 * both a desktop and a mobile variant of the same control, so the hidden copy
 * must be skipped.
 */
async function setVisibleInputValue(
  session: CdpSession,
  selector: string,
  value: string
): Promise<boolean> {
  return evaluate<boolean>(
    session,
    `(() => {
      const input = [...document.querySelectorAll(${JSON.stringify(selector)})].find(
        (candidate) => candidate.getBoundingClientRect().width > 0
      );
      if (!input) return false;
      input.value = ${JSON.stringify(value)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`
  );
}

/** Clicks the visible match for a selector, using the native default action. */
async function clickVisible(session: CdpSession, selector: string): Promise<boolean> {
  return evaluate<boolean>(
    session,
    `(() => {
      const target = [...document.querySelectorAll(${JSON.stringify(selector)})].find(
        (candidate) => candidate.getBoundingClientRect().width > 0
      );
      if (!target) return false;
      target.click();
      return true;
    })()`
  );
}

async function hasVisible(session: CdpSession, selector: string): Promise<boolean> {
  return evaluate<boolean>(
    session,
    `[...document.querySelectorAll(${JSON.stringify(selector)})].some(
      (candidate) => candidate.getBoundingClientRect().width > 0
    )`
  );
}

async function measureOverflow(
  session: CdpSession
): Promise<{ scrollWidth: number; clientWidth: number; offender?: string }> {
  return evaluate<{ scrollWidth: number; clientWidth: number; offender?: string }>(
    session,
    `(() => {
      const root = document.documentElement;
      const overflow = root.scrollWidth - root.clientWidth;
      if (overflow <= 1) {
        return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth };
      }

      let worst = null;
      for (const element of document.querySelectorAll('body *')) {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.right <= root.clientWidth + 1) continue;
        if (!worst || rect.right > worst.right) {
          worst = {
            right: rect.right,
            tag: element.tagName.toLowerCase(),
            cls: typeof element.className === 'string' ? element.className.slice(0, 60) : ''
          };
        }
      }

      return {
        scrollWidth: root.scrollWidth,
        clientWidth: root.clientWidth,
        offender: worst
          ? worst.tag + (worst.cls ? '.' + worst.cls.replace(/\\s+/g, '.') : '')
          : 'unknown'
      };
    })()`
  );
}

async function verifyViewport(
  session: CdpSession,
  viewport: (typeof VIEWPORTS)[number]
): Promise<void> {
  reporter.heading(viewport.label);
  await setViewport(session, viewport);

  for (const route of ROUTES) {
    await navigate(session, `${args.url}${route.path}`, 1500);
    const overflow = await measureOverflow(session);
    reporter.assertTrue(
      `${route.label}: no horizontal overflow (${overflow.scrollWidth}px content in ${overflow.clientWidth}px)`,
      overflow.scrollWidth - overflow.clientWidth <= 1,
      overflow.offender ? `widest element: ${overflow.offender}` : undefined
    );
  }

  await navigate(session, `${args.url}/`, 1500);
  const navRect = await rectOf(session, 'nav[aria-label="Primary"]');
  const expectNav = viewport.width < 768;

  reporter.assertTrue(
    expectNav
      ? 'bottom navigation is visible below 768px'
      : 'bottom navigation is hidden at and above 768px',
    expectNav ? navRect !== null && navRect.width > 0 : navRect === null || navRect.width === 0,
    navRect ? `measured ${Math.round(navRect.width)}px` : 'not rendered'
  );

  if (!expectNav) return;

  const navItems = await evaluate<{ label: string; href: string; width: number; height: number }[]>(
    session,
    `[...document.querySelectorAll('nav[aria-label="Primary"] a[data-nav-item]')].map((link) => {
      const rect = link.getBoundingClientRect();
      return {
        label: link.dataset.navItem ?? '',
        href: link.getAttribute('href') ?? '',
        width: rect.width,
        height: rect.height
      };
    })`
  );

  reporter.assertEqual('bottom navigation has four destinations', navItems.length, 4);
  reporter.assertEqual(
    'bottom navigation destinations',
    navItems.map((item) => item.label).join(', '),
    'Explore, Search, My Shelves, Profile'
  );
  reporter.assertEqual(
    'bottom navigation targets',
    navItems.map((item) => item.href).join(', '),
    '/, /search, /my-books, /profile'
  );

  const smallest = navItems.reduce(
    (min, item) => Math.min(min, Math.min(item.width, item.height)),
    Number.POSITIVE_INFINITY
  );
  reporter.assertTrue(
    `bottom navigation targets are ≥44px (smallest ${Math.round(smallest)}px)`,
    smallest >= 44
  );

  // Scrolled to the very bottom, the last content must still clear the fixed bar.
  await evaluate(session, 'window.scrollTo(0, document.documentElement.scrollHeight)');
  await sleep(400);
  const clearance = await evaluate<number | null>(
    session,
    `(() => {
      const nav = document.querySelector('nav[aria-label="Primary"]');
      const last = document.querySelector('footer p') ?? document.querySelector('footer');
      if (!nav || !last) return null;
      return Math.round(nav.getBoundingClientRect().top - last.getBoundingClientRect().bottom);
    })()`
  );
  reporter.assertTrue(
    `last footer text clears the fixed bar (${clearance ?? 'n/a'}px of slack)`,
    clearance !== null && clearance >= 0,
    clearance !== null && clearance < 0 ? 'content renders underneath the fixed bar' : undefined
  );

  const geometry = await measureInteractivity(session, 'body');
  if (geometry) {
    reporter.assertTrue(
      `touch targets ≥44px (${geometry.violations.length} violations)`,
      geometry.violations.length === 0,
      geometry.violations
        .slice(0, 4)
        .map(
          (violation) =>
            `${violation.tag}[${violation.label.slice(0, 32)}] ${Math.round(violation.width)}×${Math.round(violation.height)}`
        )
        .join('; ')
    );
    if (geometry.textLinks.length > 0) {
      reporter.note(
        `${geometry.textLinks.length} inline text links below 44px (exempt under WCAG 2.5.8 spacing)`
      );
    }
  }
}

async function signIn(session: CdpSession): Promise<boolean> {
  await navigate(session, `${args.url}/profile`, 1800);

  const filled =
    (await setVisibleInputValue(session, 'main input[type="email"]', READER.email)) &&
    (await setVisibleInputValue(session, 'main input[type="password"]', READER.password));

  if (!filled) return false;

  await clickVisible(session, 'main form button[type="submit"]');
  await sleep(3000);

  const location = await evaluate<string>(session, 'window.location.pathname');
  return location === '/my-books';
}

async function verifyProfileRoute(session: CdpSession): Promise<void> {
  reporter.heading('anonymous profile route');
  await setViewport(session, VIEWPORTS[0]!);
  await navigate(session, `${args.url}/profile`, 1800);

  const form = await evaluate<{
    email: boolean;
    password: boolean;
    inputs: number;
    labelled: number;
  }>(
    session,
    `(() => {
      const inputs = [...document.querySelectorAll('main form input')];
      return {
        email: Boolean(document.querySelector('main input[type="email"]')),
        password: Boolean(document.querySelector('main input[type="password"]')),
        inputs: inputs.length,
        labelled: inputs.filter(
          (input) => input.labels?.length > 0 || input.getAttribute('aria-label')
        ).length
      };
    })()`
  );

  reporter.assertTrue('anonymous readers see the email field', form.email);
  reporter.assertTrue('anonymous readers see the password field', form.password);
  reporter.assertTrue(
    `every form control has a label (${form.labelled}/${form.inputs})`,
    form.inputs > 0 && form.labelled === form.inputs
  );
}

async function verifyHeaderSearch(session: CdpSession): Promise<void> {
  reporter.heading('header search');
  await setViewport(session, VIEWPORTS[0]!);
  await navigate(session, `${args.url}/`, 1500);

  if (await hasVisible(session, 'header button[aria-label="Open search"]')) {
    await clickVisible(session, 'header button[aria-label="Open search"]');
    await sleep(300);
  }

  const inputSelector = 'header form[role="search"] input[type="search"]';
  reporter.assertTrue(
    'header search input is reachable',
    await hasVisible(session, inputSelector)
  );
  reporter.assertTrue(
    'header search has a visible submit control',
    await hasVisible(session, 'header form[role="search"] button[type="submit"]')
  );

  reporter.assertTrue(
    'search term is accepted by the header field',
    await setVisibleInputValue(session, inputSelector, 'steinbeck')
  );
  reporter.assertTrue(
    'header search submits',
    await clickVisible(session, 'header form[role="search"] button[type="submit"]')
  );
  await sleep(1800);

  const location = await evaluate<string>(
    session,
    'window.location.pathname + window.location.search'
  );
  reporter.assertTrue(
    `header search navigates to the search route (${location})`,
    location.startsWith('/search') && location.includes('steinbeck')
  );

  const searchValue = await evaluate<string | null>(
    session,
    `document.querySelector('main input[type="search"]')?.value ?? null`
  );
  reporter.assertEqual('search page reflects the query', searchValue, 'steinbeck');
}

async function verifyShelves(session: CdpSession): Promise<void> {
  reporter.heading('shelves behind a session');
  await setViewport(session, VIEWPORTS[1]!);

  const signedIn = await signIn(session);
  reporter.assertTrue(`sign-in as ${READER.email} reaches the shelves`, signedIn);
  if (!signedIn) return;

  await navigate(session, `${args.url}/my-books`, 2000);
  const shelvesReady = await waitForSelector(session, 'nav[aria-label="Shelf filters"]');
  reporter.assertTrue('shelves finish loading', shelvesReady, await visibleState(session));

  const shelves = await evaluate<{
    rows: number;
    tabs: string[];
    hasCardControls: boolean;
  }>(
    session,
    `(() => ({
      rows: document.querySelectorAll('main ul li').length,
      tabs: [...document.querySelectorAll('nav[aria-label="Shelf filters"] a')].map(
        (link) => link.textContent?.trim() ?? ''
      ),
      hasCardControls: Boolean(document.querySelector('main [role="slider"], main button'))
    }))()`
  );

  reporter.assertTrue(`seeded shelves render (${shelves.rows} list items)`, shelves.rows >= 3);
  reporter.assertEqual('shelf filter tabs render', shelves.tabs.length, 5);

  await navigate(session, `${args.url}/my-books?tab=read&view=table`, 2000);
  const tableReady = await waitForSelector(session, 'main table');
  reporter.assertTrue('table layout renders from the URL', tableReady, await visibleState(session));

  const table = await evaluate<{
    rows: number;
    current: string | null;
    pageScrollX: number;
    wrapperScrolls: boolean;
    wrapperWidth: number;
    tableWidth: number;
  }>(
    session,
    `(async () => {
      const rows = document.querySelectorAll('main table tbody tr').length;
      const active = document.querySelector('nav[aria-label="Shelf filters"] a[aria-current="page"]');
      const element = document.querySelector('main table');
      const wrapper = element?.parentElement ?? null;
      const placeholder = wrapper?.scrollLeft ?? 0;
      if (wrapper) wrapper.scrollLeft = 220;
      window.scrollTo(9999, window.scrollY);
      await new Promise((resolve) => setTimeout(resolve, 150));
      const result = {
        rows,
        current: active?.textContent?.trim() ?? null,
        pageScrollX: window.scrollX,
        wrapperScrolls: wrapper ? wrapper.scrollLeft > placeholder : false,
        wrapperWidth: wrapper ? Math.round(wrapper.getBoundingClientRect().width) : 0,
        tableWidth: element ? Math.round(element.getBoundingClientRect().width) : 0
      };
      if (wrapper) wrapper.scrollLeft = placeholder;
      return result;
    })()`
  );

  reporter.assertTrue(`table layout renders from the URL (${table.rows} rows)`, table.rows > 0);
  reporter.assertTrue(
    `Read tab is selected from the URL (${table.current ?? 'none'})`,
    (table.current ?? '').startsWith('Read')
  );
  reporter.assertTrue(
    `the dense table scrolls in its own container (${table.tableWidth}px table in ${table.wrapperWidth}px)`,
    table.wrapperScrolls
  );
  reporter.assertTrue(
    `the table layout never scrolls the page sideways (scrollX ${table.pageScrollX})`,
    table.pageScrollX === 0
  );
}

async function verifyDataSurfaces(session: CdpSession): Promise<void> {
  reporter.heading('seeded catalog data');
  await setViewport(session, VIEWPORTS[3]!);

  await navigate(session, `${args.url}/`, 2000);
  const discoveryReady = await waitForSelector(session, 'main article[data-book-id]');
  reporter.assertTrue('discovery finishes loading its cards', discoveryReady, await visibleState(session));

  const discovery = await evaluate<{ sections: number; cards: number; titles: string[] }>(
    session,
    `(() => {
      const cards = [...document.querySelectorAll('main article[data-book-id]')];
      return {
        sections: document.querySelectorAll('main section[aria-labelledby^="section-"]').length,
        cards: cards.length,
        titles: cards
          .slice(0, 3)
          .map((card) => card.querySelector('a[aria-label^="View details"]')?.getAttribute('aria-label') ?? '')
      };
    })()`
  );

  reporter.assertEqual('discovery renders three shelves', discovery.sections, 3);
  reporter.assertTrue(
    `discovery renders seeded books (${discovery.cards} cards)`,
    discovery.cards >= 6,
    discovery.titles.join(' | ')
  );

  // Follow a card link so the journey matches how readers reach a book, and fall
  // back to a cold load of the same route when the card is not on screen.
  const clickedCard = await evaluate<boolean>(
    session,
    `(() => {
      const card = document.querySelector('main article[data-book-id="${REVIEWED_BOOK_ID}"] a[href]');
      if (!card) return false;
      card.click();
      return true;
    })()`
  );

  if (!clickedCard) await navigate(session, `${args.url}/books/${REVIEWED_BOOK_ID}`, 1800);

  // The score panel only exists on the detail route, so it is the reliable marker
  // for "the book has rendered" after a client-side link click.
  const detailMarker = 'main section[aria-labelledby="score-heading"]';
  let detailReady = await waitForSelector(session, detailMarker);
  if (!detailReady) {
    // A transient read failure is recoverable from the page itself; exercise the
    // retry control rather than failing on one dropped connection.
    const retried = await clickVisible(session, 'main button');
    if (retried) detailReady = await waitForSelector(session, detailMarker, 10_000);
  }

  reporter.assertTrue(
    'detail page finishes loading the book',
    detailReady,
    await visibleState(session)
  );

  // The review feed loads after the book itself. A read that loses its connection
  // surfaces the page's own retry control, so the feed is expected to recover from
  // the UI rather than from the harness.
  const feedSettled = (): Promise<boolean> =>
    waitForCondition(
      session,
      `(() => {
        const section = document.querySelector('section[aria-labelledby="reviews-heading"]');
        if (!section) return false;
        if (section.querySelector('[aria-busy="true"]')) return false;
        return (
          section.querySelectorAll('article').length > 0 ||
          Boolean(section.querySelector('[role="status"], [role="alert"]'))
        );
      })()`
    );

  let reviewsRecovered = false;
  if (!(await feedSettled())) {
    reviewsRecovered = await clickVisible(
      session,
      'section[aria-labelledby="reviews-heading"] button'
    );
    if (reviewsRecovered) reviewsRecovered = await feedSettled();
    reporter.note(
      reviewsRecovered
        ? 'the review read stalled once and the retry control recovered it'
        : 'the review read stalled and the retry control did not recover it'
    );
  }

  const feedState = await evaluate<{ alert: string | null; requests: string[]; online: boolean }>(
    session,
    `(() => ({
      online: navigator.onLine,
      alert:
        document
          .querySelector('section[aria-labelledby="reviews-heading"] [role="alert"]')
          ?.textContent?.replace(/\\s+/g, ' ')
          .trim()
          .slice(0, 90) ?? null,
      requests: performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .filter((name) => name.indexOf(':8080') !== -1 || name.indexOf(':9099') !== -1)
        .slice(-6)
        .map((name) => name.split('/').slice(-2).join('/'))
    }))()`
  );

  if (feedState.alert) {
    process.stderr.write('FEED DIAGNOSTIC ' + JSON.stringify(feedState) + '\n');
  }

  const feedReady = await feedSettled();
  reporter.assertTrue('the review feed settles or offers a retry', feedReady, await visibleState(session));

  const detail = await evaluate<{
    title: string;
    bayesian: boolean;
    distributionRows: number;
    sortOptions: number;
    reviews: number;
    shelfControl: boolean;
    ratingControl: boolean;
  }>(
    session,
    `(() => {
      const main = document.querySelector('main');
      const sort = main?.querySelector('section[aria-labelledby="reviews-heading"] select');
      return {
        title: main?.querySelector('h1')?.textContent?.trim() ?? '',
        bayesian: Boolean(main?.textContent?.includes('Bayesian score')),
        distributionRows: main?.querySelectorAll('table tbody tr').length ?? 0,
        sortOptions: sort ? sort.querySelectorAll('option').length : 0,
        reviews: main?.querySelectorAll('section[aria-labelledby="reviews-heading"] article').length ?? 0,
        shelfControl: Boolean(main?.querySelector('[aria-haspopup="listbox"], button[aria-expanded]')),
        ratingControl: Boolean(main?.querySelector('[role="slider"]'))
      };
    })()`
  );

  reporter.assertTrue(
    `detail page renders a title (${detail.title.slice(0, 48)})`,
    detail.title.length > 0
  );
  reporter.assertTrue('detail page explains the Bayesian score', detail.bayesian);
  reporter.assertTrue(
    `detail page renders the rating distribution (${detail.distributionRows} tiers)`,
    detail.distributionRows >= 5
  );
  reporter.assertEqual('review feed offers three orderings', detail.sortOptions, 3);
  reporter.assertTrue(
    `detail page renders seeded reviews (${detail.reviews})`,
    detail.reviews >= 1
  );
  reporter.assertTrue('signed-in readers get the shelf control', detail.shelfControl);
  reporter.assertTrue('signed-in readers get the rating control', detail.ratingControl);

  await navigate(session, `${args.url}/search`, 2000);
  let searchReady = await waitForSelector(session, 'main article[data-book-id]');
  if (!searchReady) {
    // Reloading the route builds a fresh Firestore client, which recovers from a
    // transport that stalled earlier in the session.
    await navigate(session, `${args.url}/search`, 1200);
    searchReady = await waitForSelector(session, 'main article[data-book-id]', 12_000);
    reporter.note('search results needed a route reload before they rendered');
  }
  reporter.assertTrue('search finishes loading results', searchReady, await visibleState(session));

  const search = await evaluate<{ cards: number; genres: number; labelled: boolean }>(
    session,
    `(() => {
      const controls = [...document.querySelectorAll('main form select, main form input')];
      return {
        cards: document.querySelectorAll('main article[data-book-id]').length,
        genres: (document.querySelectorAll('main select')[0]?.querySelectorAll('option').length ?? 1) - 1,
        labelled: controls.every(
          (control) => control.labels?.length > 0 || control.getAttribute('aria-label')
        )
      };
    })()`
  );

  reporter.assertTrue(
    `search renders the seeded catalog (${search.cards} cards, ${search.genres} genres)`,
    search.cards >= 6 && search.genres >= 1
  );
  reporter.assertTrue('search filters are all labelled', search.labelled);
}

async function main(): Promise<void> {
  const chromePath = resolveChrome(args.chrome);
  console.log(`\nPhase 5 shell certification\n  base url: ${args.url}\n  chrome: ${chromePath}\n`);

  const browser = await launchChrome({ chromePath });

  try {
    // Auth, data surfaces, and shelves run first: they are the checks that depend on
    // Firestore, so they exercise the emulator's streaming transport while it is
    // fresh. The viewport sweep is layout-only and follows afterwards.
    await verifyProfileRoute(browser.session);
    await verifyHeaderSearch(browser.session);
    await verifyShelves(browser.session);
    await verifyDataSurfaces(browser.session);

    for (const viewport of VIEWPORTS) {
      await verifyViewport(browser.session, viewport);
    }

    if (args.shots) {
      for (const viewport of [VIEWPORTS[0]!, VIEWPORTS[3]!]) {
        await setViewport(browser.session, viewport);
        for (const route of ROUTES) {
          await navigate(browser.session, `${args.url}${route.path}`, 1600);
          const name = route.label.replace(/\s+/g, '-');
          const target = `${args.shots}/shell-${viewport.width}-${name}.png`;
          await captureScreenshot(browser.session, target, viewport.width);
          reporter.note(`screenshot: ${target}`);
        }
      }
    }
  } finally {
    await browser.close();
  }

  process.exit(reporter.summary('Phase 5 shell certification passed.'));
}

await main();
