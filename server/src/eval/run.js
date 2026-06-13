import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { hasLLM } from '../llm/anthropic.js';
import { extractCascade } from '../pipeline/extract.js';
import { scoreEntities, scoreEr, erKey, entityMatch } from './score.js';
import { config } from '../config.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const EVAL_DIR = join(HERE, '..', '..', 'eval');
const ER_TARGET = 0.85; // plan §6.5 toxicity guard
const F1_TARGET = 0.6;

const full = process.argv.includes('--full');
const strict = process.argv.includes('--strict');

async function loadFixtures() {
  const dir = join(EVAL_DIR, 'fixtures');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  return Promise.all(files.map(async (f) => JSON.parse(await readFile(join(dir, f), 'utf8'))));
}

function uniqueEntities(claims) {
  const seen = new Map();
  for (const c of claims) {
    const k = erKey(c.entity_name, c.entity_type);
    if (!seen.has(k)) seen.set(k, { name: c.entity_name, type: c.entity_type });
  }
  return [...seen.values()];
}

async function evalExtraction(fixtures) {
  if (!hasLLM()) return { ran: false, reason: 'no ANTHROPIC_API_KEY', perFixture: [], avgF1: null };
  const perFixture = [];
  let totalCost = 0;
  for (const fx of fixtures) {
    const llm = await extractCascade({
      text: fx.source.content,
      sourceMeta: { title: fx.source.title, platform: fx.source.platform, permalink: fx.source.permalink, current_date: new Date().toISOString() },
    });
    const extracted = llm ? uniqueEntities(llm.extraction.claims) : [];
    if (llm) totalCost += llm.costUsd;
    const s = scoreEntities(extracted, fx.expected.entities);
    perFixture.push({ id: fx.id, tier: llm?.tier || 'none', cost_usd: llm?.costUsd || 0, ...s });
  }
  const avgF1 = perFixture.reduce((a, b) => a + b.f1, 0) / (perFixture.length || 1);
  return { ran: true, perFixture, avgF1, totalCost };
}

async function evalQueries(fixtures) {
  // Full end-to-end: requires DB + LLM. Ingests fixtures inline, then queries.
  if (!full) return { ran: false, reason: 'pass --full to run end-to-end query eval' };
  const { pool } = await import('../db.js');
  try { await pool.query('select 1'); } catch { return { ran: false, reason: 'database unreachable' }; }

  const { migrate } = await import('../db/migrate.js');
  const { runExtraction } = await import('../pipeline/process.js');
  const { answerQuery } = await import('../query/answer.js');
  const { fingerprint, normalizeUrl } = await import('../lib/fingerprint.js');
  await migrate();

  const userId = `eval-${Date.now()}`;
  for (const fx of fixtures) {
    const fp = fingerprint(fx.source.permalink);
    const ins = await pool.query(
      `insert into source(fingerprint, permalink, status) values($1,$2,'queued')
       on conflict (fingerprint) do update set updated_at=now() returning id`,
      [fp, normalizeUrl(fx.source.permalink)],
    );
    const src = (await pool.query('select * from source where id=$1', [ins.rows[0].id])).rows[0];
    await pool.query('insert into user_save(user_id, source_id) values($1,$2) on conflict do nothing', [userId, src.id]);
    await runExtraction({
      src,
      resolution: { platform: fx.source.platform, permalink: fx.source.permalink, title: fx.source.title, author: null, description: null, text: fx.source.content, thumbnail: null, raw: { eval: true } },
    });
  }

  const cases = [];
  for (const fx of fixtures) {
    for (const q of fx.queries || []) {
      const res = await answerQuery({ question: q.text, userId, scope: 'mine' });
      const names = res.results.map((r) => r.entity_name).filter(Boolean);
      const found = (q.expect_entities || []).filter((e) => names.some((n) => entityMatch(e, n)));
      cases.push({ fixture: fx.id, query: q.text, expected: q.expect_entities, hits: found.length, recall: q.expect_entities?.length ? found.length / q.expect_entities.length : 0 });
    }
  }
  const avgRecall = cases.reduce((a, b) => a + b.recall, 0) / (cases.length || 1);
  return { ran: true, cases, avgRecall, userId };
}

function pct(x) { return x == null ? 'n/a' : `${(x * 100).toFixed(1)}%`; }

async function main() {
  const fixtures = await loadFixtures();
  const erCases = JSON.parse(await readFile(join(EVAL_DIR, 'er-cases.json'), 'utf8'));

  const er = scoreEr(erCases);
  const extraction = await evalExtraction(fixtures);
  const queries = await evalQueries(fixtures);

  const report = {
    at: new Date().toISOString(),
    config: { llm: hasLLM(), embeddings: config.voyageApiKey ? 'voyage' : 'hash-fallback' },
    targets: { er: ER_TARGET, f1: F1_TARGET },
    entity_resolution: er,
    extraction,
    queries,
  };
  await mkdir(join(EVAL_DIR), { recursive: true });
  await writeFile(join(EVAL_DIR, 'last-report.json'), JSON.stringify(report, null, 2));

  // Console summary
  console.log('\n=== Curio eval ===');
  console.log(`LLM: ${report.config.llm ? 'on' : 'OFF'} | embeddings: ${report.config.embeddings}`);
  console.log(`\n[Entity resolution keying]  accuracy ${pct(er.accuracy)} (target ${pct(ER_TARGET)})  ${er.accuracy >= ER_TARGET ? 'PASS' : 'BELOW TARGET'}`);
  for (const e of er.errors) console.log(`   - ${e.kind}: "${e.a}" vs "${e.b}"`);
  if (extraction.ran) {
    console.log(`\n[Extraction]  avg F1 ${pct(extraction.avgF1)} (target ${pct(F1_TARGET)})  ${extraction.avgF1 >= F1_TARGET ? 'PASS' : 'BELOW TARGET'}  cost $${extraction.totalCost.toFixed(4)}`);
    for (const f of extraction.perFixture) console.log(`   ${f.id} [${f.tier}]: P ${pct(f.precision)} R ${pct(f.recall)} F1 ${pct(f.f1)}${f.misses.length ? `  missed: ${f.misses.join(', ')}` : ''}`);
  } else {
    console.log(`\n[Extraction]  skipped (${extraction.reason})`);
  }
  if (queries.ran) {
    console.log(`\n[Query recall]  avg ${pct(queries.avgRecall)}`);
    for (const c of queries.cases) console.log(`   "${c.query}" -> ${c.hits}/${c.expected.length}`);
  } else {
    console.log(`\n[Query eval]  skipped (${queries.reason})`);
  }
  console.log(`\nReport written to eval/last-report.json\n`);

  if (strict) {
    const erFail = er.accuracy < ER_TARGET;
    const f1Fail = extraction.ran && extraction.avgF1 < F1_TARGET;
    if (erFail || f1Fail) { console.error('STRICT: below target'); process.exit(1); }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
