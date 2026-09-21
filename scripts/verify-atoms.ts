#!/usr/bin/env node
/**
 * Mobile certification harness for the atomic component layer.
 *
 * The Phase 2 acceptance criteria are measured on a real engine, not asserted by
 * eyeball: a headless Chrome is driven over the DevTools Protocol at the
 * certified viewports (360 / 390 / 430 / 768 px) and the rendered geometry,
 * touch behaviour, pointer behaviour, and keyboard behaviour are verified.
 *
 * Usage (from the repository root):
 *   pnpm dev                     # keep this running in another terminal
 *   node scripts/verify-atoms.ts
 *
 * Flags: --url=<page> (default the atom gallery), --chrome=<binary>,
 *        --shots=<dir> to also write per-viewport full-page screenshots.
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
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_URL = 'http://127.0.0.1:5173/dev/atoms';
const MIN_TARGET_PX = 44;
const STAR_MAX = 5;

interface Viewport {
  label: string;
  width: number;
  height: number;
}

const VIEWPORTS: readonly Viewport[] = [
  { label: '360x800  · narrow phone', width: 360, height: 800 },
  { label: '390x844  · phone', width: 390, height: 844 },
  { label: '430x932  · large phone', width: 430, height: 932 },
  { label: '768x1024 · tablet', width: 768, height: 1024 }
];

/**
 * The 44px contract is a mobile one: above the `sm` breakpoint the compact
 * button size intentionally relaxes to 36px, where pointers replace fingers.
 */
const TOUCH_HEIGHT_BREAKPOINT_PX = 640;

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface TargetViolation {
  label: string;
  tag: string;
  role: string | null;
  width: number;
  height: number;
}

interface GeometryReport {
  interactiveCount: number;
  violations: TargetViolation[];
  smallest: TargetViolation | null;
  galleryOverflow: number;
  documentOverflow: number;
  sliderCount: number;
  progressCount: number;
}

interface StarReport {
  valueNow: number;
  valueText: string | null;
  rect: Rect;
  starFills: number[];
}

interface ProgressReport {
  labels: string[];
  valueTexts: string[];
  emptyStates: number;
  fullStates: number;
}

const failures: string[] = [];

function pass(message: string): void {
  console.log(`  ✓ ${message}`);
}

function fail(message: string): void {
  failures.push(message);
  console.log(`  ✗ ${message}`);
}

function assertEqual(label: string, actual: unknown, expected: unknown): void {
  if (actual === expected) pass(`${label} → ${String(expected)}`);
  else fail(`${label} → expected ${String(expected)}, received ${String(actual)}`);
}

function assertClose(label: string, actual: number, expected: number, tolerance = 0.6): void {
  if (Math.abs(actual - expected) <= tolerance) pass(`${label} → ${actual}`);
  else fail(`${label} → expected ~${expected}, received ${actual}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface CliArgs {
  url: string;
  chrome?: string;
  shots?: string;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { url: DEFAULT_URL };

  for (const arg of argv) {
    if (arg.startsWith('--url=')) args.url = arg.slice('--url='.length);
    else if (arg.startsWith('--chrome=')) args.chrome = arg.slice('--chrome='.length);
    else if (arg.startsWith('--shots=')) args.shots = arg.slice('--shots='.length);
    else if (arg.startsWith('http')) args.url = arg;
  }

  return args;
}

function resolveChrome(explicit?: string): string {
  const candidates = [
    explicit,
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ].filter((candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0);

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  throw new Error(
    `No Chrome binary found. Pass --chrome=<path> or set CHROME_PATH. Looked at:\n  ${candidates.join('\n  ')}`
  );
}

async function ensureDevServerReady(url: string): Promise<void> {
  try {
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    throw new Error(
      `Cannot reach ${url} (${error instanceof Error ? error.message : String(error)}).\n` +
        'Start the dev server first: pnpm dev'
    );
  }
}

async function waitForDevToolsPort(profileDir: string, timeoutMs = 20000): Promise<number> {
  const portFile = join(profileDir, 'DevToolsActivePort');
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const contents = await readFile(portFile, 'utf8');
      const firstLine = contents.split('\n')[0]?.trim();
      const port = Number(firstLine);
      if (Number.isInteger(port) && port > 0) return port;
    } catch {
      // Chrome has not written the file yet.
    }
    await sleep(120);
  }

  throw new Error('Timed out waiting for Chrome to open its DevTools port');
}

interface SocketLike {
  send(data: string): void;
  close(): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  addEventListener(type: 'open' | 'close' | 'error', listener: () => void): void;
}

interface CdpSession {
  send<T>(method: string, params?: Record<string, unknown>): Promise<T>;
  once(method: string, timeoutMs?: number): Promise<unknown>;
  close(): void;
}

function openSocket(url: string): Promise<SocketLike> {
  const GlobalSocket = (globalThis as unknown as { WebSocket?: new (target: string) => SocketLike })
    .WebSocket;

  if (!GlobalSocket) {
    throw new Error('This Node runtime has no global WebSocket; Node 22 or newer is required.');
  }

  return new Promise((resolve, reject) => {
    const socket = new GlobalSocket(url);
    let settled = false;

    socket.addEventListener('open', () => {
      settled = true;
      resolve(socket);
    });

    socket.addEventListener('error', () => {
      if (!settled) reject(new Error(`Failed to open DevTools socket at ${url}`));
    });
  });
}

function createSession(socket: SocketLike): CdpSession {
  let nextId = 1;
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  const waiters = new Map<string, Array<(params: unknown) => void>>();

  socket.addEventListener('message', (event) => {
    const payload = JSON.parse(String(event.data)) as {
      id?: number;
      result?: unknown;
      error?: { message?: string };
      method?: string;
      params?: unknown;
    };

    if (typeof payload.id === 'number') {
      const waiter = pending.get(payload.id);
      if (!waiter) return;
      pending.delete(payload.id);
      if (payload.error) waiter.reject(new Error(payload.error.message ?? 'CDP error'));
      else waiter.resolve(payload.result);
      return;
    }

    if (!payload.method) return;
    const listeners = waiters.get(payload.method);
    if (!listeners) return;
    waiters.delete(payload.method);
    for (const listener of listeners) listener(payload.params);
  });

  return {
    send<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
      const id = nextId++;
      return new Promise<T>((resolve, reject) => {
        pending.set(id, { resolve: (value) => resolve(value as T), reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    once(method: string, timeoutMs = 15000): Promise<unknown> {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), timeoutMs);
        const listeners = waiters.get(method) ?? [];
        listeners.push((params) => {
          clearTimeout(timer);
          resolve(params);
        });
        waiters.set(method, listeners);
      });
    },
    close(): void {
      socket.close();
    }
  };
}

async function attachToPage(port: number): Promise<CdpSession> {
  const base = `http://127.0.0.1:${port}`;
  const list = (await (await fetch(`${base}/json/list`)).json()) as Array<{
    type: string;
    webSocketDebuggerUrl?: string;
  }>;

  const page = list.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
  if (!page?.webSocketDebuggerUrl) {
    throw new Error('Chrome exposed no page target to attach to');
  }

  return createSession(await openSocket(page.webSocketDebuggerUrl));
}

async function evaluate<T>(session: CdpSession, expression: string): Promise<T> {
  const response = await session.send<{
    result: { value?: T };
    exceptionDetails?: { text?: string; exception?: { description?: string } };
  }>('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });

  if (response.exceptionDetails) {
    throw new Error(
      `Evaluation failed: ${response.exceptionDetails.exception?.description ?? response.exceptionDetails.text}`
    );
  }

  return response.result.value as T;
}

const GEOMETRY_EXPRESSION = `(() => {
  const root = document.querySelector('#atom-gallery');
  if (!root) return null;

  const interactive = root.querySelectorAll(
    'button, a[href], input, select, textarea, [role="slider"], [role="button"], [role="tab"], [role="link"]'
  );

  const violations = [];
  let smallest = null;
  for (const node of interactive) {
    const rect = node.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    const entry = {
      label: (node.getAttribute('aria-label') || node.textContent || node.tagName).trim().slice(0, 48),
      tag: node.tagName.toLowerCase(),
      role: node.getAttribute('role'),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };
    if (entry.height < (smallest ? smallest.height : Infinity)) smallest = entry;
    if (rect.width + 0.5 >= ${MIN_TARGET_PX} && rect.height + 0.5 >= ${MIN_TARGET_PX}) continue;
    violations.push(entry);
  }

  return {
    interactiveCount: interactive.length,
    violations,
    smallest,
    galleryOverflow: Math.max(0, root.scrollWidth - root.clientWidth),
    documentOverflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
    sliderCount: root.querySelectorAll('[role="slider"]').length,
    progressCount: root.querySelectorAll('[role="progressbar"]').length
  };
})()`;

const STAR_EXPRESSION = `(() => {
  const root = document.querySelector('#atom-gallery');
  const el = root && root.querySelector('[role="slider"]');
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  const stars = Array.from(el.querySelectorAll('span[aria-hidden="true"]'));
  const starFills = stars.map((star) => {
    const overlay = star.querySelector('span[style]');
    if (!overlay) return 0;
    return Number.parseFloat(overlay.style.width) || 0;
  });
  return {
    valueNow: Number(el.getAttribute('aria-valuenow')),
    valueText: el.getAttribute('aria-valuetext'),
    rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    starFills
  };
})()`;

const READONLY_EXPRESSION = `(() => {
  const root = document.querySelector('#atom-gallery');
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
  const root = document.querySelector('#atom-gallery');
  if (!root) return null;
  const bars = Array.from(root.querySelectorAll('[role="progressbar"]'));
  return {
    labels: bars.map((bar) => bar.getAttribute('aria-label') || ''),
    valueTexts: bars.map((bar) => bar.getAttribute('aria-valuetext') || ''),
    emptyStates: bars.filter((bar) => Number(bar.getAttribute('aria-valuenow')) === 0).length,
    fullStates: bars.filter(
      (bar) => Number(bar.getAttribute('aria-valuenow')) === Number(bar.getAttribute('aria-valuemax'))
    ).length
  };
})()`;

function starPoint(rect: Rect, star: number, fraction: number): { x: number; y: number } {
  const zone = rect.width / STAR_MAX;
  return {
    x: rect.left + (star - 1) * zone + zone * fraction,
    y: rect.top + rect.height / 2
  };
}

async function readStar(session: CdpSession): Promise<StarReport> {
  const report = await evaluate<StarReport | null>(session, STAR_EXPRESSION);
  if (!report) throw new Error('Star control not found in the gallery');
  return report;
}

async function tap(session: CdpSession, x: number, y: number): Promise<void> {
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y, id: 1 }]
  });
  await sleep(40);
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(60);
}

async function touchDrag(
  session: CdpSession,
  from: { x: number; y: number },
  to: { x: number; y: number }
): Promise<void> {
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: from.x, y: from.y, id: 1 }]
  });
  await sleep(40);

  const steps = 6;
  for (let step = 1; step <= steps; step++) {
    const progress = step / steps;
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        {
          x: from.x + (to.x - from.x) * progress,
          y: from.y + (to.y - from.y) * progress,
          id: 1
        }
      ]
    });
    await sleep(20);
  }

  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(60);
}

async function mouseClick(session: CdpSession, x: number, y: number): Promise<void> {
  await session.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x,
    y,
    button: 'none',
    buttons: 0
  });
  await session.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    buttons: 1,
    clickCount: 1
  });
  await sleep(30);
  await session.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button: 'left',
    buttons: 0,
    clickCount: 1
  });
  await sleep(60);
}

async function pressKey(session: CdpSession, key: string, code: string, keyCode: number): Promise<void> {
  await session.send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    key,
    code,
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode
  });
  await session.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    code,
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode
  });
  await sleep(60);
}

async function verifyGeometry(session: CdpSession, viewport: Viewport): Promise<void> {
  const report = await evaluate<GeometryReport | null>(session, GEOMETRY_EXPRESSION);
  if (!report) throw new Error('Atom gallery root (#atom-gallery) was not rendered');

  console.log(
    `\n▸ ${viewport.label} — ${report.interactiveCount} interactive targets, ` +
      `${report.sliderCount} star controls, ${report.progressCount} progress bars`
  );

  const mobileContract = viewport.width < TOUCH_HEIGHT_BREAKPOINT_PX;

  if (report.violations.length === 0) {
    pass(`all ${report.interactiveCount} interactive targets are ≥ ${MIN_TARGET_PX}x${MIN_TARGET_PX}px`);
  } else if (mobileContract) {
    for (const violation of report.violations) {
      fail(
        `${violation.tag}${violation.role ? `[role=${violation.role}]` : ''} "${violation.label}" is ` +
          `${violation.width}x${violation.height}px`
      );
    }
  } else if (report.smallest) {
    console.log(
      `  · desktop density: ${report.violations.length} compact target(s), smallest is ` +
        `"${report.smallest.label}" at ${report.smallest.width}x${report.smallest.height}px`
    );
  }

  assertEqual('gallery horizontal overflow', report.galleryOverflow, 0);

  if (report.documentOverflow > 0) {
    console.log(
      `  ! document-wide horizontal overflow of ${report.documentOverflow}px (shell layout, later phase)`
    );
  }

  assertEqual('star controls rendered', report.sliderCount, 3);
  assertEqual('progress bars rendered', report.progressCount, 6);
}

async function scrollStarIntoView(session: CdpSession): Promise<void> {
  await evaluate<boolean>(
    session,
    `(() => {
      const el = document.querySelector('#atom-gallery [role="slider"]');
      if (!el) return false;
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      return true;
    })()`
  );
  await sleep(250);
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
  trackHeight: number;
  gapTotal: number;
}

const TOKEN_EXPRESSION = `(() => {
  const root = document.querySelector('#atom-gallery');
  if (!root) return null;

  const heading = root.querySelector('h1');
  const mono = root.querySelector('[data-numeric]');
  const primaryButton = root.querySelector('button');
  const track = root.querySelector('[role="slider"]');
  const glyphs = track ? Array.from(track.querySelectorAll('span[aria-hidden="true"]')) : [];
  const readOnlyTrack = root.querySelector('[role="img"][aria-label^="Rated"]');
  const filled = readOnlyTrack
    ? readOnlyTrack.querySelector('span[aria-hidden="true"] span svg')
    : null;
  const trackRect = track ? track.getBoundingClientRect() : { width: 0, height: 0 };

  const glyphTotal = glyphs.reduce((sum, glyph) => sum + glyph.getBoundingClientRect().width, 0);
  const glyphHeight = glyphs.length > 0 ? glyphs[0].getBoundingClientRect().height : 0;

  return {
    bodyFont: getComputedStyle(document.body).fontFamily,
    headingFont: heading ? getComputedStyle(heading).fontFamily : '',
    monoFont: mono ? getComputedStyle(mono).fontFamily : '',
    canvas: getComputedStyle(document.body).backgroundColor,
    primary: primaryButton ? getComputedStyle(primaryButton).backgroundColor : '',
    starFill: filled ? getComputedStyle(filled).color : '',
    glyphTotal,
    glyphHeight,
    trackWidth: trackRect.width,
    trackHeight: trackRect.height,
    gapTotal: Math.max(0, trackRect.width - glyphTotal)
  };
})()`;

async function readTokens(session: CdpSession): Promise<TokenReport> {
  const report = await evaluate<TokenReport | null>(session, TOKEN_EXPRESSION);
  if (!report) throw new Error('Atom gallery root (#atom-gallery) was not rendered');
  return report;
}

async function verifyDesignTokens(session: CdpSession): Promise<void> {
  console.log('\n▸ design tokens, typography and theme resolution');

  // Headless Chrome reports a dark system preference by default, so both
  // branches are pinned explicitly instead of inherited from the host.
  await session.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: 'light' }]
  });
  await sleep(250);

  const tokens = await readTokens(session);
  assertEqual('body uses the sans stack', tokens.bodyFont.includes('Plus Jakarta Sans'), true);
  assertEqual('headings use the editorial serif', tokens.headingFont.includes('Newsreader'), true);
  assertEqual('metrics use the mono stack', tokens.monoFont.includes('JetBrains Mono'), true);

  assertEqual('light canvas resolves to the paper token', tokens.canvas, 'rgb(250, 250, 249)');
  assertEqual('primary button resolves to the ochre token', tokens.primary, 'rgb(217, 119, 6)');
  assertEqual('star fill resolves to the primary token', tokens.starFill, 'rgb(245, 158, 11)');

  assertClose('star glyphs plus gaps fill the track exactly', tokens.glyphTotal + tokens.gapTotal, tokens.trackWidth, 1.5);
  assertEqual('star glyph height matches the md icon size', Math.round(tokens.glyphHeight), 24);

  await session.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: 'dark' }]
  });
  await sleep(250);
  const dark = await readTokens(session);
  assertEqual('light canvas is restored before switching', tokens.canvas, 'rgb(250, 250, 249)');
  assertEqual('system dark mode switches the canvas token', dark.canvas, 'rgb(12, 10, 9)');
  assertEqual('star fill brightens in dark mode', dark.starFill, 'rgb(251, 191, 36)');

  await evaluate<boolean>(
    session,
    `(() => { document.documentElement.classList.add('light'); return true; })()`
  );
  await sleep(250);
  const forcedLight = await readTokens(session);
  assertEqual('explicit .light class overrides system dark mode', forcedLight.canvas, 'rgb(250, 250, 249)');

  await evaluate<boolean>(
    session,
    `(() => {
      document.documentElement.classList.remove('light');
      document.documentElement.classList.add('dark');
      return true;
    })()`
  );
  await sleep(250);
  const forcedDark = await readTokens(session);
  assertEqual('explicit .dark class forces dark mode', forcedDark.canvas, 'rgb(12, 10, 9)');

  await evaluate<boolean>(
    session,
    `(() => { document.documentElement.classList.remove('dark'); return true; })()`
  );
  await session.send('Emulation.setEmulatedMedia', { features: [] });
  await sleep(200);
}

async function verifyInteractions(session: CdpSession): Promise<void> {
  console.log('\n▸ interaction contract (390px viewport)');

  // The gallery is tall, so the star control must be on screen before synthetic
  // touch and mouse coordinates can land on it.
  await scrollStarIntoView(session);

  const initial = await readStar(session);
  const initialScroll = await evaluate<number>(session, 'window.scrollY');

  assertEqual('initial aria-valuenow (unrated)', initial.valueNow, 0);
  assertEqual('initial aria-valuetext', initial.valueText, `Not rated out of ${STAR_MAX} stars`);

  const star3Right = starPoint(initial.rect, 3, 0.75);
  await tap(session, star3Right.x, star3Right.y);
  let state = await readStar(session);
  assertClose('touch tap on star 3 (right half) sets', state.valueNow, 3);

  const star2Left = starPoint(initial.rect, 2, 0.25);
  await tap(session, star2Left.x, star2Left.y);
  state = await readStar(session);
  assertClose('touch tap on star 2 (left half) sets half star', state.valueNow, 1.5);
  assertEqual('aria-valuetext follows the value', state.valueText, `1.5 out of ${STAR_MAX} stars`);

  await touchDrag(session, starPoint(initial.rect, 1, 0.75), starPoint(initial.rect, 4, 0.75));
  state = await readStar(session);
  assertClose('touch drag across stars ends at star 4', state.valueNow, 4);

  const star2Right = starPoint(initial.rect, 2, 0.75);
  await mouseClick(session, star2Right.x, star2Right.y);
  state = await readStar(session);
  assertClose('mouse click on star 2 (right half) sets', state.valueNow, 2);

  const afterPointer = await readStar(session);
  assertClose('track width is stable across pointer input', afterPointer.rect.width, initial.rect.width, 0.5);
  assertClose('track height is stable across pointer input', afterPointer.rect.height, initial.rect.height, 0.5);
  assertClose('track x is stable across pointer input', afterPointer.rect.left, initial.rect.left, 0.5);
  assertClose('track y is stable across pointer input', afterPointer.rect.top, initial.rect.top, 0.5);
  assertEqual(
    'page scroll position is unchanged by pointer input',
    await evaluate<number>(session, 'window.scrollY'),
    initialScroll
  );

  await evaluate<boolean>(
    session,
    `(() => { document.querySelector('#atom-gallery [role="slider"]').focus(); return true; })()`
  );

  await pressKey(session, 'End', 'End', 35);
  state = await readStar(session);
  assertClose('End key jumps to the maximum', state.valueNow, STAR_MAX);

  await pressKey(session, 'Home', 'Home', 36);
  state = await readStar(session);
  assertClose('Home key returns to the minimum', state.valueNow, 0.5);

  await pressKey(session, 'ArrowRight', 'ArrowRight', 39);
  state = await readStar(session);
  assertClose('ArrowRight increments by half a star', state.valueNow, 1);

  await pressKey(session, '4', 'Digit4', 52);
  state = await readStar(session);
  assertClose('digit key selects that star', state.valueNow, 4);

  const finalState = await readStar(session);
  assertClose('track width is stable for the whole session', finalState.rect.width, initial.rect.width, 0.5);
  assertClose('track height is stable for the whole session', finalState.rect.height, initial.rect.height, 0.5);
  assertEqual(
    'four whole stars fill completely after selecting 4',
    finalState.starFills.filter((fill) => fill === 100).length,
    4
  );
  assertEqual(
    'remaining star stays empty',
    finalState.starFills.filter((fill) => fill === 0).length,
    1
  );

  const readOnly = await evaluate<{ label: string; starFills: number[] } | null>(
    session,
    READONLY_EXPRESSION
  );
  if (!readOnly) {
    fail('read-only fractional star display not found');
  } else {
    assertEqual('read-only accessible name', readOnly.label, 'Rated 4.4 out of 5 stars');
    assertEqual(
      'read-only whole stars are fully filled',
      readOnly.starFills.slice(0, 4).every((fill) => fill === 100),
      true
    );
    assertClose('read-only partial star shows 37% fill', readOnly.starFills[4] ?? -1, 37, 1.5);
  }

  const progress = await evaluate<ProgressReport | null>(session, PROGRESS_EXPRESSION);
  if (!progress) {
    fail('progress bars not found');
  } else {
    assertEqual(
      'every progress bar exposes aria-valuetext',
      progress.valueTexts.every((text) => text.length > 0),
      true
    );
    assertEqual('zero-percent edge case rendered', progress.emptyStates, 1);
    assertEqual('complete edge case rendered', progress.fullStates, 1);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await ensureDevServerReady(args.url);

  if (args.shots) await mkdir(args.shots, { recursive: true });

  const chromePath = resolveChrome(args.chrome);
  const profileDir = await mkdtemp(join(tmpdir(), 'reads-atoms-'));
  console.log(`Atom certification against ${args.url}`);
  console.log(`Chrome: ${chromePath}`);

  const chrome = spawn(
    chromePath,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      // Chrome's own sandbox and GPU process cannot start inside restricted
      // sandboxes and CI containers; neither affects layout verification.
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--hide-scrollbars',
      '--window-size=430,932',
      'about:blank'
    ],
    { stdio: 'ignore' }
  );

  try {
    const port = await waitForDevToolsPort(profileDir);
    const session = await attachToPage(port);

    await session.send('Page.enable');
    await session.send('Runtime.enable');
    try {
      await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    } catch {
      // Mobile metrics already enable touch on current Chrome builds.
    }

    for (const viewport of VIEWPORTS) {
      await session.send('Emulation.setDeviceMetricsOverride', {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        mobile: true,
        screenWidth: viewport.width,
        screenHeight: viewport.height
      });

      const loaded = session.once('Page.loadEventFired');
      await session.send('Page.navigate', { url: args.url });
      await loaded;
      await sleep(900);

      await verifyGeometry(session, viewport);

      if (args.shots && viewport.width !== 768) {
        const content = await session.send<{ cssContentSize: { height: number } }>(
          'Page.getLayoutMetrics'
        );
        const shot = await session.send<{ data: string }>('Page.captureScreenshot', {
          format: 'png',
          captureBeyondViewport: true,
          clip: {
            x: 0,
            y: 0,
            width: viewport.width,
            height: Math.min(Math.ceil(content.cssContentSize.height), 8000),
            scale: 1
          }
        });
        const target = join(args.shots, `atoms-${viewport.width}.png`);
        await writeFile(target, Buffer.from(shot.data, 'base64'));
        console.log(`  · screenshot written to ${target}`);
      }

      if (viewport.width === 390) {
        await verifyDesignTokens(session);
        await verifyInteractions(session);
      }
    }

    session.close();
  } finally {
    chrome.kill('SIGKILL');
    await rm(profileDir, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    console.log(`\n✗ Atom certification failed with ${failures.length} problem(s):`);
    for (const failure of failures) console.log(`  · ${failure}`);
    process.exitCode = 1;
    return;
  }

  console.log('\n✓ Atom certification passed at 360 / 390 / 430 / 768 px');
}

main().catch((error: unknown) => {
  console.error(`\n✗ Atom certification could not run: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
