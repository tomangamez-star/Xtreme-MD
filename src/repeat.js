const { setTimeout: delay } = require('timers/promises');
const { isOwner, parseCommand } = require('./utils');

function parseRepeat(query) {
  const match = query.match(/^(\d+)\s+(?:(\d+)s\s+)?([\s\S]+)$/i);
  if (!match) throw new Error('Usage: Xspam 5 enjoy OR Xspam 5 10s enjoy');
  const count = Number(match[1]), seconds = Number(match[2] || 10), text = match[3].trim();
  if (count < 1 || count > 20) throw new Error('Choose 1–20 messages.');
  if (seconds < Math.max(1, count - 1) || seconds > 120) throw new Error(`Choose ${Math.max(1, count - 1)}–120 seconds (at least 1 second between repeats).`);
  if (!text || text.length > 1000) throw new Error('Repeat text must be 1–1,000 characters.');
  if (parseCommand(text)) throw new Error('Repeat text cannot start with a bot command prefix.');
  return { count, seconds, text };
}

function createRepeater({ pause = (ms, signal) => delay(ms, undefined, { signal }), owner = isOwner } = {}) {
  const jobs = new Map();
  const say = (ctx, text) => ctx.sock.sendMessage(ctx.msg.key.remoteJid, { text }, { quoted: ctx.msg });
  const allowed = ctx => owner(ctx.sender);
  async function handle(ctx) {
    if (!allowed(ctx)) return say(ctx, 'Bot owner only.');
    const jid = ctx.msg.key.remoteJid;
    if (['stopspam', 'stoprepeat'].includes(ctx.command)) {
      const job = jobs.get(jid);
      if (job) job.controller.abort();
      return say(ctx, job ? 'Repeat stopped. An already-sending message may still arrive.' : 'No repeat is running in this chat.');
    }
    let request;
    try { request = parseRepeat(ctx.query); } catch (error) { return say(ctx, error.message); }
    if (jobs.has(jid)) return say(ctx, 'A repeat is already running here. Use Xstopspam first.');
    if (jobs.size >= 10) return say(ctx, 'The repeat queue is full. Try again later.');
    const job = { controller: new AbortController() };
    jobs.set(jid, job);
    // Keep command handling free while a timer runs; every task catches its own errors.
    job.done = (async () => {
      const signal = job.controller.signal;
      try {
        for (let index = 0; index < request.count; index++) {
          if (signal.aborted) break;
          if (index) await pause(request.seconds * 1000 / (request.count - 1), signal);
          if (signal.aborted) break;
          await ctx.sock.sendMessage(jid, { text: request.text });
        }
      } catch (error) {
        if (!signal.aborted) await say(ctx, 'Repeat stopped because a message could not be sent.').catch(() => {});
      } finally { if (jobs.get(jid) === job) jobs.delete(jid); }
    })();
  }
  return { handle, waitIdle: async () => Promise.all([...jobs.values()].map(job => job.done)) };
}
module.exports = { createRepeater, parseRepeat };
