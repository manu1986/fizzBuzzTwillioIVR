import { config } from '../config.js';
import { verifyKey } from '../auth/keys.js';

const PUBLIC_PREFIXES = ['/health', '/docs'];

function isPublic(url) {
  const path = url.split('?')[0];
  return PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

// onRequest hook: resolve req.userId from a Bearer / x-api-key credential.
// When auth.required is false (dev), anonymous requests run as defaultUserId.
// When true, a valid key is mandatory on non-public routes.
export function authHook() {
  return async (req, reply) => {
    if (isPublic(req.url)) return;
    const hdr = req.headers.authorization;
    const bearer = hdr && hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
    const raw = bearer || req.headers['x-api-key'] || null;
    let userId = raw ? await verifyKey(raw) : null;

    if (config.auth.required) {
      if (!userId) {
        reply.code(401).send({ error: 'invalid or missing API key' });
        return reply;
      }
    } else {
      userId = userId || config.defaultUserId;
    }
    req.userId = userId;
    return undefined;
  };
}
