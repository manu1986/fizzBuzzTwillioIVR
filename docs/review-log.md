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

---

## Review R5 — Extraction escalation cascade (T0→T1→T2)

**Panel:** ML/Applied-AI, Cost/Finance, SRE.

`pipeline/extract.js`: run T0 (Haiku 4.5), score the result, escalate to T1
(Sonnet 4.6) then T2 (Opus 4.8) only while confidence < threshold (0.6), keeping
the best-scoring result and summing cost. High-value sources (saved by ≥ N users)
start a tier higher. `extractClaims` is now model-parameterized; the eval harness
runs through the cascade and reports per-fixture tier + cost.

### Findings → Fixed / verified
- **Confidence scorer gates as intended** — unit-tested: empty extraction 0.00, sparse 0.30 (< 0.6 → escalate), rich 1.00 (→ stop at T0). So cheap/clear content stays on Haiku; thin/ambiguous content escalates. **Verified** here.
- Best-result-wins across tiers (a higher tier scoring lower can't regress the output).

### Residual (tracked)
- **[Med] "T2" is Opus-on-text, not yet vision.** Plan §6.3's T2 samples video keyframes (multimodal). Current cascade escalates the *model* but not the *modality* — true frame/vision extraction is a later phase (and needs the on-device/connector media path).
- **[Med] Confidence threshold is heuristic, not calibrated.** Once a key is available, validate that escalation actually raises eval **F1** (and tune 0.6) — otherwise we may pay for escalation that doesn't help, or stop too early.
- **[Med] Batch API not used.** Plan calls for the Batch API (−50%) on non-interactive T0/T1; we currently use sync `messages.create`. Move bulk extraction to batches.
- **[Low] Escalation re-runs from scratch** (no reuse of the T0 output as a hint) — cost of escalating = sum of tiers. Acceptable; could feed the lower tier's draft to the higher tier.
- **[Low] Virality is sampled once.** Popularity-based start-tier is computed at first processing; a reel that goes viral later won't re-escalate without a reprocess trigger.
- Extraction-quality lift **unmeasured in this sandbox** (no LLM key); the gating logic is unit-verified and the harness is ready to measure it with a key.

---

## Review R6 — Prod hardening: auth, rate limiting, privacy

**Panel:** Security, SRE, Privacy/Compliance, Backend.

Added API-key auth (`auth/keys.js`, `plugins/auth.js`): `Authorization: Bearer`
or `x-api-key` → hashed lookup → `req.userId`. Off by default for local dev
(runs as `defaultUserId`); `AUTH_REQUIRED=true` enforces a valid key on non-public
routes. Per-user rate limiting via `@fastify/rate-limit` (keyed on `req.userId`,
applied to `/v1/items` + `/v1/query` + `/v1/me*`). GDPR/CCPA endpoints
`GET /v1/me/export` and `DELETE /v1/me`. `mintkey` CLI command. 256 KB body cap.

### Findings → Fixed / verified
- **[Security] Body `user_id` was trust-on-input** — any caller could act as another user. → routes now derive the user **only** from auth (`req.userId`); `user_id` removed from request bodies.
- **[Security] Keys hashed at rest** (SHA-256); raw key shown once at mint; revoke supported.
- **Auth hook ordering** — registered before the rate-limit plugin so `req.userId` is set before rate-limit keys on it; public-path allowlist (`/health`, `/docs`) verified. **Verified** by inject test: no-key → 401, `/health` + `/docs/json` stay open.
- **[Privacy] Erasure semantics**: `DELETE /v1/me` drops the user's saves then deletes now-orphaned sources (cascading claims); sources still saved by others are retained (shared catalog). Export returns the user's saves + their claims.

### Residual (tracked)
- **[Med] Rate-limit store is in-process** — per-instance, not shared; use the plugin's Redis store for multi-instance correctness.
- **[Med] Token hashing is plain SHA-256** (fine for high-entropy random keys); if keys ever become low-entropy, move to a slow KDF. No key rotation/expiry UX yet.
- **[Med] Erasure doesn't purge orphaned entities or geocode cache**, and there's no audit-log of deletions — add for full compliance.
- **[Low] No per-route scopes/roles** (all keys equal); add scopes before multi-tenant/community.
- DB-backed auth paths (valid-key lookup, export/delete) **unverified end-to-end** (no Postgres in sandbox); the 401 path and hook ordering are verified.

---

## Review R7 — Instagram connector (Strategy A, no official API)

**Panel:** Backend, Security, Legal/ToS, Data, SRE.

First real source connector (`sources/instagram.js`). Resolves a reel's content
straight from the URL — no official API, per the chosen Strategy A. Ladder:
**`/embed/captioned/` (no-auth caption) → OpenGraph fallback**, browser UA, routed
through the SSRF-safe fetch. Pure parsers (`parseInstagramUrl`, `extractFromEmbed`,
`extractFromOg`) factored out and unit-tested. Content fingerprint is now
**shortcode-aware** (`lib/platforms.js`): `/reel/`, `/p/`, `/tv/` + tracking
params dedupe to one entry. Registered ahead of the web catch-all.

### Findings → Fixed / verified
- **[Data] Cross-shape dedup**: reel/p/tv of the same shortcode now share a fingerprint → processed once, fanned out. **Verified** by unit test.
- **[SRE] Never hard-fails**: both strategies are wrapped; a block/login-wall degrades to OG, then to a minimal record (heuristic extraction downstream) rather than erroring the save. **Verified** (parsers tested on sample HTML incl. JSON-blob fallback).
- **[Security] Reuses `safeFetchText`** — SSRF guard, timeout, size cap apply to IG fetches too.

### Residual (tracked) — and the honest risk picture
- **[High — accepted by decision] ToS / brittleness.** This scrapes Instagram (Strategy A): it violates IG's Terms, will break when their HTML/markup changes, and can be rate-limited or login-walled (esp. server IPs / datacenter ranges). Accepted for now per the product decision; the connector is isolated behind the `SourceConnector` interface so it can be swapped without touching the pipeline.
- **[High] Real-world success rate unknown.** Selectors (`.Caption`, `.Username`) are best-effort and historically volatile; the embed endpoint may not always return the caption. Needs monitoring of the `raw.strategy` field (embed/og/none) success-rate and alerting when it drops — the §6.2 circuit-breaker.
- **[Med] No video/audio understanding** — caption + thumbnail only (text path). True reel comprehension (ASR/OCR/frames) needs the media path (on-device or a media fetch), deferred.
- **[Med] Block resilience**: no proxy rotation / backoff-on-block / caching of the fetched HTML yet; add before any volume.
- **Live IG fetch unverified** (sandbox has no/blocked network to IG; IG blocks datacenter IPs anyway). All pure parsing is unit-verified; the network behavior is the real-world unknown.

---

## Review R8 — YouTube connector (Strategy A, no official API)

**Panel:** Backend, ML/Applied-AI, Security, SRE.

`sources/youtube.js`: resolves the watch page (no API key). Parses
`ytInitialPlayerResponse` (brace-balanced JSON slicer) for title/author/
description **and the caption-track URL**, then fetches the `timedtext` track and
parses it into a **real transcript** — far richer than IG's caption-only path,
which materially improves extraction quality for video. OpenGraph fallback;
browser UA; SSRF-safe fetch. Pure parsers unit-tested (13 cases). Fingerprint is
videoId-aware (watch / youtu.be / shorts dedupe). Registered before web.

### Findings → Fixed / verified
- **[ML] Transcript path** gives spoken content (not just a title) → better claims. **Verified**: `extractYouTubeWatch` pulls videoDetails + en caption URL; `parseTimedText` decodes entities to clean text.
- **[Data] videoId dedup** across watch/youtu.be/shorts + tracking params. **Verified**.
- **[SRE] Degrades gracefully** — watch-page or caption failure falls back to OG / minimal record, never throws.
- **[Security] Reuses `safeFetchText`** for both the page and the caption URL.

### Residual (tracked)
- **[High — accepted] ToS / brittleness** (same posture as IG): scraping the watch page + `ytInitialPlayerResponse` is unofficial and breaks when YouTube changes markup; datacenter IPs may get consent/bot walls. Isolated behind the connector interface.
- **[Med] Auto-captions / language**: picks the first `en*` track else the first available; no translation, and auto-generated captions can be noisy. No transcript chunking for very long videos (text capped at 12k chars).
- **[Med] No bot-wall handling** (cookie consent / "verify you're human") — add detection + fallback before volume.
- **Live fetch unverified** (no network in sandbox); all parsing is unit-verified.

---

## Review R9 — Stealth headless-browser fallback

**Panel:** Backend, Security, SRE, Legal/ToS.

Added a **fallback** rendering path (`lib/browser.js` + `lib/fetchHtml.js`):
cheap HTTP first, escalate to a **stealth headless browser** (`playwright-extra`
+ `puppeteer-extra-plugin-stealth`) only when a page is login/bot-walled or empty.
Feature-flagged (`BROWSER_FALLBACK`), **lazy-loaded** (optional deps — app runs
without them), residential-proxy support (`BROWSER_PROXY`), SSRF-guarded
(pre-nav literal-IP check + per-request route abort to private hosts/non-http),
shared browser closed on shutdown, surfaced in `/health`. IG/YouTube connectors
now fetch via `getHtml` with per-platform block predicates; resolution tags
`embed+render` / `og+render` when the browser was used.

### Findings → Fixed / verified
- **Cost-aware**: a browser is only launched when a plain fetch is blocked — no browser per request. **Verified**: `getHtml` returns the HTTP result and never launches when `BROWSER_FALLBACK=false`.
- **Graceful absence**: `browserAvailable()` is false (playwright not installed) and `getHtml` degrades without throwing. **Verified** here.
- **Block predicates** (`isBlockedInstagram` / `isBlockedYouTube`) unit-tested (login/consent walls + content-less pages → blocked; good pages → not).
- **SSRF**: browser pre-checks the nav host and aborts sub-requests to private/literal-IP/non-http.

### Residual (tracked) — and an honest reality check
- **"Undetectable" is aspirational, not guaranteed.** Stealth reduces fingerprinting but doesn't defeat modern anti-bot (Meta/Google). The real lever is a **residential proxy** (`BROWSER_PROXY`) + low request rates; datacenter IPs get walled even with a headless browser.
- **Instagram reels often require an authenticated session** even in a browser — public render may still hit a login wall. Logged-in cookie/session injection + CAPTCHA handling are **not** implemented (and raise their own ToS/account-ban issues).
- **YouTube consent wall** isn't auto-dismissed (no consent-cookie/click flow yet) — would need a small interaction step.
- **Resource safety**: one shared browser, a context per call, but **no concurrency cap/pool** — under load this can exhaust memory. Add a semaphore/context pool before volume.
- **Browser route guard is literal-IP only** — a sub-request to a hostname that resolves private isn't blocked at connect; enforce egress via the proxy/allowlist for hard isolation.
- **[Legal] Rendering doesn't change the ToS posture** — still scraping (Strategy A), now harder to detect. Same accepted-risk + swappable-connector stance.
- **Unverified end-to-end**: playwright isn't installed/runnable in this sandbox (no browser binaries / no network). All glue (flagging, lazy-load, SSRF pre-check, block predicates, graceful degrade) is verified; the actual render + evasion is the real-world unknown. Install: `npm i playwright-extra puppeteer-extra-plugin-stealth playwright && npx playwright install chromium`.
