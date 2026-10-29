// Usage: node scripts/verify-video-pack.js SERVER PACK OUTPUT_DIR
// Public read-only requests only. Source files stay in OUTPUT_DIR, not the repo.
const fs = require('node:fs/promises');
const path = require('node:path');
const axios = require('axios');
const { createBatchConverter, convertVideo, inspectAnimated } = require('../src/sticker-video');

async function main() {
  const [base, name, dir] = process.argv.slice(2);
  if (!base || !name || !dir) throw new Error('SERVER PACK OUTPUT_DIR required');
  await fs.mkdir(dir, { recursive: true });
  const { data: pack } = await axios.get(`${base}/api/stickers/packs/${encodeURIComponent(name)}`, { timeout: 90000 });
  if (!pack.stickers?.length || pack.stickers.some(s => s.format !== 'webm')) throw new Error('Expected an all-WebM pack');
  const byId = new Map(pack.stickers.map((s, i) => [s.ticket, i]));
  const batch = createBatchConverter({
    download: async item => {
      const index = byId.get(item.id), file = path.join(dir, `${index}.webm`);
      try { return await fs.readFile(file); } catch {}
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const { data } = await axios.get(`${base}/api/stickers/files/${item.id}`, { responseType: 'arraybuffer', timeout: 60000, maxContentLength: 5 * 1024 * 1024 });
          const bytes = Buffer.from(data); await fs.writeFile(file, bytes); return bytes;
        } catch { if (attempt === 2) throw new Error('Source download failed'); await new Promise(resolve => setTimeout(resolve, 500)); }
      }
    },
    convert: async source => { const bytes = await convertVideo(source); return bytes; }
  });
  const started = Date.now();
  const job = batch.start(pack.stickers.map(s => ({ id: s.ticket })), 'local-test');
  const timer = setInterval(() => console.log(`progress=${job.completed}/${job.total} failed=${job.errors.length}`), 10000);
  try { await job.finished; } finally { clearInterval(timer); }
  const results = [];
  for (let i = 0; i < job.results.length; i++) {
    if (!job.results[i]) { results.push({ index: i, failed: true }); continue; }
    const bytes = job.results[i], meta = await inspectAnimated(bytes);
    await fs.writeFile(path.join(dir, `${i}-fixed.webp`), bytes); results.push({ index: i, ...meta });
  }
  const summary = { pack: name, total: job.total, passed: results.filter(r => !r.failed).length, failed: job.errors, elapsedMs: Date.now() - started, results };
  await fs.writeFile(path.join(dir, 'validation.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ pack: name, total: summary.total, passed: summary.passed, failed: summary.failed.length, elapsedMs: summary.elapsedMs }));
  if (summary.passed !== summary.total) process.exitCode = 1;
}
main().catch(() => { console.error('Verification failed; inspect local test inputs and server availability.'); process.exitCode = 1; });
