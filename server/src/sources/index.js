import { webConnector } from './web.js';

// Registry. Order matters — first match wins; webConnector is the catch-all.
const connectors = [webConnector];

export function resolveConnector(url) {
  return connectors.find((c) => c.matches(url)) || webConnector;
}
