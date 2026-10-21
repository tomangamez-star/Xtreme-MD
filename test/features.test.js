const { test } = require('node:test');
const assert = require('node:assert/strict');
const { proto, generateWAMessageContent } = require('@whiskeysockets/baileys');
const { createGroupStatus } = require('../src/group-status');
const { parseRepeat, createRepeater } = require('../src/repeat');
const { parseCommand, digits } = require('../src/utils');
const { renderMenu } = require('../src/menu');
const { runCommand } = require('../src/commands');
function ctx(query = '', quoted) {
  const sent = [], relays = [];
  return { sent, relays, query, command: 'gstatus', sender: 'admin', isAdmin: true, isGroup: true, isBotAdmin: true,
    msg: { key: { remoteJid: 'test@g.us' }, message: { extendedTextMessage: { text: 'Xgstatus', contextInfo: quoted ? { quotedMessage: quoted } : {} } } },
    sock: { waUploadToServer: () => {}, sendMessage: async (jid, content) => { sent.push({ jid, ...content }); }, relayMessage: async (jid, content, options) => { relays.push({ jid, content, options }); } } };
}

test('prefixes and category menus work through actual command registry', async () => {
  for (const input of ['Xspam 5 enjoy', '/spam 5 enjoy', '.spam 5 enjoy']) assert.deepEqual(parseCommand(input), { command: 'spam', query: '5 enjoy' });
  assert.equal(parseCommand('xmenu'), null);
  assert.equal(digits('23412345:12@s.whatsapp.net'), '23412345');
  assert.match(renderMenu('stickers'), /Xtgpack/);
  assert.doesNotMatch(renderMenu('stickers'), /Xkick/);
  assert.match(renderMenu('all'), /Xgstatus/);
  const c = ctx('group'); c.command = 'menu';
  assert.equal(await runCommand(c), true);
  assert.match(c.sent[0].text, /Xspam/);
  assert.equal(c.sent[0].interactiveButtons[0].name, 'single_select');
  assert.match(renderMenu('missing'), /MODULE UNKNOWN/);
});

test('group status gates private chat, requester role and bot role', async () => {
  const handler = createGroupStatus({ owner: () => false });
  for (const flag of ['isGroup', 'isAdmin', 'isBotAdmin']) {
    const c = ctx('Hello'); c[flag] = false; await handler(c);
    assert.equal(c.relays.length, 0); assert.equal(c.sent.length, 1);
  }
});

test('text status uses native group wrapper, proto roundtrip and group JID only', async () => {
  const c = ctx('', { conversation: 'An announcement' });
  const handler = createGroupStatus({ owner: () => false, messageId: () => 'id' });
  await handler(c);
  assert.equal(c.relays.length, 1); assert.equal(c.relays[0].jid, 'test@g.us');
  const decoded = proto.Message.decode(proto.Message.encode(c.relays[0].content).finish());
  assert.equal(decoded.groupStatusMessageV2.message.extendedTextMessage.text, 'An announcement');
  assert.match(c.sent.at(-1).text, /submitted/);
});

test('image/video/GIF/audio status preserves captions and selects correct content', async () => {
  for (const type of ['image', 'video', 'audio']) {
    let received;
    const c = ctx('', { [`${type}Message`]: { caption: 'Caption', mimetype: `${type}/test`, gifPlayback: true } });
    const handler = createGroupStatus({ owner: () => false,
      download: async (_, gotType) => { assert.equal(gotType, type); return Buffer.from('media'); },
      generate: async content => { received = content; return { [`${type}Message`]: { caption: content.caption, mimetype: content.mimetype } }; }
    });
    await handler(c); assert.equal(c.relays.length, 1); assert.ok(Buffer.isBuffer(received[type]));
    if (type !== 'audio') assert.equal(received.caption, 'Caption');
    if (type === 'video') assert.equal(received.gifPlayback, true);
    if (type === 'audio') assert.equal(received.ptt, true);
  }
});

test('unsupported statuses and failed sends do not claim success', async () => {
  const handler = createGroupStatus({ owner: () => false });
  for (const quoted of [{ stickerMessage: {} }, { viewOnceMessageV2: { message: { imageMessage: {} } } }]) {
    const c = ctx('', quoted); await handler(c); assert.equal(c.relays.length, 0);
  }
  const c = ctx('hello'); c.sock.relayMessage = async () => { throw new Error('failure'); };
  await handler(c); assert.doesNotMatch(c.sent.at(-1).text, /✅/);
});

test('repeat validates counts, pacing, text and command-loop prevention', () => {
  assert.deepEqual(parseRepeat('5 enjoy'), { count: 5, seconds: 10, text: 'enjoy' });
  assert.equal(parseRepeat('5 20s enjoy life').seconds, 20);
  for (const text of ['0 hello', '21 hello', '5 1s hello', '5', '5 /spam 5 loop', '5 Xmenu', '5 121s hello']) assert.throws(() => parseRepeat(text));
});

test('repeat sends exactly five over ten seconds, stays in same chat and is owner-only', async () => {
  const waits = [];
  const repeater = createRepeater({ owner: sender => sender === 'admin', pause: async ms => { waits.push(ms); } });
  const c = ctx('5 enjoy'); c.command = 'spam';
  await repeater.handle(c); await repeater.waitIdle();
  assert.deepEqual(c.sent.map(m => m.text), Array(5).fill('enjoy'));
  assert.ok(c.sent.every(m => m.jid === 'test@g.us'));
  assert.deepEqual(waits, Array(4).fill(2500));
  const denied = ctx('5 enjoy'); denied.sender = 'group-admin'; denied.isAdmin = true;
  await repeater.handle(denied); assert.match(denied.sent[0].text, /owner only/i);
});

test('repeat cancels pending timer and rejects concurrent job in same chat', async () => {
  let entered;
  const ready = new Promise(r => { entered = r; });
  const repeater = createRepeater({ owner: () => true, pause: (_, signal) => new Promise((_, reject) => { entered(); signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); }) });
  const c = ctx('5 enjoy'); c.command = 'spam';
  await repeater.handle(c); await ready;
  const duplicate = ctx('3 hi'); duplicate.command = 'repeat';
  await repeater.handle(duplicate); assert.match(duplicate.sent[0].text, /already running/);
  const stop = ctx(); stop.command = 'stopspam'; await repeater.handle(stop);
  await repeater.waitIdle(); assert.equal(c.sent.length, 1);
});

test('repeat stops after send failure and releases job for future requests', async () => {
  const repeater = createRepeater({ owner: () => true, pause: async () => {} });
  const c = ctx('5 enjoy'); c.command = 'spam';
  c.sock.sendMessage = async (_, content) => { if (content.text === 'enjoy') throw new Error('offline'); c.sent.push(content); };
  await repeater.handle(c); await repeater.waitIdle();
  assert.match(c.sent[0].text, /could not be sent/);
  const again = ctx('1 retry'); again.command = 'spam'; await repeater.handle(again); await repeater.waitIdle();
  assert.equal(again.sent[0].text, 'retry');
});
