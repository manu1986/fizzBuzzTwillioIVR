import * as cheerio from 'cheerio';
import { parseInstagramUrl } from '../lib/platforms.js';
import { safeFetchText } from '../lib/http.js';
import { logger } from '../lib/logger.js';

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const txt = ($, sel) => {
  const t = $(sel).first().text();
  return t ? t.trim() : null;
};

// Parse Instagram's /embed/captioned/ page (no login required). Class names
// shift over time, so try several selectors plus a JSON-blob fallback.
export function extractFromEmbed(html) {
  const $ = cheerio.load(html);
  let author = txt($, '.Username') || txt($, '.UsernameText') || txt($, '[class*="Username"]');
  let caption = txt($, '.Caption') || txt($, '[class*="Caption"]');
  let thumbnail = $('img.EmbeddedMediaImage').attr('src') || $('meta[property="og:image"]').attr('content') || null;
  if (!caption) {
    const m = html.match(/"caption"\s*:\s*"((?:\\.|[^"\\])*)"/);
    if (m) { try { caption = JSON.parse(`"${m[1]}"`); } catch { /* ignore */ } }
  }
  // The .Caption block often repeats the username as a prefix — strip it.
  if (caption && author && caption.startsWith(author)) caption = caption.slice(author.length).trim();
  return { caption: caption || null, author: author || null, thumbnail };
}

// Fallback: OpenGraph tags from the main page.
export function extractFromOg(html) {
  const $ = cheerio.load(html);
  const og = (n) => $(`meta[property="og:${n}"]`).attr('content') || null;
  const title = og('title');
  const description = og('description');
  let author = null;
  const m = (title || '').match(/^(.*?)\s+on Instagram/i);
  if (m) author = m[1];
  return { caption: description || title || null, author, thumbnail: og('image') };
}

export const instagramConnector = {
  platform: 'instagram',
  matches: (url) => !!parseInstagramUrl(url),
  async resolve(url) {
    const ig = parseInstagramUrl(url);
    const permalink = ig?.canonical || url;
    const headers = { 'User-Agent': BROWSER_UA, 'Accept-Language': 'en-US,en;q=0.9' };

    let caption = null;
    let author = null;
    let thumbnail = null;
    let strategy = 'none';

    // Strategy 1: embed/captioned (most reliable no-auth caption).
    if (ig) {
      try {
        const res = await safeFetchText(ig.embed, { headers });
        const e = extractFromEmbed(res.text);
        ({ caption, author, thumbnail } = e);
        if (caption) strategy = 'embed';
      } catch (err) {
        logger.warn('ig_embed_failed', { url: permalink, err: String(err) });
      }
    }

    // Strategy 2: OpenGraph from the canonical page.
    if (!caption || !thumbnail || !author) {
      try {
        const res = await safeFetchText(permalink, { headers });
        const o = extractFromOg(res.text);
        caption = caption || o.caption;
        author = author || o.author;
        thumbnail = thumbnail || o.thumbnail;
        if (strategy === 'none' && caption) strategy = 'og';
      } catch (err) {
        logger.warn('ig_og_failed', { url: permalink, err: String(err) });
      }
    }

    const text = (caption || '').slice(0, 8000);
    const title = caption ? caption.split('\n')[0].slice(0, 140) : author ? `Instagram post by ${author}` : 'Instagram post';
    return {
      platform: 'instagram',
      permalink,
      title,
      author,
      description: caption,
      site: 'Instagram',
      text,
      thumbnail,
      raw: { strategy, shortcode: ig?.shortcode || null },
    };
  },
};
