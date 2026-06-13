import dns from 'node:dns';
import net from 'node:net';
import { Agent } from 'undici';

// Block private / loopback / link-local / metadata addresses. Used at *connect*
// time so it also covers redirects and DNS-rebinding (the IP we dial is checked,
// not just the hostname we were given).
export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local + cloud metadata (169.254.169.254)
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  const lower = String(ip).toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('::ffff:')) return isPrivateIp(lower.replace('::ffff:', ''));
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique-local
  if (lower.startsWith('fe80')) return true; // link-local
  return false;
}

function safeLookup(hostname, options, cb) {
  dns.lookup(hostname, options, (err, address, family) => {
    if (err) return cb(err);
    if (isPrivateIp(address)) return cb(new Error(`blocked private address for host ${hostname}`));
    return cb(null, address, family);
  });
}

// Dispatcher that validates every TCP connection target. Reuse it for all
// outbound fetches of user-supplied URLs.
export const ssrfSafeAgent = new Agent({
  connect: { lookup: safeLookup, timeout: 8000 },
  headersTimeout: 8000,
  bodyTimeout: 12000,
});
