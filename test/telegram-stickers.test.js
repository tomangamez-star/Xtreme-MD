const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const sharp = require('sharp');
const axios = require('axios');
const { promisify } = require('util');
const execFile = promisify(require('child_process').execFile);
const config = require('../config');
const { parseRequest, labelWebp, createImporter, convertSticker } = require('../src/telegram-stickers');
const link = 'https://t.me/addstickers/TestPack | MONTAI | Toman';
function context(command, sender = 'alice', chat = 'private', messages = [], query = '') {
  return { command, query, sender, msg: { key: { remoteJid: chat } }, sock: { sendMessage: async (jid, content) => { messages.push(content); } } };
}
const pack = { title: 'Test', stickers: Array.from({ length: 12 }, (_, id) => ({ id })) };

test('accepts pack labels and rejects non-Telegram and non-pack links', () => {
  assert.deepEqual(parseRequest(link), { name: 'TestPack', pack: 'MONTAI', author: 'Toman' });
  for (const url of ['http://t.me/addstickers/Test', 'https://evil.test/addstickers/Test', 'https://t.me.evil.test/addstickers/Test', 'https://t.me/addemoji/Test', 'https://t.me:444/addstickers/Test']) assert.throws(() => parseRequest(url));
});

test('five per batch, sender/chat isolation, finish and expiry', async () => {
  let time = 0;
  const messages = [];
  const importer = createImporter({ getPack: async () => pack, convert: async s => Buffer.from([s.id]), now: () => time, pause: async () => {} });
  const run = (cmd, sender = 'alice', chat = 'private') => importer.handle(context(cmd, sender, chat, messages, link));
  await run('tgpack');
  assert.equal(messages.filter(m => m.sticker).length, 5);
  await run('next', 'bob'); await run('next', 'alice', 'group');
  assert.equal(messages.filter(m => m.sticker).length, 5);
  await run('next'); await run('next');
  assert.equal(messages.filter(m => m.sticker).length, 12);
  await run('next'); assert.match(messages.at(-1).text, /No active pack/);
  await run('tgpack'); time = 31 * 60 * 1000;
  await run('next'); assert.match(messages.at(-1).text, /No active pack/);
});

test('WhatsApp send failure retries the unsent sticker', async () => {
  const seen = [], sent = [];
  let fail = true;
  const importer = createImporter({ getPack: async () => pack, convert: async s => { seen.push(s.id); return Buffer.from([s.id]); }, pause: async () => {} });
  const ctx = context('tgpack', 'alice', 'chat', sent, link);
  ctx.sock.sendMessage = async (_, m) => { if (m.sticker && fail) { fail = false; throw new Error('offline'); } sent.push(m); };
  await importer.handle(ctx);
  ctx.command = 'next'; await importer.handle(ctx);
  assert.deepEqual(seen, [0, 0, 1, 2, 3, 4]);
  assert.equal(sent.filter(m => m.sticker).length, 5);
});

test('bad conversions are counted without losing the rest of a batch', async () => {
  const messages = [];
  const importer = createImporter({ getPack: async () => pack, convert: async s => { if (s.id === 2) throw new Error('bad input'); return Buffer.from([s.id]); }, pause: async () => {} });
  await importer.handle(context('tgpack', 'alice', 'chat', messages, link));
  assert.equal(messages.filter(m => m.sticker).length, 4);
  assert.match(messages.at(-1).text, /skipped 1/);
});

test('cancel during conversion prevents send; simultaneous requests do not duplicate', async () => {
  let release, entered;
  const ready = new Promise(r => { entered = r; });
  const wait = new Promise(r => { release = r; });
  const messages = [];
  const importer = createImporter({ getPack: async () => pack, convert: async () => { entered(); await wait; return Buffer.from('sticker'); }, pause: async () => {} });
  const running = importer.handle(context('tgpack', 'alice', 'chat', messages, link));
  await ready;
  await importer.handle(context('next', 'alice', 'chat', messages));
  assert.match(messages.at(-1).text, /still processing/);
  await importer.handle(context('tgpack', 'bob', 'chat', messages, link));
  assert.match(messages.at(-1).text, /Another sticker batch/);
  await importer.handle(context('cancel', 'alice', 'chat', messages));
  release(); await running;
  assert.equal(messages.filter(m => m.sticker).length, 0);
});

test('real static/TGS/WebM conversion preserves animation and labels within limits', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xtreme-test-'));
  const oldPost = axios.post, oldGet = axios.get;
  const oldToken = config.telegramBotToken;
  config.telegramBotToken = '123:test';
  try {
    const animation = { v: '5.5.2', fr: 20, ip: 0, op: 20, w: 512, h: 512, nm: 'Moving red square', ddd: 0,
      assets: [], layers: [{ ddd: 0, ind: 1, ty: 1, nm: 'Square', sw: 80, sh: 80, sc: '#ff0000', ip: 0, op: 20, st: 0,
        ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 1, k: [{ t: 0, s: [100, 100, 0], e: [350, 350, 0], o: { x: 0.33, y: 0.33 }, i: { x: 0.67, y: 0.67 } }, { t: 20, s: [350, 350, 0] }] }, a: { a: 0, k: [0, 0, 0] }, s: { a: 0, k: [100, 100, 100] } } }] };
    await execFile('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=256x256:rate=20', '-t', '1', '-c:v', 'libvpx-vp9', '-threads', '1', path.join(dir, 'video.webm')]);
    const sources = {
      static: await sharp({ create: { width: 256, height: 128, channels: 4, background: '#ff000080' } }).webp().toBuffer(),
      tgs: zlib.gzipSync(JSON.stringify(animation)), video: await fs.readFile(path.join(dir, 'video.webm'))
    };
    axios.post = async (_, { file_id }) => ({ data: { ok: true, result: { file_path: `stickers/${file_id}`, file_size: sources[file_id].length } } });
    axios.get = async url => ({ data: sources[url.split('/').at(-1)] });
    for (const [id, flags] of [['static', {}], ['tgs', { is_animated: true }], ['video', { is_video: true }]]) {
      const result = await convertSticker({ file_id: id, ...flags }, { pack: 'MONTAI', author: 'Toman' });
      const meta = await sharp(result, { animated: true }).metadata();
      assert.equal(meta.width, 512); assert.equal(meta.pageHeight || meta.height, 512);
      assert.ok(result.length <= (id === 'static' ? 100 : 500) * 1024);
      assert.ok(result.includes(Buffer.from('MONTAI')));
      assert.ok(result.includes(Buffer.from('Toman')));
      if (id !== 'static') {
        assert.ok(meta.pages > 1, `${id} has multiple frames`);
        assert.ok(meta.delay.reduce((a, b) => a + b, 0) <= 10000);
        const first = await sharp(result, { page: 0 }).raw().toBuffer();
        const last = await sharp(result, { page: meta.pages - 1 }).raw().toBuffer();
        assert.notDeepEqual(first, last, `${id} really moves`);
      } else assert.equal(meta.hasAlpha, true);
      const relabeled = labelWebp(result, 'NEW', 'Owner');
      assert.ok(!relabeled.includes(Buffer.from('MONTAI')));
      await sharp(relabeled).metadata();
    }
  } finally { axios.post = oldPost; axios.get = oldGet; config.telegramBotToken = oldToken; await fs.rm(dir, { recursive: true, force: true }); }
});
