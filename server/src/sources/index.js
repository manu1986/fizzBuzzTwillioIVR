import { webConnector } from './web.js';
import { instagramConnector } from './instagram.js';

// Registry. Order matters — first match wins; webConnector is the catch-all.
const connectors = [instagramConnector, webConnector];

export function resolveConnector(url) {
  return connectors.find((c) => c.matches(url)) || webConnector;
}
