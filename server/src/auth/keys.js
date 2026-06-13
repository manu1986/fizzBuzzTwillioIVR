import crypto from 'node:crypto';
import { pool } from '../db.js';

export function hashKey(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
}

// Mint a new key for a user. The raw key is returned once and never stored.
export async function createApiKey(userId, name = 'default') {
  const raw = `curio_${crypto.randomBytes(24).toString('base64url')}`;
  await pool.query('insert into api_key(user_id, key_hash, name) values($1,$2,$3)', [userId, hashKey(raw), name]);
  return raw;
}

// Verify a raw key -> user_id (and bump last_used_at), or null if absent/revoked.
export async function verifyKey(raw) {
  if (!raw) return null;
  const r = await pool.query(
    'update api_key set last_used_at=now() where key_hash=$1 and revoked_at is null returning user_id',
    [hashKey(raw)],
  );
  return r.rows[0]?.user_id || null;
}

export async function revokeKey(raw) {
  const r = await pool.query('update api_key set revoked_at=now() where key_hash=$1 and revoked_at is null', [hashKey(raw)]);
  return r.rowCount > 0;
}
