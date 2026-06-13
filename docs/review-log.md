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

---

## Review R3 — Eval harness (`npm run eval`)

**Panel:** ML/Applied-AI, Data, DevEx.

The harness is the measurement backbone: golden fixtures + a scorer that reports
**extraction** precision/recall/F1, **entity-resolution keying** accuracy
(against labeled merge/split cases, vs the §6.5 0.85 guard), and end-to-end
**query recall** (with `--full` + DB). Runs offline: ER keying always; extraction
when `ANTHROPIC_API_KEY` is set; query eval with `--full` and a reachable DB.
`--strict` exits non-zero below target (CI gate). Writes `eval/last-report.json`.

### Findings → Fixed / verified
- **It immediately surfaced the top risk with a number:** first run reported ER keying **71.4%** (below 0.85), failing on `"The Denver Art Museum"` (leading article) and `"Tavernetta Restaurant"` (suffix). Exactly the v0 limitation, now quantified.
- **[Fixed] Leading-article normalization.** `normName` now strips a leading `the/a/an` (genuine dedup noise, low false-merge risk). Re-run: ER keying **85.7% — PASS**, with one honest residual. **Verified** by running the harness here.

### Residual (tracked — feeds the ER phase)
- **`"Tavernetta" vs "Tavernetta Restaurant"` still splits** — needs the real ER subsystem (geocode `place_id` as merge key + embedding/fuzzy similarity), *not* more string hacks. This is the motivation for the next phase.
- **Golden set is small (3 synthetic fixtures)** — grow per query category, and add fixtures sourced from real (anonymized) shares once a connector path exists.
- **Extraction + query eval can't run in this sandbox** (no LLM key / no DB). The offline ER number is real; the rest needs a keyed + DB environment.
- **Eval `erKey` mirrors the pipeline's `(norm_name, type)` keying by hand** — both derive from the shared `normName`, so they move together, but a future ER change must update both.

---

## Review R4 — Real entity resolution

**Panel:** Data/Knowledge-graph, ML/Applied-AI, SRE.

Replaced v0 name-keying with a resolution ladder (`entities/resolve.js`,
plan §6.5): **geocoded `place_id` (authoritative) → exact norm/alias → trigram
fuzzy (Dice ≥ 0.55, tuned on the labeled set) → create**, with `aliases` capture.
Added `pg_trgm` + a unique `place_id` index, and an ER-health endpoint
`GET /v1/metrics/er` (entity count, `with_place_id_%`, merge_rate, orphan_rate,
avg claims/entity).

### Findings → Fixed / verified
- **Residual from R3 closed:** `"Tavernetta"`/`"Tavernetta Restaurant"` now merges (trigram 0.645 ≥ 0.55). ER-keying eval **100% (9/9)**, now including a `place_id` merge case and a same-name/different-`place_id` **homonym split** case. Threshold chosen empirically (SAME ≥ 0.645, DIFFERENT ≤ 0.400 — clean margin). **Verified** by running the harness.
- The eval scorer now exercises the **real** `entitiesMatch` predicate (not a stand-in), so the harness tracks the shipped logic.

### Residual (tracked)
- **[Med] No-geo homonyms.** Same name, different city, *without* a `place_id` still merges via exact-norm. `place_id` disambiguates when geocoding is on (prod); without it, fold `location_hint` into the key for places lacking `place_id`.
- **[Med] Fuzzy query is a seq scan** — `similarity() >= t` doesn't use the GIN index; switch to the `%` operator + `set_limit()` (or a per-session GUC) to use `entity_norm_trgm_idx` at scale.
- **[Med] Threshold tuned on a tiny set** — grow the labeled ER set and add a **human-in-the-loop review queue** for borderline merges (plan §6.5 calls for HITL on high-value entities).
- **[Low] Metrics are exposed but not alerted** — wire thresholds (e.g., orphan_rate spike, merge_rate collapse) into monitoring.
- **DB resolver unverified end-to-end** (no Postgres in sandbox); the pure `entitiesMatch` predicate is verified, and the SQL mirrors it.
