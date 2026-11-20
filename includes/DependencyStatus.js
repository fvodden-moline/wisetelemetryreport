// Result of the last real call to each third-party service, kept in the database so /health/deep
// can report it without making a call of its own (and so it survives a restart). Keys are the
// manifest ids in moline.deps.yaml (consumes.external[].id).
const DEPENDENCIES = ['wise-telemetry', 'visual-crossing'];

const latest = new Map();
let db = null;

async function init(database) {
  db = database;
  await db.asyncRun(`CREATE TABLE IF NOT EXISTS dependency_calls (
    name TEXT PRIMARY KEY, ok INTEGER, checked_at TEXT, ms INTEGER, message TEXT)`);
  const rows = await db.asyncAll('SELECT name, ok, checked_at, ms, message FROM dependency_calls');
  for (const row of rows) latest.set(row.name, row);
}

// message: a short detail when ok, the reason a person can act on when not. No secrets.
async function record(name, ok, ms, message) {
  const row = { name, ok: ok ? 1 : 0, checked_at: new Date().toISOString(), ms: Math.round(ms), message };
  latest.set(name, row);
  if (!db) return;
  try {
    await db.asyncRun(
      `INSERT INTO dependency_calls (name, ok, checked_at, ms, message) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET ok = excluded.ok, checked_at = excluded.checked_at,
         ms = excluded.ms, message = excluded.message`,
      [row.name, row.ok, row.checked_at, row.ms, row.message]);
  } catch (err) {
    console.error(`Could not store the ${name} call result: ${err.message}`);
  }
}

function report() {
  const out = {};
  for (const name of DEPENDENCIES) {
    const row = latest.get(name);
    if (!row) {
      out[name] = { kind: 'external', ok: true, checked_at: null, detail: 'no call recorded yet (it is called when a page needs days that are not cached)' };
    } else if (row.ok) {
      out[name] = { kind: 'external', ok: true, checked_at: row.checked_at, ms: row.ms, detail: `last call: ${row.message}` };
    } else {
      out[name] = { kind: 'external', ok: false, checked_at: row.checked_at, ms: row.ms, error: `last call: ${row.message}` };
    }
  }
  return out;
}

module.exports = { init, record, report };
