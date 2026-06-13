// Tiny CLI for manual testing without any UI.
//   node src/cli.js submit <url> [--sync]
//   node src/cli.js query "your question" [--scope all]
//   node src/cli.js item <id>
import { config } from './config.js';

const base = `http://localhost:${config.port}`;
const [, , cmd, ...rest] = process.argv;

async function main() {
  if (cmd === 'submit') {
    const url = rest.find((a) => !a.startsWith('--'));
    const sync = rest.includes('--sync');
    const res = await fetch(`${base}/v1/items${sync ? '?sync=true' : ''}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    console.log(JSON.stringify(await res.json(), null, 2));
  } else if (cmd === 'query') {
    const text = rest.find((a) => !a.startsWith('--'));
    const scopeIdx = rest.indexOf('--scope');
    const scope = scopeIdx >= 0 ? rest[scopeIdx + 1] : 'mine';
    const res = await fetch(`${base}/v1/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, scope }),
    });
    console.log(JSON.stringify(await res.json(), null, 2));
  } else if (cmd === 'item') {
    const res = await fetch(`${base}/v1/items/${rest[0]}`);
    console.log(JSON.stringify(await res.json(), null, 2));
  } else if (cmd === 'mintkey') {
    // Direct DB access (not via HTTP) to issue an API key.
    const { createApiKey } = await import('./auth/keys.js');
    const { pool } = await import('./db.js');
    const userId = rest.find((a) => !a.startsWith('--')) || config.defaultUserId;
    const key = await createApiKey(userId, 'cli');
    console.log(JSON.stringify({ user_id: userId, api_key: key }, null, 2));
    await pool.end();
  } else {
    console.log('usage: submit <url> [--sync] | query "..." [--scope all] | item <id> | mintkey <userId>');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
