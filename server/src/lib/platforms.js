// Pure, dependency-free platform URL parsing. Kept separate so both the
// fingerprint (dedup key) and the source connectors can share it.

// YouTube watch/shorts/youtu.be/embed URLs -> { videoId, canonical }. All forms
// of the same video id canonicalize identically (and dedupe).
export function parseYouTubeUrl(raw) {
  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^www\.|^m\./, '').toLowerCase();
    let id = null;
    if (host === 'youtu.be') {
      id = u.pathname.slice(1).split('/')[0];
    } else if (host === 'youtube.com') {
      if (u.pathname === '/watch') id = u.searchParams.get('v');
      else {
        const m = u.pathname.match(/\/(?:shorts|embed|v|live)\/([A-Za-z0-9_-]+)/);
        if (m) id = m[1];
      }
    }
    if (!id || !/^[A-Za-z0-9_-]{6,}$/.test(id)) return null;
    return { videoId: id, canonical: `https://www.youtube.com/watch?v=${id}` };
  } catch {
    return null;
  }
}

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
