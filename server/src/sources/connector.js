// SourceConnector contract (plan §6.2 / D2). Each platform is one adapter.
// Swapping a scraper for an official API later is a one-adapter change.
//
//   matches(url): boolean
//   resolve(url): Promise<{
//     platform, permalink, title, author, description, site,
//     text,          // derived text used for extraction
//     thumbnail,     // by-reference (we do NOT store the media)
//     raw            // small metadata bag for the trace
//   }>
export const detectPlatform = (url) => {
  let h = '';
  try { h = new URL(url).hostname; } catch { return 'web'; }
  if (/instagram\./.test(h)) return 'instagram';
  if (/tiktok\./.test(h)) return 'tiktok';
  if (/(youtube\.|youtu\.be)/.test(h)) return 'youtube';
  if (/(twitter|x)\.com/.test(h)) return 'x';
  return 'web';
};
