const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { restoreAuthDirectory, syncAuthDirectory } = require('../src/db');
const { buildWelcomeCard } = require('../src/welcome-card');

function fakeDb(initial = {}) {
  const rows = new Map(Object.entries(initial));
  const client = {
    async query(sql, params = []) {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.startsWith('INSERT INTO xtreme_auth')) { rows.set(params[0], params[1]); return { rows: [] }; }
      if (sql.startsWith('DELETE FROM xtreme_auth')) {
        const keep = new Set(params[0]);
        for (const key of rows.keys()) if (!keep.has(key)) rows.delete(key);
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    release() {}
  };
  return {
    rows,
    async query(sql) {
      if (sql.startsWith('SELECT name, value')) return { rows: [...rows].map(([name, value]) => ({ name, value })) };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    async connect() { return client; }
  };
}

test('Supabase auth restore ignores unsafe filenames', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xtreme-auth-'));
  try {
    const db = fakeDb({ 'creds.json': { registered: true }, '../escape.json': { bad: true }, 'app-state-sync-key.json': { key: 1 } });
    const result = await restoreAuthDirectory(db, dir);
    assert.equal(result.restored, 2);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'creds.json'))).registered, true);
    assert.equal(fs.existsSync(path.join(dir, '..', 'escape.json')), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Supabase auth sync is transactional and deletes rotated stale keys', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xtreme-auth-'));
  try {
    fs.writeFileSync(path.join(dir, 'creds.json'), JSON.stringify({ registered: true }));
    fs.writeFileSync(path.join(dir, 'sender-key-new.json'), JSON.stringify({ key: 2 }));
    const db = fakeDb({ 'creds.json': { registered: false }, 'sender-key-stale.json': { key: 1 } });
    const result = await syncAuthDirectory(db, dir);
    assert.equal(result.saved, 2);
    assert.equal(db.rows.has('sender-key-stale.json'), false);
    assert.equal(db.rows.get('creds.json').registered, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('welcome card renders dynamic identity and group data', async () => {
  const card = await buildWelcomeCard({
    sock: { profilePictureUrl: async () => { throw new Error('private'); } },
    participant: '2348012345678@s.whatsapp.net',
    metadata: { id: '123@g.us', subject: 'Xtreme Test Group', participants: Array.from({ length: 42 }) }
  });
  const meta = await sharp(card).metadata();
  assert.equal(meta.width, 1200);
  assert.equal(meta.height, 675);
  assert.equal(meta.format, 'jpeg');
  assert.ok(card.length > 10_000);
});
