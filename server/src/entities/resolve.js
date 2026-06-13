import { normName, nameSimilarity } from '../lib/text.js';

// Tuned against eval/er-cases.json: SAME pairs >= 0.645, DIFFERENT <= 0.400.
export const NAME_SIM_THRESHOLD = 0.55;

// Pure match predicate (mirrors the DB resolver) — used by the eval harness.
// Strongest signal first: a shared geocoded place_id is authoritative.
export function entitiesMatch(a, b, threshold = NAME_SIM_THRESHOLD) {
  if (a.place_id && b.place_id) return a.place_id === b.place_id;
  if ((a.type || null) !== (b.type || null)) return false;
  if (normName(a.name) === normName(b.name)) return true;
  return nameSimilarity(a.name, b.name) >= threshold;
}

// Resolve a claim's entity to a canonical row inside a transaction.
// Ladder (plan §6.5): place_id -> exact norm/alias -> trigram fuzzy -> create.
export async function resolveEntity(client, { name, type, location_hint, geo }) {
  const norm = normName(name);

  // 1) Authoritative merge by geocoded place_id.
  if (geo?.place_id) {
    const byPlace = await client.query('select id from entity where place_id=$1', [geo.place_id]);
    if (byPlace.rows[0]) {
      await addAlias(client, byPlace.rows[0].id, norm);
      return byPlace.rows[0].id;
    }
  }

  // 2) Exact normalized name or known alias (same type).
  const exact = await client.query(
    'select id, place_id from entity where type=$1 and (norm_name=$2 or $2 = any(coalesce(aliases, array[]::text[]))) limit 1',
    [type, norm],
  );
  if (exact.rows[0]) {
    if (geo?.place_id && !exact.rows[0].place_id) {
      await client.query('update entity set place_id=$2, lat=coalesce(lat,$3), lng=coalesce(lng,$4) where id=$1', [
        exact.rows[0].id, geo.place_id, geo.lat ?? null, geo.lng ?? null,
      ]);
    }
    return exact.rows[0].id;
  }

  // 3) Fuzzy trigram match (same type) above threshold.
  const fuzzy = await client.query(
    'select id from entity where type=$1 and similarity(norm_name,$2) >= $3 order by similarity(norm_name,$2) desc limit 1',
    [type, norm, NAME_SIM_THRESHOLD],
  );
  if (fuzzy.rows[0]) {
    await addAlias(client, fuzzy.rows[0].id, norm);
    return fuzzy.rows[0].id;
  }

  // 4) Create a new canonical entity.
  const created = await client.query(
    `insert into entity(type, canonical_name, norm_name, location_hint, lat, lng, place_id, aliases)
     values($1,$2,$3,$4,$5,$6,$7, array[$3])
     on conflict (norm_name, type) do update set place_id = coalesce(entity.place_id, excluded.place_id)
     returning id`,
    [type, name, norm, location_hint, geo?.lat ?? null, geo?.lng ?? null, geo?.place_id ?? null],
  );
  return created.rows[0].id;
}

async function addAlias(client, id, alias) {
  await client.query(
    `update entity set aliases = (
       select array(select distinct a from unnest(coalesce(aliases, array[]::text[]) || array[$2]) a)
     ) where id=$1`,
    [id, alias],
  );
}
