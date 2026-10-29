const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
const sharp = require('sharp');
let engineCheck;
function videoEngineAvailable() {
  if (!engineCheck) engineCheck = Promise.all([
    execFile('ffmpeg', ['-hide_banner', '-encoders'], { timeout: 10000, maxBuffer: 1024 * 1024 }),
    execFile('ffprobe', ['-version'], { timeout: 10000, maxBuffer: 65536 })
  ]).then(([result]) => result.stdout.includes('libwebp_anim')).catch(() => false);
  return engineCheck;
}

async function inspectAnimated(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 512000) throw new Error('Animation exceeds 500 KiB.');
  const meta = await sharp(bytes, { animated: true, limitInputPixels: 512 * 512 * 200 }).metadata();
  const duration = (meta.delay || []).reduce((sum, value) => sum + value, 0);
  if (meta.width !== 512 || meta.pageHeight !== 512 || meta.pages < 2 || !duration || duration > 10000) {
    throw new Error('Animation validation failed; a still image will not be accepted.');
  }
  return { frames: meta.pages, duration, bytes: bytes.length };
}

async function convertVideo(source) {
  if (!Buffer.isBuffer(source) || !source.length || source.length > 5 * 1024 * 1024) throw new Error('Video exceeds 5 MB.');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xtreme-video-'));
  try {
    const input = path.join(dir, 'input.webm'), output = path.join(dir, 'sticker.webp');
    await fs.writeFile(input, source);
    const { stdout } = await execFile('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height', '-show_entries', 'format=duration', '-of', 'json', input], { timeout: 15000, maxBuffer: 65536 });
    const info = JSON.parse(stdout), stream = info.streams?.find(s => s.width && s.height);
    const seconds = Number(info.format?.duration);
    if (!stream || stream.width > 1024 || stream.height > 1024 || !Number.isFinite(seconds) || seconds <= 0 || seconds > 60) throw new Error('Unsupported video.');
    const decoder = stream.codec_name === 'vp9' ? ['-c:v', 'libvpx-vp9'] : stream.codec_name === 'vp8' ? ['-c:v', 'libvpx'] : [];
    // Speed-first video presets: avoid an expensive high-bitrate attempt that
    // routinely exceeded 500 KiB on the real anime video pack.
    for (const [fps, quality] of [[10, 45], [8, 30], [6, 20]]) {
      await execFile('ffmpeg', ['-v', 'error', '-nostdin', '-y', '-threads', '1', '-filter_threads', '1', '-filter_complex_threads', '1', ...decoder, '-i', input,
        '-t', '10', '-vf', `fps=${fps},scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,format=bgra`,
        '-an', '-c:v', 'libwebp_anim', '-compression_level', '0', '-quality', String(quality), '-loop', '0', '-threads', '1', output], { timeout: 60000, maxBuffer: 65536 });
      const bytes = await fs.readFile(output);
      if (bytes.length > 512000) continue;
      await inspectAnimated(bytes);
      return bytes;
    }
    throw new Error('Video cannot fit WhatsApp’s animation size limit.');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

// One job at a time, two bounded workers. Completed outputs are content-addressed
// in RAM (32 MiB LRU); no Telegram URLs or credentials are exposed to clients.
function createBatchConverter({ download, convert = convertVideo, now = Date.now }) {
  const jobs = new Map(), cache = new Map();
  let running = false, cacheBytes = 0;
  const maxBytes = 32 * 1024 * 1024;
  const prune = () => { for (const [id, job] of jobs) if (job.expires < now() && job.state !== 'working') jobs.delete(id); };
  function start(items, id) {
    prune();
    const key = items.map(item => item.id).join('\0');
    const existing = [...jobs.values()].find(job => job.key === key && job.expires > now() && (job.state === 'working' || job.errors.length === 0));
    if (existing) return existing;
    if (running) { const e = new Error('Another pack is converting. Please retry shortly.'); e.code = 'BUSY'; throw e; }
    while (jobs.size >= 2) jobs.delete(jobs.keys().next().value);
    const job = { id, key, state: 'working', total: items.length, completed: 0, errors: [], results: new Array(items.length), bytes: 0, expires: now() + 30 * 60000 };
    jobs.set(id, job); running = true;
    let cursor = 0;
    const work = async () => {
      while (cursor < items.length) {
        const index = cursor++, item = items[index];
        try {
          if (now() > job.expires) throw new Error('Job expired.');
          let bytes = cache.get(item.id);
          if (bytes) { cache.delete(item.id); cache.set(item.id, bytes); }
          else {
            bytes = await convert(await download(item));
            await inspectAnimated(bytes);
            while (cacheBytes + bytes.length > maxBytes && cache.size) { const key = cache.keys().next().value; cacheBytes -= cache.get(key).length; cache.delete(key); }
            cache.set(item.id, bytes); cacheBytes += bytes.length;
          }
          if (job.bytes + bytes.length > maxBytes) throw new Error('Converted pack exceeds the 32 MB job limit.');
          job.results[index] = bytes; job.bytes += bytes.length;
        } catch {
          job.errors.push({ index, error: 'Video conversion failed validation. No static substitute was created.' });
        } finally { job.completed++; }
      }
    };
    job.finished = Promise.all([work(), work()]).then(() => { job.state = 'ready'; running = false; });
    return job;
  }
  function get(id) { prune(); return jobs.get(id); }
  function status(job) { return { id: job.id, state: job.state, total: job.total, completed: job.completed, errors: job.errors, expires: job.expires }; }
  return { start, get, status };
}
module.exports = { convertVideo, inspectAnimated, createBatchConverter, videoEngineAvailable };
