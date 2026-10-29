// Local integration test using already retrieved, real WebM files. No bot token
// is read: Telegram HTTP is replaced with a bounded local-fixture adapter.
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const { createStickerApi } = require('../src/sticker-api');
const { inspectAnimated } = require('../src/sticker-video');
const sharp = require('sharp');

async function main() {
  const dir = process.argv[2]; if (!dir) throw new Error('SOURCE_DIR required');
  const stickers = Array.from({ length: 50 }, (_, i) => ({ file_id: `video-${i}`, is_video: true }));
  const http = {
    async post(url, body) {
      if (url.endsWith('getMe')) return { data: { ok: true, result: { id: 1 } } };
      if (url.endsWith('getStickerSet')) return { data: { ok: true, result: { name: 'OshinoKoVid', title: 'Real pack integration fixture', stickers } } };
      const index = Number(body.file_id.replace('video-', ''));
      return { data: { ok: true, result: { file_path: `stickers/${index}.webm`, file_size: (await fs.stat(path.join(dir, `${index}.webm`))).size } } };
    },
    async get(url) { const filename = url.split('/').pop(); return { data: await fs.readFile(path.join(dir, filename)) }; }
  };
  const app = express(); app.use(express.json({ limit: '32kb' })); app.use('/api/stickers', createStickerApi({ token: 'local-fixture-only', http }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const base = `http://127.0.0.1:${server.address().port}/api/stickers`;
    const pack = await (await fetch(base + '/packs/OshinoKoVid')).json();
    const payload = { tickets: pack.stickers.map(s => s.ticket) };
    const post = () => fetch(base + '/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const started = Date.now(), response = await post(); if (response.status !== 202) throw new Error('Job not accepted');
    const job = await response.json(); let status;
    do {
      const result = await fetch(base + '/jobs/' + job.id); if (result.status !== 200) throw new Error('Status request failed');
      status = await result.json(); if (status.state === 'ready') break;
      if (Date.now() - started > 180000) throw new Error('Integration test timeout');
      await new Promise(resolve => setTimeout(resolve, 1500));
    } while (true);
    if (status.errors.length) throw new Error(`${status.errors.length} source conversions failed`);
    const binary = Buffer.from(await (await fetch(base + '/jobs/' + job.id + '/download')).arrayBuffer());
    if (binary.toString('ascii', 0, 4) !== 'XSP2' || binary.readUInt32BE(4) !== 50) throw new Error('Bad packet header');
    const entries = [], seen = new Set(); let offset = 8;
    for (let n = 0; n < 50; n++) {
      const index = binary.readUInt32BE(offset), size = binary.readUInt32BE(offset + 4); offset += 8;
      if (seen.has(index) || index >= 50 || size > 512000) throw new Error('Bad packet record'); seen.add(index);
      const bytes = binary.subarray(offset, offset + size); offset += size;
      const info = await inspectAnimated(bytes);
      const first = await sharp(bytes, { page: 0 }).raw().toBuffer();
      let moving = false;
      for (const page of [...new Set([Math.floor(info.frames / 2), info.frames - 1, 1])]) {
        if (!first.equals(await sharp(bytes, { page }).raw().toBuffer())) { moving = true; break; }
      }
      if (!moving) throw new Error(`Decoded frames show no sampled motion for sticker ${index}`);
      entries.push({ index, ...info, moving });
      await fs.writeFile(path.join(dir, `${index}-turbo.webp`), bytes);
    }
    if (offset !== binary.length) throw new Error('Trailing packet bytes');
    const repeatStarted = Date.now(), repeat = await (await post()).json();
    if (repeat.id !== job.id) throw new Error('Repeat request was not reused');
    const summary = { total: entries.length, animated: entries.length, bytes: binary.length, elapsedMs: Date.now() - started, cachedSubmitMs: Date.now() - repeatStarted, entries };
    await fs.writeFile(path.join(dir, 'batch-integration.json'), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify({ ...summary, entries: undefined }));
  } finally { await new Promise(resolve => server.close(resolve)); }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
