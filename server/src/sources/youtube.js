import * as cheerio from 'cheerio';
import { parseYouTubeUrl } from '../lib/platforms.js';
import { safeFetchText } from '../lib/http.js';
import { logger } from '../lib/logger.js';

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Slice a balanced {...} JSON object that follows a marker in a larger string
// (brace-aware, string-literal-aware) — robust to nested braces.
export function sliceBalancedJson(s, marker) {
  const i = s.indexOf(marker);
  if (i < 0) return null;
  const start = s.indexOf('{', i);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let k = start; k < s.length; k += 1) {
    const ch = s[k];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return s.slice(start, k + 1);
    }
  }
  return null;
}

// Parse the watch page: prefer ytInitialPlayerResponse.videoDetails, fall back
// to OpenGraph. Also surfaces a caption-track URL for the transcript.
export function extractYouTubeWatch(html) {
  const $ = cheerio.load(html);
  const og = (n) => $(`meta[property="og:${n}"]`).attr('content') || null;
  let title = og('title');
  let description = null;
  let author = null;
  const thumbnail = og('image');
  let captionUrl = null;

  const raw = sliceBalancedJson(html, 'ytInitialPlayerResponse');
  if (raw) {
    try {
      const j = JSON.parse(raw);
      const vd = j.videoDetails;
      if (vd) {
        title = vd.title || title;
        description = vd.shortDescription || null;
        author = vd.author || null;
      }
      const tracks = j.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (Array.isArray(tracks) && tracks.length) {
        const en = tracks.find((t) => /^en/i.test(t.languageCode || ''));
        captionUrl = (en || tracks[0]).baseUrl || null;
      }
    } catch (e) {
      logger.warn('yt_player_json_parse_failed', { err: String(e) });
    }
  }
  description = description || og('description');
  return { title, author, description, thumbnail, captionUrl };
}

// YouTube timedtext XML -> plain transcript.
export function parseTimedText(xml) {
  const parts = [...String(xml).matchAll(/<text[^>]*>(.*?)<\/text>/gs)].map((m) =>
    m[1]
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
      .trim(),
  );
  return parts.filter(Boolean).join(' ');
}

export const youtubeConnector = {
  platform: 'youtube',
  matches: (url) => !!parseYouTubeUrl(url),
  async resolve(url) {
    const yt = parseYouTubeUrl(url);
    const permalink = yt?.canonical || url;
    const headers = { 'User-Agent': BROWSER_UA, 'Accept-Language': 'en-US,en;q=0.9' };

    let meta = { title: null, author: null, description: null, thumbnail: null, captionUrl: null };
    try {
      const res = await safeFetchText(permalink, { headers });
      meta = extractYouTubeWatch(res.text);
    } catch (err) {
      logger.warn('yt_watch_failed', { url: permalink, err: String(err) });
    }

    let transcript = '';
    if (meta.captionUrl) {
      try {
        const cap = await safeFetchText(meta.captionUrl, { headers });
        transcript = parseTimedText(cap.text);
      } catch (err) {
        logger.warn('yt_caption_failed', { url: permalink, err: String(err) });
      }
    }

    const text = [meta.title, meta.description, transcript].filter(Boolean).join('\n').slice(0, 12000);
    return {
      platform: 'youtube',
      permalink,
      title: meta.title || (yt ? `YouTube video ${yt.videoId}` : 'YouTube video'),
      author: meta.author,
      description: meta.description,
      site: 'YouTube',
      text,
      thumbnail: meta.thumbnail,
      raw: { videoId: yt?.videoId || null, hasTranscript: Boolean(transcript) },
    };
  },
};
