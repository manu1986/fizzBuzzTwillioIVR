// Pure, dependency-free platform URL parsing. Kept separate so both the
// fingerprint (dedup key) and the source connectors can share it.

// Instagram reel/post/tv URLs -> { shortcode, canonical, embed }. The shortcode
// is the real content id, so /reel/ABC, /p/ABC and /tv/ABC all canonicalize the
// same way (and therefore dedupe to one fingerprint).
export function parseInstagramUrl(raw) {
  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    if (host !== 'instagram.com' && host !== 'instagr.am') return null;
    const m = u.pathname.match(/\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/);
    if (!m) return null;
    const shortcode = m[1];
    return {
      shortcode,
      canonical: `https://www.instagram.com/p/${shortcode}/`,
      embed: `https://www.instagram.com/p/${shortcode}/embed/captioned/`,
    };
  } catch {
    return null;
  }
}
