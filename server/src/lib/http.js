import net from 'node:net';
import { ssrfSafeAgent, isPrivateIp } from './net.js';

const DEFAULT_MAX_BYTES = 2_000_000; // cap response size
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;

// Literal IPs skip DNS, so the agent's connect-time lookup never runs for them.
// Check literal-IP hosts explicitly; hostnames are covered by ssrfSafeAgent.
function assertHostAllowed(url) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('only http(s) URLs are allowed');
  }
  const host = url.hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  if (net.isIP(host) && isPrivateIp(host)) {
    throw new Error(`blocked private IP literal: ${host}`);
  }
}

async function readCapped(res, maxBytes) {
  const reader = res.body?.getReader?.();
  if (!reader) {
    const t = await res.text();
    return t.slice(0, maxBytes);
  }
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.length;
    chunks.push(Buffer.from(value));
    if (received > maxBytes) break;
  }
  return Buffer.concat(chunks).toString('utf8');
}

// SSRF-safe fetch of user-supplied URLs: http(s) only; private targets blocked
// at every hop (literal-IP check + connect-time DNS guard for hostnames, which
// also defeats DNS rebinding); manual redirect following so each Location is
// re-validated; hard timeout; response size cap.
export async function safeFetchText(rawUrl, opts = {}) {
  const { maxBytes = DEFAULT_MAX_BYTES, timeoutMs = DEFAULT_TIMEOUT_MS, headers = {} } = opts;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let current = new URL(rawUrl);
    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      assertHostAllowed(current);
      const res = await fetch(current, {
        headers,
        redirect: 'manual',
        signal: ctrl.signal,
        dispatcher: ssrfSafeAgent,
      });
      const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (loc) {
        current = new URL(loc, current); // resolve relative redirects
        continue;
      }
      return { status: res.status, text: await readCapped(res, maxBytes) };
    }
    throw new Error('too many redirects');
  } finally {
    clearTimeout(timer);
  }
}
