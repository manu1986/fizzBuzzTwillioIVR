import net from 'node:net';
import { config } from '../config.js';
import { logger } from './logger.js';
import { isPrivateIp } from './net.js';

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

let browserPromise = null;

// Lazy, shared, stealth browser. Imports are dynamic so the app runs fine when
// playwright isn't installed (renderHtml just throws and callers fall back).
async function getBrowser() {
  if (browserPromise) return browserPromise;
  browserPromise = (async () => {
    const { chromium } = await import('playwright-extra');
    const stealth = (await import('puppeteer-extra-plugin-stealth')).default;
    chromium.use(stealth());
    const opts = {
      headless: true,
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
    };
    if (config.browser.proxy) opts.proxy = { server: config.browser.proxy };
    return chromium.launch(opts);
  })().catch((e) => {
    browserPromise = null;
    throw e;
  });
  return browserPromise;
}

// Abort any sub-request to a non-http(s) scheme or a private/literal-IP host —
// keeps the browser from being an SSRF vector via redirects/embeds.
function guardRoute(route) {
  try {
    const u = new URL(route.request().url());
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || (net.isIP(host) && isPrivateIp(host))) {
      return route.abort();
    }
  } catch {
    return route.abort();
  }
  return route.continue();
}

export async function renderHtml(rawUrl, { timeoutMs = config.browser.timeoutMs, waitUntil = 'domcontentloaded' } = {}) {
  const url = new URL(rawUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('only http(s) URLs are allowed');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && isPrivateIp(host)) throw new Error(`blocked private IP literal: ${host}`);

  const browser = await getBrowser();
  const ctx = await browser.newContext({ userAgent: BROWSER_UA, locale: 'en-US', viewport: { width: 1280, height: 800 } });
  try {
    const page = await ctx.newPage();
    await page.route('**/*', guardRoute);
    await page.goto(url.toString(), { timeout: timeoutMs, waitUntil });
    const text = await page.content();
    return { status: 200, text };
  } finally {
    await ctx.close();
  }
}

export async function closeBrowser() {
  if (!browserPromise) return;
  try {
    const b = await browserPromise;
    await b.close();
  } catch {
    /* ignore */
  }
  browserPromise = null;
}

// True if the stealth browser stack is installed (for /health + diagnostics).
export async function browserAvailable() {
  try {
    await import('playwright-extra');
    await import('puppeteer-extra-plugin-stealth');
    return true;
  } catch {
    return false;
  }
}
