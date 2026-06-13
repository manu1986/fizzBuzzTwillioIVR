-- Curio Phase 0 schema. Single datastore: Postgres + pgvector.
-- Geo is stored as plain lat/lng for now; swap to PostGIS in a later phase.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- A piece of content, keyed by content fingerprint (the global dedup key).
CREATE TABLE IF NOT EXISTS source (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint       text UNIQUE NOT NULL,
  platform          text,
  permalink         text,
  title             text,
  author            text,
  description       text,
  thumbnail         text,
  resolved          jsonb,                 -- raw resolver output (derivative, not the media)
  summary           text,
  status            text NOT NULL DEFAULT 'queued',  -- queued|resolving|done|error
  error             text,
  tier              text,                  -- which extractor produced the claims
  cost_usd          numeric NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS source_status_idx ON source (status, created_at);

-- Per-user provenance edge (the isolation boundary). user_id is opaque text for now.
CREATE TABLE IF NOT EXISTS user_save (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     text NOT NULL,
  source_id   uuid NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  collection  text,
  saved_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, source_id)
);

-- Canonical (deduped) entity catalog.
CREATE TABLE IF NOT EXISTS entity (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type            text NOT NULL,
  canonical_name  text NOT NULL,
  norm_name       text NOT NULL,
  location_hint   text,
  lat             double precision,
  lng             double precision,
  metadata        jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (norm_name, type)
);

-- A typed assertion extracted from one source about one entity.
CREATE TABLE IF NOT EXISTS claim (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id                uuid REFERENCES source(id) ON DELETE CASCADE,
  entity_id                uuid REFERENCES entity(id) ON DELETE SET NULL,
  attribute                text,
  value                    text,
  sentiment                text,
  recommendation_strength  real,
  category                 text,
  time_hint                text,
  embedding                vector(1024),
  created_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS claim_source_idx ON claim (source_id);
CREATE INDEX IF NOT EXISTS claim_embedding_idx ON claim USING hnsw (embedding vector_cosine_ops);

-- Phase 2: absolute event times for temporal queries ("events this Saturday").
ALTER TABLE claim ADD COLUMN IF NOT EXISTS event_start timestamptz;
ALTER TABLE claim ADD COLUMN IF NOT EXISTS event_end   timestamptz;
CREATE INDEX IF NOT EXISTS claim_event_start_idx ON claim (event_start);
CREATE INDEX IF NOT EXISTS entity_geo_idx ON entity (lat, lng);

-- Real entity resolution: geocoded place_id merge key + aliases + fuzzy index.
ALTER TABLE entity ADD COLUMN IF NOT EXISTS place_id text;
ALTER TABLE entity ADD COLUMN IF NOT EXISTS aliases  text[];
CREATE UNIQUE INDEX IF NOT EXISTS entity_place_id_uidx ON entity (place_id) WHERE place_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS entity_norm_trgm_idx ON entity USING gin (norm_name gin_trgm_ops);
