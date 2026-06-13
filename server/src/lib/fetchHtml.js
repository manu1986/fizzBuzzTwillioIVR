import { safeFetchText } from './http.js';
import { config } from '../config.js';
import { logger } from './logger.js';

// Cheap HTTP first; escalate to the stealth headless browser only when the page
// is blocked/empty AND the fallback is enabled. Mirrors the cost-tiering ethos:
// don't pay for a browser unless a plain fetch failed.
export async function getHtml(url, { headers = {}, isBlocked } = {}) {
  let text = null;
  let status = 0;
  try {
    const r = await safeFetchText(url, { headers });
    text = r.text;
    status = r.status;
  } catch (e) {
    logger.warn('http_fetch_failed', { url, err: String(e) });
  }

  const blocked = text == null || (isBlocked && isBlocked(text, status));
  if (blocked && config.browser.fallback) {
    try {
      const { renderHtml } = await import('./browser.js');
      const r = await renderHtml(url, { headers });
      return { text: r.text || '', status: r.status, rendered: true };
    } catch (e) {
      logger.warn('render_failed', { url, err: String(e) });
    }
  }
  return { text: text || '', status, rendered: false };
}
