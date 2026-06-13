import { webConnector } from './web.js';
import { instagramConnector } from './instagram.js';
import { youtubeConnector } from './youtube.js';

// Registry. Order matters — first match wins; webConnector is the catch-all.
const connectors = [instagramConnector, youtubeConnector, webConnector];

export function resolveConnector(url) {
  return connectors.find((c) => c.matches(url)) || webConnector;
}
