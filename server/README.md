# Curio — server (Phase 0 skeleton)

Headless backend for the share-to-knowledge-graph product. Submit a URL → it's
resolved, claims are extracted, stored, and made queryable in natural language.
The future iOS app is just another client of this API. See
`../docs/reels-knowledge-graph-plan.md` for the full design.

**Runs without any API keys** (graceful degradation): extraction falls back to a
heuristic and embeddings to a deterministic hash. Add `ANTHROPIC_API_KEY`
(+ optionally `VOYAGE_API_KEY`) for real extraction and semantic search.

## Stack
Node.js 20 (ESM) · Fastify + Zod · Postgres 16 + pgvector · Anthropic SDK
(Haiku 4.5 extraction, Opus 4.8 synthesis) · Voyage embeddings (pluggable).

## Quickstart
```bash
cp .env.example .env            # optionally add keys
docker compose up -d            # Postgres + pgvector, schema auto-loaded
npm install
npm run api                     # API + Swagger UI at http://localhost:3000/docs
npm run worker                  # in a second terminal: async pipeline worker
```

## Try it
```bash
# Submit a URL and process it inline (no worker needed):
node src/cli.js submit "https://en.wikipedia.org/wiki/Denver" --sync

# Inspect the full trace (resolved content -> tier -> claims -> cost):
node src/cli.js item <item_id_from_above>

# Ask a question over your saves:
node src/cli.js query "what is there to do in Denver"
```
Or use Swagger UI at `/docs` to drive `POST /v1/items` and `POST /v1/query`.

## Endpoints
- `POST /v1/items` `{url, user_id?}` (`?sync=true` to process inline) — idempotent on content fingerprint (dedup).
- `GET  /v1/items/:id` — full trace (status, tier, cost, claims).
- `POST /v1/query` `{text, user_id?, scope?}` — grounded, cited answer + ranked results.
- `GET  /health`.

## Layout
```
src/
  config.js  db.js           # config + Postgres pool/tx
  lib/        # fingerprint (dedup key), text norm, logger
  schemas/    # Zod claim schema -> drives Claude tool-schema + validation
  sources/    # SourceConnector contract + web/OpenGraph adapter + registry
  llm/        # Anthropic (extract + synthesize), embeddings (Voyage + fallback)
  pipeline/   # process: resolve -> extract -> entity-resolve(v0) -> persist
  query/      # answer: semantic retrieval -> grounded synthesis
  routes/     # items, query, health
  server.js  worker.js  cli.js
```

## Known Phase-0 stubs (intentional — see plan)
- Entity resolution is v0 (normalized-name dedupe); real ER anchors on a Places
  API + embeddings + LLM disambiguation (§6.5).
- Query is semantic-search-only; the agentic planner + structured/aggregate/
  graph tools come in Phase 2–3 (§6.9).
- Only the web/OpenGraph connector ships; IG/TikTok adapters are added beside it.
- Extraction is T0 only; the T1/T2 escalation cascade is Phase 3 (§6.3).
