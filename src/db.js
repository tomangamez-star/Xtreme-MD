const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const config = require('../config');

const sessionDir = path.join(process.cwd(), 'session');
const localSettings = path.join(process.cwd(), 'data', 'settings.json');
let pool;
let databaseReady = false;
let authBackupQueue = Promise.resolve();
let databaseRetryAfter = 0;
let lastDatabaseWarning = 0;

function localSetting(key, fallback) {
  if (!fs.existsSync(localSettings)) return fallback;
  try { return JSON.parse(fs.readFileSync(localSettings, 'utf8'))[key] ?? fallback; }
  catch { return fallback; }
}

async function markDatabaseUnavailable(error) {
  databaseReady = false;
  databaseRetryAfter = Date.now() + 60000;
  const failedPool = pool;
  pool = null;
  if (Date.now() - lastDatabaseWarning > 30000) {
    console.warn(`[DATABASE] Temporarily disabled; commands will use local fallback: ${error.message}`);
    lastDatabaseWarning = Date.now();
  }
  await failedPool?.end().catch(() => {});
}

function getPool() {
  if (!config.databaseUrl || Date.now() < databaseRetryAfter) return null;
  if (!pool) {
    pool = new Pool({ connectionString: config.databaseUrl, ssl: { rejectUnauthorized: false }, max: 3, connectionTimeoutMillis: 15000 });
    pool.on('error', error => console.warn(`[DATABASE] Background connection error: ${error.message}`));
  }
  return pool;
}

async function initDb() {
  if (databaseReady) return;
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(path.dirname(localSettings), { recursive: true });
  const db = getPool();
  if (!db) return;
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS xtreme_auth (name TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW())`);
    await db.query(`CREATE TABLE IF NOT EXISTS xtreme_kv (key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW())`);
    await db.query(`CREATE TABLE IF NOT EXISTS xtreme_music_usage (user_id TEXT NOT NULL, day DATE NOT NULL DEFAULT CURRENT_DATE, count INT NOT NULL DEFAULT 0, PRIMARY KEY(user_id, day))`);
    databaseReady = true;
    console.log('[DATABASE] Connected and ready');
  } catch (error) {
    await markDatabaseUnavailable(error);
    console.warn(`[DATABASE] Unavailable; continuing without persistence: ${error.message}`);
  }
}

async function restoreAuth() {
  const db = getPool();
  if (!db) return { restored: 0, persistent: false };
  try {
    const result = await restoreAuthDirectory(db, sessionDir);
    if (result.restored) console.log(`[AUTH] Restored ${result.restored} session files from Supabase`);
    return result;
  } catch (error) {
    await markDatabaseUnavailable(error);
    console.warn(`[AUTH] Supabase restore failed; local session only: ${error.message}`);
    return { restored: 0, persistent: false };
  }
}

async function backupAuth() {
  authBackupQueue = authBackupQueue.catch(() => {}).then(syncAuthToDatabase);
  return authBackupQueue;
}

async function syncAuthToDatabase() {
  const db = getPool();
  if (!db || !fs.existsSync(sessionDir)) return { saved: 0, persistent: false };
  try { return await syncAuthDirectory(db, sessionDir); }
  catch (error) {
    await markDatabaseUnavailable(error);
    return { saved: 0, persistent: false };
  }
}

async function restoreAuthDirectory(db, directory) {
  const { rows } = await db.query('SELECT name, value FROM xtreme_auth ORDER BY name');
  let restored = 0;
  for (const row of rows) {
    if (!/^[A-Za-z0-9_.-]+\.json$/.test(row.name)) continue;
    fs.writeFileSync(path.join(directory, row.name), JSON.stringify(row.value));
    restored++;
  }
  return { restored, persistent: true };
}

async function syncAuthDirectory(db, directory) {
  const names = fs.readdirSync(directory).filter(name => /^[A-Za-z0-9_.-]+\.json$/.test(name)).sort();
  const files = [];
  for (const name of names) {
    try { files.push([name, JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'))]); }
    catch (error) { console.warn(`[AUTH] Skipped unreadable ${name}: ${error.message}`); }
  }
  if (!files.some(([name]) => name === 'creds.json')) return { saved: 0, persistent: false };
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    for (const [name, value] of files) {
      await client.query(`INSERT INTO xtreme_auth(name,value,updated_at) VALUES($1,$2,NOW()) ON CONFLICT(name) DO UPDATE SET value=$2,updated_at=NOW()`, [name, value]);
    }
    // Baileys rotates and deletes keys. Remove their stale database copies so a
    // later deploy cannot resurrect invalid sender/session keys.
    await client.query('DELETE FROM xtreme_auth WHERE NOT (name = ANY($1::text[]))', [files.map(([name]) => name)]);
    await client.query('COMMIT');
    return { saved: files.length, persistent: true };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.warn(`[AUTH] Supabase backup failed; will retry on the next credential update: ${error.message}`);
    return { saved: 0, persistent: false };
  } finally {
    client.release();
  }
}

async function getSetting(key, fallback) {
  const db = getPool();
  if (db) {
    try {
      const { rows } = await db.query('SELECT value FROM xtreme_kv WHERE key=$1', [key]);
      return rows[0]?.value ?? fallback;
    } catch (error) { await markDatabaseUnavailable(error); }
  }
  return localSetting(key, fallback);
}

async function setSetting(key, value) {
  const db = getPool();
  if (db) {
    try {
      await db.query(`INSERT INTO xtreme_kv(key,value,updated_at) VALUES($1,$2,NOW()) ON CONFLICT(key) DO UPDATE SET value=$2,updated_at=NOW()`, [key, value]);
      return;
    } catch (error) { await markDatabaseUnavailable(error); }
  }
  const all = fs.existsSync(localSettings) ? (() => { try { return JSON.parse(fs.readFileSync(localSettings, 'utf8')); } catch { return {}; } })() : {};
  all[key] = value;
  fs.writeFileSync(localSettings, JSON.stringify(all, null, 2));
}

async function consumeMusic(userId) {
  const db = getPool();
  if (!db) return { allowed: true, count: 1 };
  try {
    const result = await db.query(`INSERT INTO xtreme_music_usage(user_id,day,count) VALUES($1,CURRENT_DATE,1) ON CONFLICT(user_id,day) DO UPDATE SET count=xtreme_music_usage.count+1 RETURNING count`, [userId]);
    const count = result.rows[0].count;
    return { allowed: count <= config.musicDailyLimit, count };
  } catch (error) {
    await markDatabaseUnavailable(error);
    return { allowed: true, count: 1 };
  }
}

module.exports = { sessionDir, initDb, restoreAuth, backupAuth, getSetting, setSetting, consumeMusic, restoreAuthDirectory, syncAuthDirectory };
