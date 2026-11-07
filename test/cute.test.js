const { test } = require('node:test');
const assert = require('node:assert/strict');

const { handleVV, resetOwnerLidCache } = require('../src/bot');
const config = require('../config');

// Injected downloader: no network, no real WhatsApp media.
const deps = {
  download: async () => {
    async function* gen() { yield Buffer.from('fake-image-bytes'); }
    return gen();
  }
};

// A downloader that always fails, to exercise the error path.
const failingDeps = {
  download: async () => { throw new Error('download exploded'); }
};

// The owner JID the command must target, taken from the same config the bot uses.
const OWNER = config.ownerNumbers[0];
const OWNER_JID = `${OWNER}@s.whatsapp.net`;
const STRANGER = '2348012345678';
const GROUP = 'group@g.us';

// A LID that maps to the owner, and one that maps to nobody we know.
const OWNER_LID = '111222333444555@lid';
const STRANGER_LID = '999888777666555@lid';

// Stand-in for Baileys' LID<->PN store, wired the same way the real socket exposes it.
function lidStore(map = {}) {
  return {
    signalRepository: {
      lidMapping: {
        getPNForLID: async jid => map[jid] || null
      }
    }
  };
}

// `key` overrides let a test place the sender in whichever field the real
// addressing mode would use (participant vs participantAlt vs a bare LID).
function harness({ quoted, remoteJid = GROUP, sender = OWNER, key = {}, failOwner = false, lidMap = {} } = {}) {
  const sent = [];
  const sock = {
    user: { id: '2349999999999:12@s.whatsapp.net' },
    ...lidStore(lidMap),
    sendMessage: async (jid, content, options) => {
      if (failOwner && jid === OWNER_JID) throw new Error('dm blocked');
      sent.push({ jid, content, options });
    }
  };
  const msg = {
    key: { remoteJid, participant: `${sender}@s.whatsapp.net`, ...key },
    message: { extendedTextMessage: { text: 'cute', contextInfo: quoted ? { quotedMessage: quoted } : {} } }
  };
  return { sent, sock, msg };
}

const viewOnceImage = { viewOnceMessageV2: { message: { imageMessage: { mimetype: 'image/jpeg', caption: 'hi' } } } };

// Messages the bot sent into the chat where the command was used.
const toOrigin = (h, jid = GROUP) => h.sent.filter(s => s.jid === jid);

// The owner must be recognised and get the full behaviour in every sender format.
const ownerFormats = [
  ['plain digits in participant', { sender: OWNER }],
  ['with a leading +', { sender: `+${OWNER}` }],
  ['as a full JID', { sender: `${OWNER}@s.whatsapp.net` }],
  ['with a device suffix', { sender: `${OWNER}:12` }],
  ['in participantAlt only (PN-addressed group message)', { sender: STRANGER, key: { participant: `${STRANGER}@s.whatsapp.net`, participantAlt: `${OWNER}@s.whatsapp.net` } }],
  ['in remoteJidAlt only', { sender: STRANGER, key: { participant: `${STRANGER}@s.whatsapp.net`, remoteJidAlt: `${OWNER}@s.whatsapp.net` } }],
  ['as a LID resolvable through the LID store', { sender: STRANGER, key: { participant: STRANGER_LID, participantAlt: STRANGER_LID }, lidMap: { [STRANGER_LID]: `${OWNER}@s.whatsapp.net` } }]
];

for (const [label, options] of ownerFormats) {
  test(`owner recognised when the number arrives ${label}`, async () => {
    const h = harness({ quoted: viewOnceImage, ...options });
    assert.equal(await handleVV(h.sock, h.msg, 'cute', deps), true);

    assert.equal(h.sent.length, 2, 'owner gets exactly two sends');
    const [first, second] = h.sent;
    assert.equal(first.jid, GROUP, 'view-once goes to the chat where the command was used');
    assert.equal(first.content.viewOnce, true, 'first send is view-once');
    assert.ok(Buffer.isBuffer(first.content.image), 'first send carries the image');
    assert.equal(second.jid, OWNER_JID, 'normal copy goes to the owner personal chat');
    assert.equal(second.content.viewOnce, undefined, 'DM copy is NOT view-once');
  });
}

test('owner: view-once in the current chat plus a normal copy in the owner DM', async () => {
  const h = harness({ quoted: viewOnceImage });
  assert.equal(await handleVV(h.sock, h.msg, 'cute', deps), true);

  assert.equal(h.sent.length, 2, 'exactly two sends');

  const [first, second] = h.sent;
  assert.equal(first.jid, GROUP, 'first send goes to the chat where the command was used');
  assert.equal(first.content.viewOnce, true, 'first send is view-once');
  assert.ok(Buffer.isBuffer(first.content.image), 'first send carries the image');
  assert.equal(first.content.caption, 'hi', 'caption preserved');

  assert.equal(second.jid, OWNER_JID, 'second send goes to the owner personal chat');
  assert.equal(second.content.viewOnce, undefined, 'second send is NOT view-once');
  assert.ok(Buffer.isBuffer(second.content.image), 'second send carries the image');
  assert.equal(second.content.caption, 'hi', 'caption preserved on the DM copy');
});

test('non-owner: zero messages to the originating chat, diagnostic to the owner DM only', async () => {
  const h = harness({ quoted: viewOnceImage, sender: STRANGER });
  assert.equal(await handleVV(h.sock, h.msg, 'cute', deps), true);

  assert.equal(toOrigin(h).length, 0, 'nothing at all is sent to the triggering chat');
  assert.equal(h.sent.length, 1, 'only the owner DM notice is sent');
  assert.equal(h.sent[0].jid, OWNER_JID, 'the notice goes to the owner DM');
  assert.match(h.sent[0].content.text, /non-owner/i);
  assert.ok(!h.sent.some(s => s.content.viewOnce), 'no view-once image is sent for a non-owner');
});

test('non-owner sending from a LID still gets nothing in the chat', async () => {
  const h = harness({
    quoted: viewOnceImage,
    sender: STRANGER,
    key: { participant: STRANGER_LID, participantAlt: STRANGER_LID },
    lidMap: { [STRANGER_LID]: `${STRANGER}@s.whatsapp.net` }
  });
  assert.equal(await handleVV(h.sock, h.msg, 'cute', deps), true);
  assert.equal(toOrigin(h).length, 0, 'nothing at all is sent to the triggering chat');
  assert.equal(h.sent.length, 1, 'only the owner DM notice is sent');
  assert.equal(h.sent[0].jid, OWNER_JID);
});

test('non-owner with no quoted media still gets nothing in the chat', async () => {
  const h = harness({ quoted: null, sender: STRANGER });
  assert.equal(await handleVV(h.sock, h.msg, 'cute', deps), true);
  assert.equal(toOrigin(h).length, 0, 'no usage hint leaks into the chat');
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].jid, OWNER_JID);
});

test('owner usage error (no quoted media) goes to the owner DM, not the chat', async () => {
  const h = harness({ quoted: null });
  assert.equal(await handleVV(h.sock, h.msg, 'cute', deps), true);
  assert.equal(toOrigin(h).length, 0, 'the chat stays silent');
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].jid, OWNER_JID);
  assert.match(h.sent[0].content.text, /Reply to a view-once/i);
});

test('owner unsupported media error goes to the owner DM, not the chat', async () => {
  const h = harness({ quoted: { viewOnceMessageV2: { message: { stickerMessage: {} } } } });
  assert.equal(await handleVV(h.sock, h.msg, 'cute', deps), true);
  assert.equal(toOrigin(h).length, 0, 'the chat stays silent');
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].jid, OWNER_JID);
  assert.match(h.sent[0].content.text, /no supported view-once media/i);
});

test('owner download failure is reported to the owner DM only and never throws', async () => {
  const h = harness({ quoted: viewOnceImage });
  assert.equal(await handleVV(h.sock, h.msg, 'cute', failingDeps), true);
  assert.equal(toOrigin(h).length, 0, 'the chat stays silent');
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].jid, OWNER_JID);
  assert.match(h.sent[0].content.text, /failed/i);
});

test('a failing DM copy does not break the command or lose the view-once send', async () => {
  const h = harness({ quoted: viewOnceImage, failOwner: true });
  assert.equal(await handleVV(h.sock, h.msg, 'cute', deps), true);
  const viewOnceSends = h.sent.filter(s => s.content.viewOnce === true);
  assert.equal(viewOnceSends.length, 1, 'view-once send still happened');
  assert.equal(viewOnceSends[0].jid, GROUP, 'view-once went to the chat');
  assert.equal(toOrigin(h).length, 1, 'the chat gets only the view-once image, no warning');
});

test('a throwing owner check stays silent in the chat and reports to the owner DM', async () => {
  const h = harness({ quoted: viewOnceImage });
  h.sock.signalRepository.lidMapping.getPNForLID = async () => { throw new Error('lid store down'); };
  // Force the LID path so the throwing store is actually consulted.
  h.msg.key.participant = STRANGER_LID;
  h.msg.key.participantAlt = STRANGER_LID;
  assert.equal(await handleVV(h.sock, h.msg, 'cute', deps), true);
  assert.equal(toOrigin(h).length, 0, 'the chat stays silent');
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].jid, OWNER_JID);
});

test('cute works in a private chat too, still sending both copies', async () => {
  const h = harness({ quoted: viewOnceImage, remoteJid: OWNER_JID });
  await handleVV(h.sock, h.msg, 'cute', deps);
  assert.equal(h.sent.length, 2);
  assert.equal(h.sent[0].content.viewOnce, true);
  assert.equal(h.sent[1].content.viewOnce, undefined);
});

test('cute ignores non-cute text entirely', async () => {
  const h = harness({ quoted: viewOnceImage });
  assert.equal(await handleVV(h.sock, h.msg, 'hello', deps), false);
  assert.equal(h.sent.length, 0);
});

// The reported bug: a LID-addressed message carries only the owner's LID (plus a
// non-owner phone number in the alternate fields), so the owner is recognised by
// resolving their LID from the number we already trust (PN -> LID).
test('owner recognised for cute when the message is LID-addressed and carries only the owner LID', async () => {
  resetOwnerLidCache();
  const h = harness({
    quoted: viewOnceImage,
    sender: STRANGER,
    key: {
      remoteJid: OWNER_LID,
      participant: OWNER_LID,
      participantAlt: `${STRANGER}@s.whatsapp.net`
    }
  });
  h.sock.signalRepository.lidMapping.getLIDForPN = async pn => pn === `${OWNER}@s.whatsapp.net` ? OWNER_LID : null;
  h.sock.signalRepository.lidMapping.getPNForLID = async () => null;

  assert.equal(await handleVV(h.sock, h.msg, 'cute', deps), true);
  assert.equal(h.sent.length, 2, 'owner gets exactly two sends');
  const [first, second] = h.sent;
  assert.equal(first.jid, OWNER_LID, 'view-once goes to the LID chat where the command was used');
  assert.equal(first.content.viewOnce, true, 'first send is view-once');
  assert.equal(second.jid, OWNER_JID, 'normal copy goes to the owner personal chat');
  assert.equal(second.content.viewOnce, undefined, 'DM copy is NOT view-once');
  resetOwnerLidCache();
});
