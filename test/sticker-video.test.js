const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const execFile = require('node:util').promisify(require('node:child_process').execFile);
const sharp = require('sharp');
const { convertVideo, inspectAnimated, createBatchConverter } = require('../src/sticker-video');

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const input = path.join(dir, 'clip.webm');
  await execFile('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=256x256:rate=30', '-t', '1', '-c:v', 'libvpx-vp9', '-threads', '1', input]);
  return fs.readFile(input);
}
test('WebM conversion preserves decoded motion, dimensions, duration and limits', async t => {
  const source = await fixture(t), bytes = await convertVideo(source), info = await inspectAnimated(bytes);
  assert.ok(info.frames >= 10); assert.ok(info.duration <= 10000); assert.ok(info.bytes <= 512000);
  const first = await sharp(bytes, { page: 0 }).raw().toBuffer();
  const last = await sharp(bytes, { page: info.frames - 1 }).raw().toBuffer();
  assert.notDeepEqual(first, last);
});
test('a still output cannot be silently accepted as animated', async () => {
  const still = await sharp({ create: { width: 512, height: 512, channels: 4, background: '#ff0000' } }).webp().toBuffer();
  await assert.rejects(inspectAnimated(still), /still image/);
});
test('batch is bounded, idempotent, cached, and isolates failed stickers', async t => {
  const bytes = await convertVideo(await fixture(t)); let active = 0, max = 0, converted = 0;
  const engine = createBatchConverter({ download: async item => Buffer.from(item.id), convert: async source => {
    active++; max = Math.max(max, active); converted++;
    try { await new Promise(resolve => setTimeout(resolve, 5)); if (source.toString() === 'bad') throw new Error('bad'); return bytes; }
    finally { active--; }
  }});
  const items = ['a','b','bad'].map(id => ({ id }));
  const job = engine.start(items, 'one'); assert.equal(engine.start(items, 'retry').id, 'one');
  assert.throws(() => engine.start([{ id: 'other' }], 'busy'), /Another pack/);
  await job.finished; assert.equal(max, 2); assert.equal(job.completed, 3); assert.equal(job.errors.length, 1); assert.equal(job.results.filter(Boolean).length, 2);
  const retry = engine.start(items, 'retry-failed'); assert.equal(retry.id, 'retry-failed'); await retry.finished;
  assert.equal(converted, 4); // only the previously failed item is retried
  const next = engine.start([{ id: 'a' },{ id: 'b' }], 'cached'); await next.finished;
  assert.equal(converted, 4); assert.equal(next.errors.length, 0);
});
