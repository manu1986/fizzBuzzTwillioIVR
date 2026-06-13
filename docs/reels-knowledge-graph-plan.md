# Share-to-Knowledge-Graph — Feature & Implementation Plan

> **Working name:** "Curio" (placeholder).
> **One-line:** Users share short-form content (Instagram Reels, TikToks, YouTube Shorts, X posts, articles…) into the app from any other app. The app understands the content, builds a queryable knowledge graph, and answers natural-language questions over it — *"20 best things to do in Denver"*, *"events in SF this Saturday"*, *"that pasta place the food reel raved about."*
> **Bar:** production-grade — scalable, cost-effective, deduplicated, generic across content types, with grounded/cited answers.

This document records (1) a validity assessment of the idea, (2) a multi-disciplinary gap review ("counsel of relevant people"), (3) the decisions that fill those gaps, and (4) a phased feature + implementation plan with a real cost model.

> **Decisions locked (2026-06-13):**
> 1. **Acquisition = server-resolve/scrape from the shared URL** (Strategy A). The app needs only the URL; the backend resolves content from it for all sources. Simplest and fully generic. *Trade-off accepted with eyes open:* violates IG/TikTok ToS, brittle to their changes, blockable, and carries copyright/CFAA exposure — see §6.2 for the mitigations that keep this survivable and swappable.
> 2. **iOS first** (Share Extension + later on-device fallback if needed).
> 3. **Personal scope first** (answers over the user's own saves; community/aggregation deferred behind legal review).
> 4. **Server-first, app-later.** Build the full headless pipeline behind a clean API now; test & refine against real URLs; the iOS app becomes a thin client on the stable API later (nothing rebuilt). See §6.8 for the chosen stack.

---

## 1. Verdict (TL;DR)

The idea is **technically buildable today and genuinely valuable**, but its difficulty is **not** where it first appears. Naively, "share a reel → AI reads it → graph" sounds like a content-understanding problem. It is actually three hard problems stacked, in this order of risk:

1. **Content acquisition is a legal/compliance problem, not an engineering one.** A share-sheet hands you a *URL*, not the video. Fetching Instagram's video/caption server-side violates Meta's Terms (and the sanctioned oEmbed Read API forbids using the content for anything but rendering an embed). This is the make-or-break constraint and the #1 thing most concepts under-weight.
2. **Entity resolution / dedup is the make-or-break for quality.** "20 best in Denver" requires collapsing thousands of mentions across many reels into canonical places, ranked. Industry consensus: if entity-resolution accuracy drops below ~85%, the graph becomes *toxic* — confidently wrong. A small accurate graph beats a large noisy one.
3. **Multimodal understanding is the expensive-but-solved problem.** Vision + ASR + OCR + LLM extraction is mature in 2026; the real game is **cost tiering and dedup** so you don't pay to process the same viral reel 10,000 times.

**Recommended strategic posture:** build it as a **personal knowledge tool first** (per-user, transformative, fair-use-leaning), with an **opt-in community layer** added deliberately and behind a legal review — because the "best things to do in Denver" global-aggregation query is exactly the use that raises republishing/IP risk. Architect for both from day one; ship the personal version first.

---

## 2. What we're actually building (precise restatement)

- **Inputs (generic):** anything shareable via the OS share sheet — Reels, TikToks, Shorts, X/Threads posts, web articles, YouTube videos, Maps links, plain text/notes. The connector layer is pluggable; new sources are adapters.
- **Processing:** extract structured **claims** from each item — entities (place / event / activity / product / media / person), attributes, geolocation, time, sentiment/recommendation strength, category, and provenance (which source said it).
- **Knowledge graph:** canonical entities (deduped, geo-anchored, time-aware) with edges to sources, users, categories, and each other.
- **Outputs:** natural-language Q&A with **synthesized, ranked, cited** answers; plus structured views (map, list, "my saves," collections).
- **Scope toggle:** answer from *my* saves vs. *community* saves (the latter gated; see §3, §4).

---

## 3. Counsel of relevant people — gap review

Each "advisor" below is a discipline lens. The **Gap** is what a first-pass plan typically misses; the **Fill** is the decision we adopt (carried into §4–§9).

### 3.1 Telephony/Platform & Mobile engineer
- **Gap:** Assuming the share sheet delivers the media. It usually delivers a **URL + optional title/thumbnail**; for some apps it can deliver an image or the video file, but Instagram typically shares a `instagram.com/reel/...` link only.
- **Gap:** Doing heavy work inside the Share Extension. iOS Share/Action extensions have **tight memory limits (~120 MB)** and must return fast or the OS kills them.
- **Fill:** Share extension does the absolute minimum — capture payload, write to a shared App Group container, enqueue, return instantly ("Saved ✓"). All understanding is async. Where the OS *does* hand us the rendered media (user is looking at it), capture it then (see 3.2).

### 3.2 Legal / Trust & Safety / IP counsel  *(highest-stakes lens)*
- **Gap:** Treating "fetch the reel's content" as a routine HTTP GET. Meta's Platform Terms prohibit scraping; the **Instagram oEmbed Read API** (the only sanctioned route since the old oEmbed retired in April 2025) returns **public content only** and explicitly forbids using the metadata/content for **any purpose other than rendering a front-end embed**. TikTok/X have similar constraints. Programmatic download risks **CFAA** (unauthorized access) and **copyright** (reproducing the creator's work).
- **Gap:** A global "best of" feed is **republishing other people's content at scale** — the highest-risk posture.
- **Fill — the central architectural decision:**
  - **Connector abstraction with a compliance gate.** Every source is a `SourceConnector` with a declared `ComplianceTier`. No connector ships without legal sign-off recorded in code/config.
  - **Prefer on-device extraction.** When the user shares from within an app they're viewing, the content is already rendered on *their* device. An **on-device pipeline** (OCR of on-screen text, on-device ASR of audio, caption capture, a small on-device VLM for a one-line scene summary) extracts *derived signals* — not a stored copy of the video — and uploads only the structured text. This sidesteps server-side scraping, is privacy-preserving, and is far cheaper at scale.
  - **Store derivatives, not copies.** Persist extracted claims, embeddings, thumbnails-by-reference (oEmbed for attribution), and a link back to the original. Don't warehouse creators' video/audio.
  - **Tiered legal posture:** personal-use single-user graph (transformative, low risk) → ships first. Community aggregation → opt-in, attribution-forward, takedown/DMCA flow, and a "we link, we don't host" stance → ships after review.
  - **Per-source policy table** documented and enforced (YouTube Data API + captions: permissive; IG: attribution/thumbnail via oEmbed only, content via on-device; etc.).

### 3.3 ML / Applied-AI engineer
- **Gap:** Sending every reel through a top-tier multimodal model. That's the cost-killer and mostly wasted (caption + on-device OCR already answer most extractions).
- **Gap:** Trusting LLM-extracted place names as canonical. "Joe's" in 50 reels is 50 different Joe's unless geo-resolved.
- **Fill:** **Three-tier extraction cascade** (§6.3) with **dedup short-circuit** (§6.4) as the dominant cost lever. **Structured-outputs JSON schema** for deterministic, parseable claims. **Geo-anchoring via a Places API is the primary entity-resolution key**, not the LLM string. Confidence-gated escalation: only ambiguous/high-value items reach the expensive tier.

### 3.4 Data / Knowledge-graph engineer
- **Gap:** Reaching for a graph database (Neo4j) on day one because "knowledge graph." Best-practice 2026 guidance: **vector RAG covers 70%+ of queries**; add a graph layer only when users consistently ask relational/aggregation questions vector search can't answer.
- **Gap:** Underinvesting in entity resolution — the single highest-leverage quality lever (>85% accuracy or the graph is toxic).
- **Fill:** **Start with Postgres + pgvector** (relational + vector + geo via PostGIS) — one system, cheap, scales far. Add a **graph layer (Apache AGE on Postgres, or Neo4j) only when relational query patterns demand it.** Treat ER as a first-class subsystem with health metrics (merge rate, orphan nodes, traversal error rate) and human-in-the-loop validation for high-value entity types. **Multi-tenant rule:** ER may *learn* across users, but per-user graphs/provenance stay **isolated**; a shared **canonical entity catalog** (places/events) is the only cross-user surface.

### 3.5 Backend / Infra / SRE
- **Gap:** Synchronous ingestion; no idempotency; reprocessing viral content repeatedly.
- **Fill:** **Event-driven async pipeline** (ingest API → durable queue → workers). **Idempotency keys = content fingerprint** so the same reel is processed once globally and then fanned out to users (this *is* the dedup + cost win). Dead-letter queues, retries with backoff, per-stage observability and cost attribution.

### 3.6 Product / Growth
- **Gap:** "Knowledge graph" is invisible to users; the wedge has to be a *felt* benefit.
- **Gap:** Cold-start — an empty graph answers nothing.
- **Fill:** Lead with a concrete loop: **Save → it gets organized → ask and get a cited answer with a map.** First-run seeds value from the user's *own* first few saves ("Here's everything you saved about Denver"). Community/discovery is the second act. Categories that demo well first: **places to eat/visit, events, travel itineraries, products.**

### 3.7 Privacy / Security / Compliance (GDPR/CCPA)
- **Gap:** Persisting user data and shared content without deletion/rights story.
- **Fill:** Per-user data isolation, export + delete (right to erasure), PII minimization, regional data residency option, audit log. On-device-first extraction also minimizes what's collected. Creator takedown path feeds deletions through the same versioned store.

### 3.8 Finance / Unit economics
- **Gap:** No per-item cost ceiling; LLM spend scales linearly with virality.
- **Fill:** A **cost model with hard tier budgets** (§7). Dedup makes marginal cost of the N-th share of a viral reel ≈ $0. Batch API (50% off) for all non-interactive extraction. Prompt caching of the extraction system prompt/schema. Cheapest model that passes eval per tier.

---

## 4. Decisions that fill the gaps (carried forward)

| # | Decision | Rationale |
|---|---|---|
| D1 | **CHOSEN: (A) server-resolve/scrape from the shared URL.** App sends only the URL; backend resolves content for all sources. Generic + simplest. Mitigations (D2, D4, §6.2) keep it swappable and survivable; ToS/IP risk accepted for MVP. | Speed-to-market; "just the URL" |
| D2 | **Pluggable `SourceConnector` + per-source compliance tier**, legal sign-off gated | Generic across sources, controls risk |
| D3 | **Ship personal graph first; community layer opt-in & reviewed** | De-risk IP/republishing |
| D4 | **Content fingerprint = global idempotency key**; process-once, fan-out | Dedup + cost (the core lever) |
| D5 | **Three-tier extraction cascade w/ confidence-gated escalation** | Cost-effective multimodal |
| D6 | **Geo/Places API is the primary entity-resolution key** | ER quality (>85%) |
| D7 | **Postgres + pgvector + PostGIS first; graph DB only when needed** | Cost, simplicity, vector-RAG-first |
| D8 | **Canonical shared entity catalog; per-user provenance isolated** | Multi-tenant correctness + dedup |
| D9 | **Claude for extraction + answer synthesis; structured outputs + batch + caching** | Quality + cost (§7) |
| D10 | **Answers are "most-recommended across saved content," always cited** | Honesty; avoids "objective best" overclaim; legal |

---

## 5. Feature set (MVP → full)

### MVP (single-user, iOS first, ship first)
- **iOS Share Extension**; instant "Saved ✓" (Android follows post-MVP).
- **Server-side Resolver** (Strategy A) behind the `SourceConnector` interface, with the resolution ladder + per-source caching/dedup of §6.2. Start with the highest-success sources to prove the loop (web/OpenGraph + YouTube), then add IG/TikTok adapters.
- Async understanding → claims → personal graph (Postgres + pgvector + PostGIS).
- NL query over *my* saves with **cited, synthesized** answers + map/list views.
- Collections ("Denver trip"), auto-categorization, dedup of re-saved content.
- Export & delete (privacy).

### V1
- IG/TikTok/X connectors via on-device extraction; richer entity types (events with temporal validity).
- Ranking ("best") with transparent signals; "events near me this weekend" (geo + time).
- Graph layer added if relational queries warrant; semantic + graph hybrid retrieval.
- Notifications ("an event you saved is this Saturday").

### V2 (community / network effects, gated)
- Opt-in community catalog, attribution-forward, DMCA/takedown.
- Shared canonical entities; cross-user "most-saved" ranking; following/curators.
- Public collections / shareable answer pages.

---

## 6. System architecture

```
 ┌────────────┐   share sheet    ┌──────────────┐   structured     ┌───────────────┐
 │ Mobile app │ ───────────────▶ │ On-device     │   derivatives    │  Ingest API   │
 │ + Share Ext│                  │ extraction    │ ───────────────▶ │ (idempotent)  │
 └────────────┘                  │ (OCR/ASR/VLM) │   (text, not the │ fingerprint   │
        ▲  answers + map/list     └──────────────┘    raw video)    └──────┬────────┘
        │                                                                   │ enqueue
        │                                                                   ▼
 ┌──────┴───────┐   synthesis    ┌──────────────┐   claims      ┌───────────────────┐
 │ Query service│◀───────────────│ Knowledge    │◀──────────────│ Understanding     │
 │ (RAG+Graph)  │   + citations  │ graph store  │   entities    │ workers (cascade) │
 └──────────────┘                │ PG+pgvector  │   resolved    │ T0 → T1 → T2      │
                                  │ +PostGIS(+AGE)│              └─────────┬─────────┘
                                  └──────────────┘                        │ dedup short-circuit
                                         ▲                                 ▼
                                  ┌──────┴───────┐                  ┌─────────────┐
                                  │ Entity        │                 │ Places/Geo  │
                                  │ Resolution    │◀────────────────│ API + cache │
                                  └───────────────┘                 └─────────────┘
```

### 6.1 Ingestion
Share extension → App Group container → background upload → **Ingest API**. The API computes/accepts a **content fingerprint** (normalized URL + platform content ID + perceptual hash of thumbnail/keyframes for UGC) and writes an idempotent record, then enqueues. If the fingerprint already has resolved claims, **skip understanding entirely** and just create the user→content provenance edge (instant, free).

### 6.2 Content acquisition — the key decision (D1)
**Receiving the share is always just a URL** (+ optional title/thumbnail/text) via the OS share sheet — no API, no per-platform work, uniform across every app. The URL is a *pointer*, not the content; the architecture-defining choice is how to turn URL → content, and it is **not uniform across sources**:

| Source | URL → content server-side? | Risk |
|---|---|---|
| Web articles / blogs / news | Fetch page, parse OpenGraph + article text (how link previews work) | **Low** |
| YouTube / Shorts | Official Data API + captions (free tier) | **Low** |
| Instagram Reels / TikTok / X video | JS-rendered / login-walled → requires scraping/unofficial endpoints | **High (ToS, brittle, blocked, copyright/CFAA)** |

**Three strategies (A chosen):**
- **A — Server-resolve/scrape from URL. ✅ CHOSEN.** Simplest, fully generic. Violates ToS for IG/TikTok, brittle, blockable, IP exposure. Accepted for MVP; engineering realities + mitigations below.
- **B — On-device extraction** (further below). Compliant + private + cheap; more engineering; needs the user to have viewed the content. *Held as the migration target / fallback.*
- **C — Hybrid.** Server-resolve web + YouTube from the URL; on-device for IG/TikTok/X. *Held as the de-risking path if scraping gets blocked or the product needs to harden.*

#### Strategy A — server-side resolver (chosen): how to build it to survive
The backend turns a URL into content. Build it so the risky, brittle part is **isolated, cached, and replaceable**:
- **Dedicated Resolver service behind the `SourceConnector` interface (D2).** Each platform is one adapter. Swapping a scraper for an official API later (→ Strategy C) is a one-adapter change, no pipeline rewrite.
- **Resolution ladder per source, cheapest/safest first:** (1) **OpenGraph / `<meta>` tags** (free, allowed — works for web, and gives title/thumbnail/author for most platforms); (2) **oEmbed** for attribution/thumbnail; (3) **official API** where it exists (YouTube captions); (4) **headless/unofficial fetch** only as the last resort for IG/TikTok caption+media.
- **Dedup is now also the risk lever (D4).** Resolve each `content_fingerprint` **once globally** and cache the result. The 10,000th saver of a viral reel triggers **zero** outbound requests to the platform — this slashes cost *and* the block/ToS footprint.
- **Resilience:** per-source rate limiting + exponential backoff; treat 4xx/login-walls/HTML changes as expected, degrade gracefully (fall back to OpenGraph-only claims rather than failing the save); circuit-breaker per source; alert when a source's success rate drops (signals they changed their page).
- **Store derivatives, not copies (D2):** persist extracted claims + thumbnail-by-reference + permalink; don't warehouse creators' video/audio.
- **Compliance hooks ready:** attribution-forward UI, DMCA/takedown path wired to the versioned store, robots/ToS notes per adapter — so the Strategy C/B migration is incremental, not a rebuild.

#### On-device extraction (strategy B — held as fallback/migration target)
Runs on the user's device against content already rendered there:
- **Caption / on-screen text:** OCR (Apple Vision / ML Kit).
- **Audio:** on-device ASR (Apple Speech / Whisper-tiny) → transcript.
- **Visual:** small on-device VLM (or a few keyframes) → one-line scene summary + detected text/landmarks.
- **Metadata:** title/author/permalink from the share payload + oEmbed (attribution/thumbnail only).
Uploads **only derived text + signals + fingerprint** — never a stored copy of the creator's media.

### 6.3 Understanding cascade (cost-tiered, D5)
| Tier | Inputs | Model | When |
|---|---|---|---|
| **T0** | caption + title + on-device OCR/ASR text | **Claude Haiku 4.5** ($1/$5), structured outputs, **Batch API** | Always (default) |
| **T1** | + fuller transcript, multiple OCR frames | **Claude Sonnet 4.6** ($3/$15) | T0 confidence low, or content is media-rich |
| **T2** | + sampled keyframes (vision) | **Claude Opus 4.8** ($5/$25) | High-value (popular/saved-by-many) or still ambiguous |

Each tier emits the same **claims JSON schema**; escalation is gated on a confidence/completeness score. Prompt-cache the system prompt + schema (stable prefix) so only the per-item content is billed at full rate.

### 6.4 Dedup (D4, D8) — the dominant cost & quality lever
- **Content-level:** fingerprint → process once globally, fan out to all savers. The 10,000th share of a viral reel costs ≈ $0.
- **Entity-level:** many reels → one canonical place/event via entity resolution (§6.5).
- **Claim-level:** merge duplicate assertions; increment a *support count* (this becomes a ranking signal).

### 6.5 Entity resolution (D6) — make-or-break quality
Resolution keys, strongest first: **geo-anchor via Places API** (name + coords + address → canonical place ID) → embedding similarity → deterministic rules (normalized name, handle, URL) → **LLM-assisted disambiguation** only for the residual. Human-in-the-loop review queue for high-value/low-confidence merges. **Health metrics tracked:** merge rate, orphan-node count, traversal error rate, estimated resolution accuracy with alerting if it dips toward the 85% toxicity threshold.

### 6.6 Storage & retrieval (D7)
- **Postgres** = source of truth (entities, claims, sources, users, provenance).
- **pgvector** = embeddings for semantic retrieval (Voyage AI or open-source embeddings — note: Anthropic doesn't serve embeddings).
- **PostGIS** = geo queries ("near me," "in SF").
- **Graph layer (Apache AGE / Neo4j)** added only when relational/multi-hop queries prove necessary.
- Object store = thumbnails/derivatives only.

### 6.7 Query serving
1. Parse intent → extract geo, time, category, ranking ("best"), scope (mine/community).
2. **Hybrid retrieval:** vector search (primary) + structured filters (PostGIS geo, temporal validity) + graph traversal (when present).
3. **Rank** for "best": support count (distinct sources) × recommendation strength/sentiment × recency × source authority × (optional) external corroboration.
4. **Synthesize** with **Claude Opus 4.8**, grounded strictly in retrieved claims, **with citations** back to source reels. Stream the answer; render a map/list alongside.
5. Honest framing (D10): *"Most recommended across the content you saved."*

### 6.8 Server-first build architecture (chosen path)

**Shape: an API-first modular monolith + async workers, on a single datastore.** This is the best fit for "test, refine, then build the app on top": fastest iteration, lowest ops, and clean module seams that split into services only when scale demands. The future iOS app is just one more HTTP client — the API is the product surface from day one.

**Stack (chosen; each piece swappable behind an interface):**

| Concern | Choice | Why |
|---|---|---|
| Language/runtime | **Python 3.12** | Best Claude SDK + data/ML ergonomics; the workload is LLM/data-heavy |
| API | **FastAPI** (async) + **Pydantic v2** | Auto **OpenAPI/Swagger** = instant manual test surface (no UI to build); Pydantic models are the *single source of truth* for API contracts **and** Claude structured-output schemas **and** DB validation |
| Datastore | **Postgres 16 + pgvector + PostGIS** | One store for relational + vector + geo; trivial to inspect/refine; scales far before needing a graph DB (D7) |
| Object store | **S3 / Cloudflare R2** | Thumbnails & derivatives only (D2) |
| Queue / workers | **Redis + Arq** (or Postgres `SKIP LOCKED` to skip Redis early) | Durable async pipeline; retries/backoff/DLQ. A `?sync=true` debug mode runs the pipeline inline for easy step-through during refinement |
| LLM | **Anthropic Python SDK** — Haiku 4.5 (T0) → Sonnet 4.6 (T1) → Opus 4.8 (T2 + query synthesis) | Structured outputs, Batch API (−50% on T0/T1), prompt caching (§6.3, §7) |
| Embeddings | **Voyage AI** behind an `Embedder` interface (open-source fallback) | Anthropic doesn't serve embeddings; keep it pluggable |
| Resolver | **httpx + selectolax** (OpenGraph), **YouTube Data API**, **Playwright** (headless, last resort) per-adapter | The §6.2 resolution ladder; one adapter per source |
| Geo / Places | **Google Places / Mapbox** | Primary entity-resolution anchor (D6) |
| Packaging | **Docker + docker-compose** locally; Fly.io/Render/AWS later | Refine locally; deploy when ready |

**Module boundaries (one repo, clear seams):** `ingest` · `resolver` (SourceConnectors) · `extractor` (T0/T1/T2 cascade) · `entities` (resolution + dedup) · `graph` (persistence) · `query` (retrieval + synthesis) · `workers` (orchestration) · `eval` (offline harness). Each talks to the next through an interface, so any module can become its own service later without a rewrite.

**API surface (the contract the app will later consume):**
- `POST /v1/items` `{url, user_id}` → `{item_id, status}` — idempotent on `content_fingerprint`; enqueues the pipeline.
- `GET  /v1/items/{id}` → status + **full trace** (resolved content → tier used → claims → resolved entities → cost). The trace endpoint is the core refinement tool.
- `POST /v1/query` `{text, scope, user_id}` → streamed, **cited** synthesis + structured results (map/list).
- `GET  /v1/entities`, `/v1/collections`, export/delete — round out the surface.
- A thin **CLI** (`curio submit <url>`, `curio query "..."`) for fast manual testing without any UI.

**Refinement engine (this is what "test & refine" runs on):**
- **Eval harness** — a golden set of URLs with expected claims/entities; CI runs the pipeline and reports extraction precision/recall, **entity-resolution accuracy** (guard the >85% line), and **cost/item**. Prompt and tier-threshold changes are validated against it.
- **Per-stage observability + cost attribution** (tokens, tier, latency, cache-hit rate) on every item.
- **Single dev user** now; the `user_id`/auth seam is already in the API so personal-scope and the future app map in cleanly.

### 6.9 Is a knowledge graph the right approach? How queries get answered

**Honest framing of the goal.** No architecture answers *all* queries *perfectly*. Two hard ceilings: (1) **coverage is bounded by the corpus** — nothing answers "best in Denver" if no saved item mentions Denver; (2) a system that always answers confidently **hallucinates**. The target is therefore: **correct, grounded (every claim cites a source), honest about gaps, never fabricated** — with coverage pushed up methodically via the eval loop. "Perfect" → "correct, cited, knows its limits, improves over time."

**"Knowledge graph" is half-right.** Decomposing the real query space shows most queries are *not* graph traversal:

| Query type | Example | Primitive that answers it |
|---|---|---|
| Recall / lookup | "that pasta place from the food reel" | Semantic (vector) search |
| Filtered retrieval | "events in SF this Saturday" | Structured filter (geo+time) — SQL/PostGIS |
| Aggregation / ranking | "20 best things to do in Denver" | Group-by-entity + rank (support, sentiment, recency) |
| Multi-hop / relational | "places a creator I follow recommended near my hotel" | **Graph traversal** (the real graph case) |
| Comparison / synthesis | "compare the two hotels people raved about" | Retrieve both → LLM synthesize |
| Open / exploratory | "what should I do this weekend" | Query decomposition → several of the above |

Only the multi-hop row truly needs a graph. So a pure graph DB on day one is **over-engineering** (D7). What's actually required is a **canonical, deduplicated, *typed* knowledge layer** — claims `(entity, attribute, geo, time, sentiment, source)` with entities resolved to canonical IDs. Storing it as graph edges is an implementation detail deferred until relational queries prove it's needed.

**The answer mechanism: an agentic query planner over a retrieval toolbox.**
1. **LLM planner** (Claude) decomposes the NL query → intent, geo/time filters, ranking, scope.
2. It calls **retrieval primitives as tools:** `semantic_search` (vector), `structured_filter` (SQL/PostGIS), `aggregate_rank`, `graph_traverse` (when the graph layer exists), `entity_lookup`.
3. It **synthesizes a grounded, cited answer** strictly from retrieved claims — never from model memory.

The structured layer makes the tools precise; the LLM is the **routing + reasoning** layer, not the source of truth. This is what lets one system span the whole table above.

**What actually determines answer quality** (not "graph vs no graph"): (1) **extraction completeness**, (2) **entity resolution/dedup** (>85% line, geo-anchored), (3) **query planning/routing**. The graph layer is a late, additive optimization for the multi-hop minority.

**Driving toward "any query":** maintain a **query-taxonomy eval set** (golden Q/A per category) → measure answer accuracy + grounding per category → refine the weakest. Coverage climbs measurably instead of by hope.

---

## 7. Cost model (real Claude pricing, 2026-06)

Pricing per 1M tokens: **Haiku 4.5 $1/$5**, **Sonnet 4.6 $3/$15**, **Opus 4.8 $5/$25**. Levers: dedup (process-once), Batch API (−50% on T0/T1), prompt caching (cache reads ≈ 0.1× input).

**Per-item extraction (illustrative, ~2K in / ~0.5K out):**
- **T0 / Haiku + batch + caching:** order of **~$0.001–0.002 per *unique* item.** With most input served from cache and batch discount, marginal cost is fractions of a cent.
- **T1 / Sonnet:** ~$0.005–0.01 per escalated item.
- **T2 / Opus + vision:** ~$0.02–0.05 per item (reserve for high-value/ambiguous).

**Why this stays cheap at scale:** if a typical user saves N items but X% are already-seen viral content, you only pay extraction on the *unique* tail. Dedup + tier-gating means **blended cost per save trends toward a fraction of a cent**, with occasional Opus spend only where it changes the answer. **Per-item hard budget caps** in the cascade prevent runaway spend. Query-time synthesis (Opus) is the other cost center — cache the retrieval context prefix and keep answers scoped.

> Re-baseline with `count_tokens` on representative payloads before committing budgets; do not apply blanket multipliers.

---

## 8. Data model (initial, Postgres)

- `source` — id, platform, content_fingerprint (unique), permalink, author_handle, title, thumbnail_ref, raw_derivatives (jsonb), first_seen_at, popularity_signals.
- `user_save` — user_id, source_id, saved_at, collection_id, scope (private/community). *(provenance edge; isolation boundary)*
- `entity` — id, type (place/event/activity/product/media/person), canonical_name, external_ids (Places/IMDb/…), geo (PostGIS point), metadata (jsonb). *(shared catalog)*
- `claim` — id, source_id, entity_id, attribute, value, sentiment, recommendation_strength, time_validity (tstzrange, for events), confidence, support_count.
- `embedding` — owner_type/id, vector (pgvector), model.
- `entity_edge` — subj_entity_id, predicate, obj_entity_id *(graph; or AGE)*.
- Indexes: GIN on jsonb, GiST on geo + time ranges, HNSW/IVF on vectors, unique on fingerprint.

---

## 9. Phased roadmap

*(Server-first: Phases 0–3 are the headless backend; the app is Phase 4.)*

**Phase 0 — Skeleton (≈1 wk)**
- FastAPI + Postgres (pgvector/PostGIS) + Docker compose; `POST /v1/items`, `GET /v1/items/{id}` trace.
- `SourceConnector` interface + first adapter (web/OpenGraph); fingerprint idempotency; single dev user; CLI stub.

**Phase 1 — Core pipeline (≈2–3 wks)**
- Async worker + queue; resolver ladder for web + YouTube (§6.2 Strategy A) with global caching/dedup.
- T0 extraction (Haiku, structured outputs, batch, caching) → claims → persistence.
- **Eval harness v1** (golden URLs → expected claims; precision/recall + cost/item).

**Phase 2 — Graph + query (≈2–3 wks)**
- Entity resolution v1 (geo-anchor + embeddings) + dedup short-circuit; ER health metrics (>85% guard).
- pgvector + PostGIS retrieval; `POST /v1/query` → Opus synthesis with **citations**; export/delete.

**Phase 3 — Depth & refine (≈2–3 wks)**
- T1/T2 escalation; IG/TikTok adapters; events + temporal queries; ranking ("best").
- Batch + caching cost-down; cost/quality dashboards; add graph layer iff relational queries demand it.

**Phase 4 — iOS app (later)**
- iOS Share Extension as a **thin client** on the stable API; instant "Saved ✓"; map/list UI; notifications. No pipeline rework.

**Phase 5 — V2 community (gated)**
- Opt-in shared catalog, attribution/DMCA, cross-user ranking, public collections — **after** the §3.2 legal review.

---

## 10. Risks & open questions

| Risk | Severity | Mitigation |
|---|---|---|
| Platform ToS / scraping / copyright | **High** | On-device-first (D1); store derivatives not copies; attribution; DMCA; personal-use-first (D3); legal gate per connector (D2) |
| Entity-resolution accuracy < 85% → toxic graph | **High** | Geo-anchor primary key; HITL review; health metrics + alerts (§6.5) |
| LLM cost scales with virality | Med | Dedup process-once (D4); tier-gating + per-item caps; batch + caching (§7) |
| On-device extraction quality/latency on low-end devices | Med | Server fallback for *user-supplied* media; tiered on-device models; degrade gracefully |
| Cold-start empty graph | Med | First-run value from user's own saves; demo categories (food/travel/events) |
| Privacy / GDPR-CCPA | Med | Isolation, export/delete, PII minimization, residency option |
| "Best" overclaim / liability | Low/Med | Honest framing + citations (D10) |

**Resolved:** acquisition = server-resolve/scrape (A); platform = iOS first; scope = personal first.

**Open questions for you (don't block the plan; they tune it):**
1. **Target scale / budget envelope** for the first 6 months (sets infra and model-tier defaults).
2. **Monetization** (subscription / freemium / B2B) — shapes rate limits, retention, and the eventual community decision.
3. **Block-resilience appetite** — if IG/TikTok start blocking the resolver, do we invest in scrape hardening (proxies/headless) or pivot those sources to on-device (Strategy B)? (Decide when/if it happens.)

---

*Models referenced use current Claude IDs (Opus 4.8 `claude-opus-4-8`, Sonnet 4.6 `claude-sonnet-4-6`, Haiku 4.5 `claude-haiku-4-5`). Extraction uses structured outputs + Batch API + prompt caching; synthesis uses Opus 4.8 with citations.*
