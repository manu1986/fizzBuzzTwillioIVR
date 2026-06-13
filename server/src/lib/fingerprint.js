import crypto from 'node:crypto';

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

export function fingerprint(raw) {
  return crypto.createHash('sha256').update(normalizeUrl(raw)).digest('hex');
}
