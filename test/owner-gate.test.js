const { test } = require('node:test');
const assert = require('node:assert/strict');

const { handleCommand, buildContext, resetOwnerLidCache } = require('../src/bot');
const config = require('../config');

const OWNER = config.ownerNumbers[0];
const OWNER_JID = `${OWNER}@s.whatsapp.net`;
const STRANGER = '2348012345678';
const GROUP = 'group@g.us';
const OWNER_LID = '111222333444555@lid';
const STRANGER_LID = '999888777666555@lid';

function lidStore(map = {}) {
  return {
    signalRepository: {
      lidMapping: { getPNForLID: async jid => map[jid] || null }
    }
  };
}

// A socket that records every send, so a test can assert on the exact set of
// messages that reached the chat where the command was used.
function harness({ text = 'Xmenu', remoteJid = GROUP, sender = OWNER, key = {}, lidMap = {}, runCommand } = {}) {
  const sent = [];
  const ran = [];
  const sock = {
    user: { id: '2349999999999:12@s.whatsapp.net' },
    ...lidStore(lidMap),
    groupMetadata: async () => ({ subject: 'Test', participants: [] }),
    sendMessage: async (jid, content, options) => { sent.push({ jid, content, options }); }
  };
  const msg = {
    key: { remoteJid, participant: `${sender}@s.whatsapp.net`, ...key },
    message: { extendedTextMessage: { text } }
  };
  const deps = {
    metadata: remoteJid.endsWith('@g.us') ? { subject: 'Test', participants: [] } : null,
    runCommand: runCommand || (async ctx => { ran.push(ctx); })
  };
  return { sent, ran, sock, msg, deps };
}

const toOrigin = (h, jid = GROUP) => h.sent.filter(s => s.jid === jid);

// A representative sample across every command family in the registry.
const SAMPLE = [
  'Xmenu', 'Xping', 'Xalive', 'Xruntime', 'Xowner', 'Xsticker', 'Xtoimg',
  'Xplay funk', 'Xtts hello', 'Xcalc 2+2', 'Xshort https://a.co', 'Xgetpp',
  'Xfact', 'Xquote', 'Xtruth', 'Xdare', 'Xwaifu', 'Xneko',
  'Xwelcome on', 'Xgoodbye off', 'Xantilink on', 'Xkick', 'Xpromote',
  'Xdemote', 'Xtagall', 'Xhidetag', 'Xlink', 'Xrevoke',
  'Xgstatus', 'Xspam 5 hi', 'Xstopspam', 'Xtgpack https://t.me/addstickers/x'
];

for (const text of SAMPLE) {
  test(`non-owner gets zero messages in the chat for ${text}`, async () => {
    const h = harness({ text, sender: STRANGER });
    assert.equal(await handleCommand(h.sock, h.msg, text, h.deps), true);

    assert.equal(toOrigin(h).length, 0, 'nothing at all is sent to the triggering chat');
    assert.equal(h.ran.length, 0, 'the command handler never runs for a non-owner');
    assert.equal(h.sent.length, 1, 'only the owner DM notice is sent');
    assert.equal(h.sent[0].jid, OWNER_JID, 'the notice goes to the owner DM');
    assert.match(h.sent[0].content.text, /non-owner/i);
  });
}

test('non-owner is ignored in a private chat too', async () => {
  const h = harness({ text: 'Xping', remoteJid: `${STRANGER}@s.whatsapp.net`, sender: STRANGER });
  assert.equal(await handleCommand(h.sock, h.msg, 'Xping', h.deps), true);
  assert.equal(h.sent.filter(s => s.jid === `${STRANGER}@s.whatsapp.net`).length, 0);
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].jid, OWNER_JID);
});

test('non-owner sending from a LID still gets nothing in the chat', async () => {
  const h = harness({
    text: 'Xmenu', sender: STRANGER,
    key: { participant: STRANGER_LID, participantAlt: STRANGER_LID },
    lidMap: { [STRANGER_LID]: `${STRANGER}@s.whatsapp.net` }
  });
  assert.equal(await handleCommand(h.sock, h.msg, 'Xmenu', h.deps), true);
  assert.equal(toOrigin(h).length, 0);
  assert.equal(h.ran.length, 0);
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].jid, OWNER_JID);
});

// The owner must be recognised in every addressing format the bot can receive.
const ownerFormats = [
  ['plain digits in participant', { sender: OWNER }],
  ['with a leading +', { sender: `+${OWNER}` }],
  ['as a full JID', { sender: `${OWNER}@s.whatsapp.net` }],
  ['with a device suffix', { sender: `${OWNER}:12` }],
  ['in participantAlt only', { sender: STRANGER, key: { participant: `${STRANGER}@s.whatsapp.net`, participantAlt: `${OWNER}@s.whatsapp.net` } }],
  ['in remoteJidAlt only', { sender: STRANGER, key: { participant: `${STRANGER}@s.whatsapp.net`, remoteJidAlt: `${OWNER}@s.whatsapp.net` } }],
  ['as a LID resolvable through the LID store', { sender: STRANGER, key: { participant: OWNER_LID, participantAlt: OWNER_LID }, lidMap: { [OWNER_LID]: `${OWNER}@s.whatsapp.net` } }]
];

for (const [label, options] of ownerFormats) {
  test(`owner recognised when the number arrives ${label}`, async () => {
    const h = harness({ text: 'Xping', ...options });
    assert.equal(await handleCommand(h.sock, h.msg, 'Xping', h.deps), true);

    assert.equal(h.ran.length, 1, 'the command handler runs for the owner');
    assert.equal(h.ran[0].command, 'ping');
    assert.equal(h.sent.length, 0, 'the guard itself sends nothing for a successful owner command');
  });
}

test('owner keeps normal behaviour: the handler runs and its reply reaches the chat', async () => {
  const h = harness({
    text: 'Xping',
    runCommand: async ({ sock, msg }) => { await sock.sendMessage(msg.key.remoteJid, { text: 'pong' }); }
  });
  assert.equal(await handleCommand(h.sock, h.msg, 'Xping', h.deps), true);

  assert.equal(h.ran.length, 0, 'injected handler used');
  assert.equal(toOrigin(h).length, 1, 'the owner gets the normal reply in the chat');
  assert.equal(h.sent[0].content.text, 'pong');
});

test('a non-cute command failure is swallowed: no chat message and no owner DM', async () => {
  const h = harness({
    text: 'Xplay boom',
    runCommand: async () => { throw new Error('music api down'); }
  });
  assert.equal(await handleCommand(h.sock, h.msg, 'Xplay boom', h.deps), true);

  assert.equal(toOrigin(h).length, 0, 'the chat stays silent on failure');
  assert.equal(h.sent.length, 0, 'only cute may report to the owner DM');
});

test('a cute command failure is still reported to the owner DM only', async () => {
  const h = harness({
    text: 'Xcute',
    runCommand: async () => { throw new Error('download exploded'); }
  });
  assert.equal(await handleCommand(h.sock, h.msg, 'Xcute', h.deps), true);

  assert.equal(toOrigin(h).length, 0, 'the chat stays silent on failure');
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].jid, OWNER_JID);
  assert.match(h.sent[0].content.text, /download exploded/);
});

test('a throwing owner check stays silent in the chat and reports to the owner DM', async () => {
  const h = harness({ text: 'Xmenu' });
  h.sock.signalRepository.lidMapping.getPNForLID = async () => { throw new Error('lid store down'); };
  h.msg.key.participant = STRANGER_LID;
  h.msg.key.participantAlt = STRANGER_LID;

  assert.equal(await handleCommand(h.sock, h.msg, 'Xmenu', h.deps), true);
  assert.equal(toOrigin(h).length, 0, 'the chat stays silent');
  assert.equal(h.ran.length, 0, 'the command never runs');
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].jid, OWNER_JID);
});

test('a failing owner DM notice never throws out of the guard', async () => {
  const h = harness({ text: 'Xmenu', sender: STRANGER });
  h.sock.sendMessage = async () => { throw new Error('dm blocked'); };
  await assert.doesNotReject(() => handleCommand(h.sock, h.msg, 'Xmenu', h.deps));
});

test('non-command text is not consumed and sends nothing', async () => {
  const h = harness({ text: 'hello there' });
  assert.equal(await handleCommand(h.sock, h.msg, 'hello there', h.deps), false);
  assert.equal(h.sent.length, 0);
  assert.equal(h.ran.length, 0);
});

test('every prefix form is gated the same way', async () => {
  for (const text of ['Xping', '/ping', '.ping']) {
    const h = harness({ text, sender: STRANGER });
    assert.equal(await handleCommand(h.sock, h.msg, text, h.deps), true);
    assert.equal(toOrigin(h).length, 0, `${text} leaks nothing into the chat`);
    assert.equal(h.ran.length, 0);
  }
});

test('buildContext exposes the fields handlers rely on', () => {
  const h = harness({ text: 'Xkick' });
  const ctx = buildContext(h.sock, h.msg, { command: 'kick', query: '' }, { participants: [] }, 123);
  assert.equal(ctx.command, 'kick');
  assert.equal(ctx.isGroup, true);
  assert.equal(ctx.started, 123);
  assert.deepEqual(ctx.mentions, []);
  assert.equal(ctx.isAdmin, false);
  assert.equal(ctx.isBotAdmin, false);
});

// --- The reported bug: a LID-addressed message carries only the owner's LID ------
// The owner's real number never appears in the sender fields (only a LID plus a
// non-owner phone number in the alternate fields), so the only way to recognise the
// owner is to resolve their LID from the number we already trust (PN -> LID).

test('owner recognised when the message is LID-addressed and carries only the owner LID', async () => {
  resetOwnerLidCache();
  const h = harness({
    text: 'Xping',
    sender: STRANGER,
    key: {
      remoteJid: OWNER_LID,
      participant: OWNER_LID,
      participantAlt: `${STRANGER}@s.whatsapp.net`
    }
  });
  // The store resolves the owner's PN -> LID; the reverse (LID -> PN) is stale/absent.
  h.sock.signalRepository.lidMapping.getLIDForPN = async pn => pn === `${OWNER}@s.whatsapp.net` ? OWNER_LID : null;
  h.sock.signalRepository.lidMapping.getPNForLID = async () => null;

  assert.equal(await handleCommand(h.sock, h.msg, 'Xping', h.deps), true);
  assert.equal(h.ran.length, 1, 'the owner command runs');
  assert.equal(h.ran[0].command, 'ping');
  assert.equal(h.sent.length, 0, 'the guard itself sends nothing for a successful owner command');
  resetOwnerLidCache();
});

test('owner recognised via a device-suffixed LID', async () => {
  resetOwnerLidCache();
  const h = harness({
    text: 'Xping',
    sender: STRANGER,
    key: { participant: `${OWNER_LID.split('@')[0]}:12@lid`, participantAlt: `${STRANGER}@s.whatsapp.net` }
  });
  h.sock.signalRepository.lidMapping.getLIDForPN = async pn => pn === `${OWNER}@s.whatsapp.net` ? OWNER_LID : null;
  h.sock.signalRepository.lidMapping.getPNForLID = async () => null;

  assert.equal(await handleCommand(h.sock, h.msg, 'Xping', h.deps), true);
  assert.equal(h.ran.length, 1, 'the owner command runs');
  resetOwnerLidCache();
});

test('a genuine non-owner LID is still ignored even when the store knows the owner LID', async () => {
  resetOwnerLidCache();
  const h = harness({
    text: 'Xping',
    sender: STRANGER,
    key: { participant: STRANGER_LID, participantAlt: STRANGER_LID }
  });
  h.sock.signalRepository.lidMapping.getLIDForPN = async pn => pn === `${OWNER}@s.whatsapp.net` ? OWNER_LID : null;
  h.sock.signalRepository.lidMapping.getPNForLID = async () => null;

  assert.equal(await handleCommand(h.sock, h.msg, 'Xping', h.deps), true);
  assert.equal(h.ran.length, 0, 'the non-owner command never runs');
  assert.equal(h.sent.length, 1, 'only the ignored notice is sent');
  assert.equal(h.sent[0].jid, OWNER_JID);
  resetOwnerLidCache();
});
