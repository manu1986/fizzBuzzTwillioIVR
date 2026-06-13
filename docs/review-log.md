# Counsel Review Log

Per-phase production-readiness reviews ("counsel of relevant people"). Each entry:
findings by discipline → **Fixed** in this pass vs **Residual** (tracked for a later phase).

---

## Review R1 — Phase 0 foundation (after the initial scaffold)

**Panel:** Security, SRE/Reliability, Backend, ML/Cost, DevEx.

### Findings → Fixed
- **[Security — critical] SSRF.** The resolver did `fetch()` on arbitrary user URLs → an attacker could hit `169.254.169.254` (cloud metadata), `localhost`, or internal services.
  → Added `lib/net.js` (connect-time DNS guard via an undici agent — blocks private targets for hostnames, defeating DNS rebinding) + `lib/http.js` `safeFetchText` (http(s)-only, **literal-IP check on every hop**, manual redirect re-validation, hard timeout, 2 MB response cap). Resolver now uses it. **Verified** with unit tests (metadata IP, loopback, localhost, ftp, IPv6 loopback all blocked).
- **[SRE] No timeouts / retries / graceful shutdown.** → LLM client now has `maxRetries:3` + 60 s timeout; outbound fetch has timeout + size cap; API and worker handle `SIGTERM`/`SIGINT` and drain cleanly.
- **[SRE] Health check didn't signal readiness.** → `/health` returns **503** when the DB is unreachable (load-balancer/readiness-probe friendly).
- **[Backend] `error` items were terminal.** → `POST /v1/items` re-queues a fingerprint stuck in `error`; `done` stays a pure fan-out (dedup short-circuit preserved).
- **[Backend] No schema migration path.** → idempotent `schema.sql` applied on boot via `db/migrate.js` (`IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`).
- **[Cost] Extraction system prompt re-billed every call.** → stable prompt prefix marked with `cache_control` (prompt caching).
- **[DevEx]** Added `engines: node>=20`.

### Residual (tracked)
- **AuthN/AuthZ + rate limiting** on the API — none yet (dev-only). Needed before any non-local exposure.
- **Per-user data export/delete** endpoints (GDPR/CCPA) — in the plan, not yet built.
- **Observability**: structured logs exist; no metrics/tracing/cost dashboard yet.

---

## Review R2 — Phase 2 query intelligence (planner + structured/aggregate retrieval + geo/time)

**Panel:** Data/Knowledge-graph, ML/Applied-AI, Security, Backend, Product.

### Findings → Fixed / verified
- **[Security] SQL injection surface** in the new dynamic query builder. → All user-influenced values are **bound parameters** (a `$n` builder); no string interpolation of values. Verified by reading every clause in `query/retrieval.js`.
- **[Data] Unbounded result sets / ranking limit.** → `limit` validated and clamped to 1–50 in the planner; aggregate ranking uses `support × avg_strength` with recency tiebreak.
- **[ML] Planner can mis-route or be unavailable.** → output is Zod-validated; on any failure the path falls back to a plain semantic lookup (`answer.js` `fallbackPlan`).
- **[Data] Entity geo-anchoring** added (the primary ER key): place/event entities are geocoded (Google Places, else Nominatim) and stored as `lat/lng`; aggregation/“near” queries use a haversine filter. Geocode is cached per item and `coalesce`d so existing coordinates aren't overwritten.

### Residual (tracked — next phases)
- **[High] Entity resolution is still v0** — normalized-name + geocode anchor, but no fuzzy/embedding merge and **no ER-accuracy metric** (the >85% "toxicity" guard from the plan). Needs a dedicated ER subsystem + health metrics. **This is the top quality risk.**
- **[High] No eval harness yet** — we can't yet *measure* extraction precision/recall, ER accuracy, or answer quality per query category. Recommended as the immediate next phase so refinement is data-driven, not vibes.
- **[Med] Timezone correctness** — relative dates ("this weekend") resolve in **UTC**, not the user's tz; event-time extraction has no tz context for the content. Needs a tz library (e.g. Luxon + IANA) and a per-request/user tz. Currently approximate.
- **[Med] Geocoder cache is in-process** — lost on restart, not shared across workers; Nominatim's 1 req/s throttle is process-local (multiple workers could exceed it). Move the cache to Postgres; prefer a paid Places provider in prod.
- **[Med] `scope:'all'` (community)** would expose other users' saves — remains **gated** behind the §3.2 legal review; default stays `mine`.
- **[Low] Radius not capped**; **HNSW** recall depends on row volume; **graph layer** (multi-hop) intentionally deferred per plan §6.9 / D7.

### Verified this pass (no DB required here)
✅ all files `node --check`; ✅ app boots, 4 routes + OpenAPI register; ✅ unit tests pass for SSRF guard, relative-date resolver, fingerprint dedup, and generated JSON schemas. ❌ DB-backed flow (ingest + query end-to-end) **unverified** — no Docker daemon in the build sandbox; first run on a real Postgres is the test.
