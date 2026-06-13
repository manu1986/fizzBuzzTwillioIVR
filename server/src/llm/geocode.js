import { config } from '../config.js';
import { logger } from '../lib/logger.js';

// Pluggable geocoder — the primary entity-resolution anchor (plan §6.5/D6).
// Google Places when keyed; OpenStreetMap Nominatim as a dev fallback.
// In-memory cache + light throttle keep call volume (and Nominatim's 1 req/s
// policy) in check. Production: move the cache to Postgres and prefer Places.
const cache = new Map();
let lastNominatim = 0;

async function fetchJson(url, headers = {}, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function geocode(queryText) {
  const q = String(queryText || '').trim();
  if (!q) return null;
  if (cache.has(q)) return cache.get(q);

  let result = null;
  try {
    if (config.googlePlacesApiKey) {
      const url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(q)}&inputtype=textquery&fields=geometry,name,place_id&key=${config.googlePlacesApiKey}`;
      const j = await fetchJson(url);
      const c = j?.candidates?.[0];
      if (c?.geometry?.location) {
        result = { lat: c.geometry.location.lat, lng: c.geometry.location.lng, name: c.name, place_id: c.place_id, provider: 'google' };
      }
    } else {
      // Nominatim usage policy: <=1 req/s + identifying User-Agent.
      const wait = 1100 - (Date.now() - lastNominatim);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastNominatim = Date.now();
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
      const j = await fetchJson(url, { 'User-Agent': 'CurioBot/0.1 (geocoding)' });
      const c = Array.isArray(j) ? j[0] : null;
      if (c) result = { lat: Number(c.lat), lng: Number(c.lon), name: c.display_name, place_id: `osm:${c.osm_id}`, provider: 'nominatim' };
    }
  } catch (e) {
    logger.warn('geocode_failed', { q, err: String(e) });
  }

  cache.set(q, result);
  return result;
}
