import * as cheerio from 'cheerio';
import { detectPlatform } from './connector.js';

// Web / OpenGraph adapter — the safe first rung of the resolution ladder
// (plan §6.2). Works for articles and gives title/thumbnail/author for most
// platforms via OG tags. Used as the fallback connector for everything in
// Phase 0; IG/TikTok-specific adapters slot in beside it later.
export const webConnector = {
  platform: 'web',
  matches: () => true,
  async resolve(url) {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CurioBot/0.1)' },
      redirect: 'follow',
    });
    const html = await res.text();
    const $ = cheerio.load(html);
    const meta = (sel) => $(sel).attr('content') || null;
    const og = (name) =>
      meta(`meta[property="og:${name}"]`) || meta(`meta[name="og:${name}"]`) || meta(`meta[name="twitter:${name}"]`);

    const title = og('title') || $('title').first().text().trim() || null;
    const description = og('description') || meta('meta[name="description"]') || null;
    const site = og('site_name') || null;
    const author = meta('meta[name="author"]') || og('article:author') || null;
    const thumbnail = og('image') || null;

    const bodyText =
      $('article').text().trim() ||
      $('p').map((_, el) => $(el).text()).get().join(' ');
    const text = [title, description, bodyText].filter(Boolean).join('\n').replace(/\s+/g, ' ').slice(0, 8000);

    return {
      platform: detectPlatform(url),
      permalink: url,
      title,
      author,
      description,
      site,
      text,
      thumbnail,
      raw: { httpStatus: res.status, hadOg: Boolean(og('title') || og('description')) },
    };
  },
};
