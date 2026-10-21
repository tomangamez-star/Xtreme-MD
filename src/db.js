const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const config = require('../config');

const sessionDir = path.join(process.cwd(), 'session');
const localSettings = path.join(process.cwd(), 'data', 'settings.json');
let pool;
let databaseDisabled = false;

function getPool() {
  if (!config.databaseUrl || databaseDisabled) return null;
  if (!pool) pool = new Pool({ connectionString: config.databaseUrl, ssl: { rejectUnauthorized: false } });
  return pool;
}

async function initDb() {
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(path.dirname(localSettings), { recursive: true });
  const db = getPool();
  if (!db) return;
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS xtreme_auth (name TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW())`);
    await db.query(`CREATE TABLE IF NOT EXISTS xtreme_kv (key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW())`);
    await db.query(`CREATE TABLE IF NOT EXISTS xtreme_music_usage (user_id TEXT NOT NULL, day DATE NOT NULL DEFAULT CURRENT_DATE, count INT NOT NULL DEFAULT 0, PRIMARY KEY(user_id, day))`);
    console.log('[DATABASE] Connected and ready');
  } catch (error) {
    databaseDisabled = true;
    await pool?.end().catch(() => {});
    pool = null;
    console.warn(`[DATABASE] Unavailable; continuing without persistence: ${error.message}`);
  }
}

async function restoreAuth() {
  const db = getPool();
  if (!db) return;
  const { rows } = await db.query('SELECT name, value FROM xtreme_auth');
  for (const row of rows) fs.writeFileSync(path.join(sessionDir, row.name), JSON.stringify(row.value));
}

async function backupAuth() {
  const db = getPool();
  if (!db || !fs.existsSync(sessionDir)) return;
  for (const name of fs.readdirSync(sessionDir).filter(n => n.endsWith('.json'))) {
    const value = JSON.parse(fs.readFileSync(path.join(sessionDir, name), 'utf8'));
    await db.query(`INSERT INTO xtreme_auth(name,value,updated_at) VALUES($1,$2,NOW()) ON CONFLICT(name) DO UPDATE SET value=$2,updated_at=NOW()`, [name, value]);
  }
}

async function getSetting(key, fallback) {
  const db = getPool();
  if (db) {
    const { rows } = await db.query('SELECT value FROM xtreme_kv WHERE key=$1', [key]);
    return rows[0]?.value ?? fallback;
  }
  if (!fs.existsSync(localSettings)) return fallback;
  return JSON.parse(fs.readFileSync(localSettings, 'utf8'))[key] ?? fallback;
}

async function setSetting(key, value) {
  const db = getPool();
  if (db) return db.query(`INSERT INTO xtreme_kv(key,value,updated_at) VALUES($1,$2,NOW()) ON CONFLICT(key) DO UPDATE SET value=$2,updated_at=NOW()`, [key, value]);
  const all = fs.existsSync(localSettings) ? JSON.parse(fs.readFileSync(localSettings, 'utf8')) : {};
  all[key] = value;
  fs.writeFileSync(localSettings, JSON.stringify(all, null, 2));
}

async function consumeMusic(userId) {
  const db = getPool();
  if (!db) return { allowed: true, count: 1 };
  const result = await db.query(`INSERT INTO xtreme_music_usage(user_id,day,count) VALUES($1,CURRENT_DATE,1) ON CONFLICT(user_id,day) DO UPDATE SET count=xtreme_music_usage.count+1 RETURNING count`, [userId]);
  const count = result.rows[0].count;
  return { allowed: count <= config.musicDailyLimit, count };
}

module.exports = { sessionDir, initDb, restoreAuth, backupAuth, getSetting, setSetting, consumeMusic };
