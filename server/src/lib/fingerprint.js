import crypto from 'node:crypto';
import { parseInstagramUrl } from './platforms.js';

const TRACKING = /^(utm_|ig_|igsh$|igshid$|fbclid$|gclid$|si$|feature$)/i;

// Normalize a shared URL so the same content shared from different places
// collapses to one fingerprint (the global dedup key — plan §6.4).
export function normalizeUrl(raw) {
  try {
    const u = new URL(String(raw).trim());
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) {
      if (TRACKING.test(k)) u.searchParams.delete(k);
    }
    u.hostname = u.hostname.replace(/^www\./, '').toLowerCase();
    u.pathname = u.pathname.replace(/\/+$/, '') || '/';
    return u.toString();
  } catch {
    return String(raw).trim();
  }
}

// Platform-aware canonicalization so the same content shared via different URL
// shapes (e.g. instagram /reel/ vs /p/) collapses to one fingerprint.
export function canonicalContentUrl(raw) {
  const ig = parseInstagramUrl(raw);
  if (ig) return ig.canonical;
  return normalizeUrl(raw);
}

export function fingerprint(raw) {
  return crypto.createHash('sha256').update(canonicalContentUrl(raw)).digest('hex');
}
