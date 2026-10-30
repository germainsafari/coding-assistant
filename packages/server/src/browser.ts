// A single shared headless Chromium session (via Playwright) that both the agent
// (browser_* tools) and the UI's Browser panel drive. The UI sees it as a stream
// of screenshots with click/type/scroll controls.
import type { Browser, BrowserContext, Page } from 'playwright';
import { htmlToMarkdown } from './tools/web.ts';

export const VIEWPORT = { width: 1280, height: 800 };

let browser: Browser | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;
let launching: Promise<Page> | null = null;
let launchedWith = '';
let version = 0;
const listeners = new Set<() => void>();

export function onBrowserChange(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function changed() {
  version++;
  for (const l of listeners) l();
}
export const browserVersion = () => version;

async function launch(): Promise<Page> {
  const { chromium } = await import('playwright');
  const attempts: { label: string; opts: any }[] = [
    { label: 'bundled chromium', opts: {} },
    { label: 'Google Chrome', opts: { channel: 'chrome' } },
    { label: 'Microsoft Edge', opts: { channel: 'msedge' } },
  ];
  const errors: string[] = [];
  for (const a of attempts) {
    try {
      browser = await chromium.launch({ headless: true, ...a.opts });
      launchedWith = a.label;
      break;
    } catch (e) {
      errors.push(`${a.label}: ${(e as Error).message.split('\n')[0]}`);
    }
  }
  if (!browser) {
    throw new Error(
      `Could not start a browser. Run "npm run setup:browser" (downloads Playwright Chromium) or install Chrome/Edge.\n${errors.join('\n')}`,
    );
  }
  context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, storageState: undefined, acceptDownloads: false });
  page = await context.newPage();
  page.on('framenavigated', (f) => {
    if (f === page?.mainFrame()) changed();
  });
  page.on('load', changed);
  browser.on('disconnected', () => {
    browser = null;
    context = null;
    page = null;
  });
  return page;
}

export async function getPage(): Promise<Page> {
  if (page && !page.isClosed()) return page;
  if (!launching) launching = launch().finally(() => (launching = null));
  return launching;
}

export function browserInfo() {
  return { running: !!page, engine: launchedWith, url: page?.url() ?? null, viewport: VIEWPORT, version };
}

function normalizeUrl(url: string) {
  if (/^[a-z]+:\/\//i.test(url) || url.startsWith('about:')) return url;
  if (/^(localhost|127\.0\.0\.1)(:\d+)?/.test(url)) return 'http://' + url;
  return 'https://' + url;
}

export async function navigate(url: string) {
  const p = await getPage();
  const res = await p.goto(normalizeUrl(url), { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await p.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
  changed();
  return { url: p.url(), status: res?.status() ?? null, title: await p.title() };
}

export async function screenshot(quality = 60): Promise<Buffer> {
  const p = await getPage();
  return p.screenshot({ type: 'jpeg', quality, timeout: 15_000 });
}

export async function clickAt(x: number, y: number) {
  const p = await getPage();
  await p.mouse.click(x, y);
  await settle(p);
}

export async function clickTarget(t: { selector?: string; text?: string; x?: number; y?: number }) {
  const p = await getPage();
  if (t.selector) await p.locator(t.selector).first().click({ timeout: 8000 });
  else if (t.text) await p.getByText(t.text, { exact: false }).first().click({ timeout: 8000 });
  else if (t.x !== undefined && t.y !== undefined) await p.mouse.click(t.x, t.y);
  else throw new Error('Provide selector, text, or x/y coordinates.');
  await settle(p);
}

export async function typeText(text: string, opts: { selector?: string; submit?: boolean; clear?: boolean } = {}) {
  const p = await getPage();
  if (opts.selector) {
    const loc = p.locator(opts.selector).first();
    if (opts.clear !== false) await loc.fill(text, { timeout: 8000 });
    else await loc.pressSequentially(text, { timeout: 8000 });
  } else {
    await p.keyboard.type(text, { delay: 5 });
  }
  if (opts.submit) await p.keyboard.press('Enter');
  await settle(p);
}

export async function pressKey(key: string) {
  const p = await getPage();
  await p.keyboard.press(key);
  await settle(p);
}

export async function scroll(dy: number) {
  const p = await getPage();
  await p.mouse.wheel(0, dy);
  await new Promise((r) => setTimeout(r, 250));
  changed();
}

export async function history(dir: 'back' | 'forward' | 'reload') {
  const p = await getPage();
  if (dir === 'back') await p.goBack({ timeout: 15_000 }).catch(() => {});
  else if (dir === 'forward') await p.goForward({ timeout: 15_000 }).catch(() => {});
  else await p.reload({ timeout: 15_000 }).catch(() => {});
  changed();
}

async function settle(p: Page) {
  await p.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 400));
  changed();
}

export async function readPage(selector?: string): Promise<{ url: string; title: string; text: string; links: string[] }> {
  const p = await getPage();
  const html = selector ? await p.locator(selector).first().innerHTML({ timeout: 8000 }) : await p.content();
  const links: string[] = await p
    .$$eval('a[href]', (as) =>
      as
        .slice(0, 60)
        .map((a) => `${(a.textContent || '').trim().slice(0, 60)} -> ${(a as HTMLAnchorElement).href}`)
        .filter((s) => s.length > 4),
    )
    .catch(() => []);
  return { url: p.url(), title: await p.title(), text: htmlToMarkdown(html), links };
}

/** Interactive elements with their centers, so the model can click by coordinates or selector. */
export async function interactiveElements(): Promise<string> {
  const p = await getPage();
  const els = await p
    .$$eval('a, button, input, textarea, select, [role=button], [onclick]', (nodes) =>
      nodes
        .map((n) => {
          const r = (n as HTMLElement).getBoundingClientRect();
          if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > window.innerHeight) return null;
          const el = n as HTMLInputElement;
          const label = (el.innerText || el.value || el.placeholder || el.getAttribute('aria-label') || el.name || '').trim().slice(0, 50);
          const id = el.id ? `#${el.id}` : '';
          return `${n.tagName.toLowerCase()}${id}${el.type ? `[type=${el.type}]` : ''} "${label}" @(${Math.round(r.x + r.width / 2)},${Math.round(r.y + r.height / 2)})`;
        })
        .filter(Boolean)
        .slice(0, 80),
    )
    .catch(() => [] as (string | null)[]);
  return els.join('\n');
}

export async function closeBrowser() {
  await browser?.close().catch(() => {});
  browser = null;
  page = null;
  context = null;
}