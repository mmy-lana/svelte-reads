/**
 * Minimal Chrome DevTools Protocol driver used by the UI certification scripts.
 *
 * This is deliberately dependency-free: the scripts launch the developer's own
 * Chrome, attach to a page target over the DevTools websocket, and drive real
 * input so touch, mouse, keyboard, and layout behaviour are measured on a real
 * engine instead of being asserted against markup strings.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export const TOUCH_TARGET_MIN_PX = 44;

/** Width below which the 44px touch-target contract is enforced (Tailwind `sm`). */
export const TOUCH_BREAKPOINT_PX = 640;

/** Width at which the shelf picker switches from bottom sheet to popover (`md`). */
export const SHEET_BREAKPOINT_PX = 768;

export interface Viewport {
  label: string;
  width: number;
  height: number;
}

export const VIEWPORTS: readonly Viewport[] = [
  { label: '360x800  · narrow phone', width: 360, height: 800 },
  { label: '390x844  · phone', width: 390, height: 844 },
  { label: '430x932  · large phone', width: 430, height: 932 },
  { label: '768x1024 · tablet', width: 768, height: 1024 }
];

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

export interface Point {
  x: number;
  y: number;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* -------------------------------------------------------------------------- */
/* Reporter                                                                   */
/* -------------------------------------------------------------------------- */

export interface Reporter {
  pass(message: string): void;
  fail(message: string): void;
  note(message: string): void;
  heading(message: string): void;
  assertEqual(label: string, actual: unknown, expected: unknown): void;
  assertClose(label: string, actual: number, expected: number, tolerance?: number): void;
  assertTrue(label: string, condition: boolean, detail?: string): void;
  readonly failures: readonly string[];
  summary(successMessage: string): number;
}

export function createReporter(): Reporter {
  const failures: string[] = [];
  const write = (line: string): void => {
    console.log(line);
  };

  return {
    pass(message) {
      write(`  ✓ ${message}`);
    },
    fail(message) {
      failures.push(message);
      write(`  ✗ ${message}`);
    },
    note(message) {
      write(`  · ${message}`);
    },
    heading(message) {
      write(`\n▸ ${message}`);
    },
    assertEqual(label, actual, expected) {
      if (actual === expected) this.pass(`${label} → ${String(expected)}`);
      else this.fail(`${label} → expected ${String(expected)}, received ${String(actual)}`);
    },
    assertClose(label, actual, expected, tolerance = 0.6) {
      if (Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance) {
        this.pass(`${label} → ${actual}`);
      } else {
        this.fail(`${label} → expected ~${expected}, received ${actual}`);
      }
    },
    assertTrue(label, condition, detail) {
      if (condition) this.pass(`${label}${detail ? ` → ${detail}` : ''}`);
      else this.fail(`${label}${detail ? ` → ${detail}` : ''}`);
    },
    failures,
    summary(successMessage) {
      if (failures.length === 0) {
        write(`\n${successMessage}`);
        return 0;
      }
      write(`\n✗ Certification failed with ${failures.length} problem(s):`);
      for (const failure of failures) write(`  · ${failure}`);
      return 1;
    }
  };
}

/* -------------------------------------------------------------------------- */
/* Chrome lifecycle                                                           */
/* -------------------------------------------------------------------------- */

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
];

export function resolveChrome(explicit?: string): string {
  const candidates = [explicit, process.env.CHROME_PATH, ...CHROME_CANDIDATES].filter(
    (candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0
  );

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  throw new Error(
    `No Chrome binary found. Pass --chrome=<path> or set CHROME_PATH. Looked at:\n  ${candidates.join('\n  ')}`
  );
}

export async function ensureReachable(url: string): Promise<void> {
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

interface SocketLike {
  send(data: string): void;
  close(): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  addEventListener(type: 'open' | 'close' | 'error', listener: () => void): void;
}

export interface CdpSession {
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

async function waitForDevToolsPort(profileDir: string, timeoutMs = 20000): Promise<number> {
  const portFile = join(profileDir, 'DevToolsActivePort');
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const contents = await readFile(portFile, 'utf8');
      const port = Number(contents.split('\n')[0]?.trim());
      if (Number.isInteger(port) && port > 0) return port;
    } catch {
      // Chrome has not written the file yet.
    }
    await sleep(120);
  }

  throw new Error('Timed out waiting for Chrome to open its DevTools port');
}

export interface ChromeHandle {
  session: CdpSession;
  /** Kills the browser and removes its temporary profile. */
  close(): Promise<void>;
}

export async function launchChrome(options: {
  chromePath: string;
  windowSize?: string;
  enableTouch?: boolean;
}): Promise<ChromeHandle> {
  const profileDir = await mkdtemp(join(tmpdir(), 'reads-ui-'));
  const chrome = spawn(
    options.chromePath,
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
      `--window-size=${options.windowSize ?? '430,932'}`,
      'about:blank'
    ],
    { stdio: 'ignore' }
  );

  try {
    const port = await waitForDevToolsPort(profileDir);
    const list = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as Array<{
      type: string;
      webSocketDebuggerUrl?: string;
    }>;

    const page = list.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
    if (!page?.webSocketDebuggerUrl) throw new Error('Chrome exposed no page target to attach to');

    const session = createSession(await openSocket(page.webSocketDebuggerUrl));
    await session.send('Page.enable');
    await session.send('Runtime.enable');
    await session.send('Accessibility.enable');

    if (options.enableTouch !== false) {
      try {
        await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      } catch {
        // Mobile metrics already enable touch on current Chrome builds.
      }
    }

    return {
      session,
      async close() {
        session.close();
        chrome.kill('SIGKILL');
        await rm(profileDir, { recursive: true, force: true });
      }
    };
  } catch (error) {
    chrome.kill('SIGKILL');
    await rm(profileDir, { recursive: true, force: true });
    throw error;
  }
}

/* -------------------------------------------------------------------------- */
/* Page driving                                                               */
/* -------------------------------------------------------------------------- */

export interface EvaluateOptions {
  awaitPromise?: boolean;
}

export async function evaluate<T>(
  session: CdpSession,
  expression: string,
  options: EvaluateOptions = {}
): Promise<T> {
  const response = await session.send<{
    result: { value?: T };
    exceptionDetails?: { text?: string; exception?: { description?: string } };
  }>('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: options.awaitPromise ?? true
  });

  if (response.exceptionDetails) {
    throw new Error(
      `Evaluation failed: ${response.exceptionDetails.exception?.description ?? response.exceptionDetails.text}`
    );
  }

  return response.result.value as T;
}

export async function setViewport(
  session: CdpSession,
  viewport: Pick<Viewport, 'width' | 'height'>,
  options: { mobile?: boolean; colorScheme?: 'light' | 'dark' | null } = {}
): Promise<void> {
  await session.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: options.mobile ?? true,
    screenWidth: viewport.width,
    screenHeight: viewport.height
  });

  if (options.colorScheme !== undefined) {
    await session.send('Emulation.setEmulatedMedia', {
      features: options.colorScheme
        ? [{ name: 'prefers-color-scheme', value: options.colorScheme }]
        : []
    });
  }
}

export async function navigate(session: CdpSession, url: string, settleMs = 900): Promise<void> {
  const loaded = session.once('Page.loadEventFired');
  await session.send('Page.navigate', { url });
  await loaded;
  await sleep(settleMs);
}

export async function rectOf(session: CdpSession, selector: string): Promise<Rect | null> {
  return evaluate<Rect | null>(
    session,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return {
        left: rect.left, top: rect.top, width: rect.width, height: rect.height,
        right: rect.right, bottom: rect.bottom
      };
    })()`
  );
}

export async function focusSelector(session: CdpSession, selector: string): Promise<boolean> {
  return evaluate<boolean>(
    session,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.focus();
      return document.activeElement === el;
    })()`
  );
}

export async function scrollIntoView(session: CdpSession, selector: string): Promise<void> {
  await evaluate<boolean>(
    session,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      return true;
    })()`
  );
  await sleep(250);
}

export async function clickPoint(session: CdpSession, point: Point): Promise<void> {
  await session.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: point.x,
    y: point.y,
    button: 'none',
    buttons: 0
  });
  await session.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: point.x,
    y: point.y,
    button: 'left',
    buttons: 1,
    clickCount: 1
  });
  await sleep(30);
  await session.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: point.x,
    y: point.y,
    button: 'left',
    buttons: 0,
    clickCount: 1
  });
  await sleep(80);
}

/** Alias for a deliberate mouse-driven click, used where touch is not the subject. */
export async function mouseClick(session: CdpSession, point: Point): Promise<void> {
  await clickPoint(session, point);
}

export async function clickSelector(session: CdpSession, selector: string): Promise<void> {
  await scrollIntoView(session, selector);
  const rect = await rectOf(session, selector);
  if (!rect) throw new Error(`Cannot click missing selector: ${selector}`);
  await clickPoint(session, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
}

export async function tapPoint(session: CdpSession, point: Point): Promise<void> {
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: point.x, y: point.y, id: 1 }]
  });
  await sleep(40);
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(60);
}

export async function touchDrag(session: CdpSession, from: Point, to: Point, steps = 6): Promise<void> {
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: from.x, y: from.y, id: 1 }]
  });
  await sleep(40);

  for (let step = 1; step <= steps; step += 1) {
    const progress = step / steps;
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress, id: 1 }
      ]
    });
    await sleep(20);
  }

  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(60);
}

export async function pressKey(
  session: CdpSession,
  key: string,
  code: string,
  keyCode: number
): Promise<void> {
  // Enter and Space activate native controls through the keypress default
  // action, so they must be dispatched with `text`; every other key only needs
  // the raw keydown that listeners observe.
  const text = key === 'Enter' ? '\r' : key === ' ' ? ' ' : undefined;

  await session.send('Input.dispatchKeyEvent', {
    type: text ? 'keyDown' : 'rawKeyDown',
    ...(text ? { text } : {}),
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
  await sleep(80);
}

export interface GeometryViolation {
  label: string;
  tag: string;
  role: string | null;
  width: number;
  height: number;
}

export interface GeometryReport {
  interactiveCount: number;
  /** Controls and graphic links that miss the touch-target contract. */
  violations: GeometryViolation[];
  /**
   * Text-only links that miss it. WCAG 2.5.8 exempts targets constrained by the
   * line height of their surrounding text, so these are reported, not failed.
   */
  textLinks: GeometryViolation[];
  smallest: GeometryViolation | null;
  containerOverflow: number;
  documentOverflow: number;
}

/** Measures every interactive descendant of a container against the touch contract. */
export async function measureInteractivity(
  session: CdpSession,
  containerSelector: string,
  minTargetPx = TOUCH_TARGET_MIN_PX
): Promise<GeometryReport | null> {
  return evaluate<GeometryReport | null>(
    session,
    `(() => {
      const root = document.querySelector(${JSON.stringify(containerSelector)});
      if (!root) return null;

      const interactive = root.querySelectorAll(
        'button, a[href], input, select, textarea, [role="slider"], [role="button"], [role="tab"], [role="link"], [role="option"]'
      );

      const violations = [];
      const textLinks = [];
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
        if (rect.width + 0.5 >= ${minTargetPx} && rect.height + 0.5 >= ${minTargetPx}) continue;

        // A link whose only content is text inherits its tap area from the
        // surrounding prose, which WCAG 2.5.8 explicitly exempts.
        const isTextLink =
          node.tagName === 'A' &&
          node.hasAttribute('href') &&
          node.getAttribute('role') === null &&
          node.querySelector('img, svg, picture, canvas, video') === null &&
          (node.textContent || '').trim().length > 0;

        if (isTextLink) textLinks.push(entry);
        else violations.push(entry);
      }

      return {
        interactiveCount: interactive.length,
        violations,
        textLinks,
        smallest,
        containerOverflow: Math.max(0, root.scrollWidth - root.clientWidth),
        documentOverflow: Math.max(
          0,
          document.documentElement.scrollWidth - document.documentElement.clientWidth
        )
      };
    })()`
  );
}

/** Collects every accessible name currently exposed by the accessibility tree. */
export async function accessibleNames(session: CdpSession): Promise<string[]> {
  const tree = await session.send<{
    nodes?: Array<{ name?: { value?: string }; ignored?: boolean; role?: { value?: string } }>;
  }>('Accessibility.getFullAXTree');

  return (tree.nodes ?? [])
    .filter((node) => !node.ignored)
    .map((node) => node.name?.value ?? '')
    .filter((name) => name.length > 0);
}

export async function captureScreenshot(
  session: CdpSession,
  targetPath: string,
  width: number,
  maxHeight = 8000
): Promise<void> {
  const content = await session.send<{ cssContentSize: { height: number } }>('Page.getLayoutMetrics');
  const shot = await session.send<{ data: string }>('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: {
      x: 0,
      y: 0,
      width,
      height: Math.min(Math.ceil(content.cssContentSize.height), maxHeight),
      scale: 1
    }
  });

  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, Buffer.from(shot.data, 'base64'));
}

export interface CliArgs {
  url: string;
  chrome?: string;
  shots?: string;
}

export function parseArgs(argv: readonly string[], defaultUrl: string): CliArgs {
  const args: CliArgs = { url: defaultUrl };

  for (const arg of argv) {
    if (arg.startsWith('--url=')) args.url = arg.slice('--url='.length);
    else if (arg.startsWith('--chrome=')) args.chrome = arg.slice('--chrome='.length);
    else if (arg.startsWith('--shots=')) args.shots = arg.slice('--shots='.length);
    else if (arg.startsWith('http')) args.url = arg;
  }

  return args;
}
