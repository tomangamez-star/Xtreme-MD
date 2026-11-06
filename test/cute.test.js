const { test } = require('node:test');
const assert = require('node:assert/strict');

const { handleVV } = require('../src/bot');
const config = require('../config');

// Injected downloader: no network, no real WhatsApp media.
const deps = {
  download: async () => {
    async function* gen() { yield Buffer.from('fake-image-bytes'); }
    return gen();
  }
};

// The owner JID the command must target, taken from the same config the bot uses.
const OWNER = config.ownerNumbers[0];
const OWNER_JID = `${OWNER}@s.whatsapp.net`;

function harness({ quoted, remoteJid = 'group@g.us', failOwner = false } = {}) {
  const sent = [];
  const sock = {
    user: { id: '2349999999999:12@s.whatsapp.net' },
    sendMessage: async (jid, content, options) => {
      if (failOwner && jid === OWNER_JID) throw new Error('dm blocked');
      sent.push({ jid, content, options });
    }
  };
  const msg = {
    key: { remoteJid, participant: '2348012345678@s.whatsapp.net' },
    message: { extendedTextMessage: { text: 'cute', contextInfo: quoted ? { quotedMessage: quoted } : {} } }
  };
  return { sent, sock, msg };
}

const viewOnceImage = { viewOnceMessageV2: { message: { imageMessage: { mimetype: 'image/jpeg', caption: 'hi' } } } };

test('cute sends view-once to the current chat and a normal copy to the owner DM', async () => {
  const h = harness({ quoted: viewOnceImage });
  assert.equal(await handleVV(h.sock, h.msg, 'cute', deps), true);

  assert.equal(h.sent.length, 2, 'exactly two sends');

  const [first, second] = h.sent;
  assert.equal(first.jid, 'group@g.us', 'first send goes to the chat where the command was used');
  assert.equal(first.content.viewOnce, true, 'first send is view-once');
  assert.ok(Buffer.isBuffer(first.content.image), 'first send carries the image');
  assert.equal(first.content.caption, 'hi', 'caption preserved');

  assert.equal(second.jid, OWNER_JID, 'second send goes to the owner personal chat');
  assert.equal(second.content.viewOnce, undefined, 'second send is NOT view-once');
  assert.ok(Buffer.isBuffer(second.content.image), 'second send carries the image');
  assert.equal(second.content.caption, 'hi', 'caption preserved on the DM copy');
});

test('cute works in a private chat too, still sending both copies', async () => {
  const h = harness({ quoted: viewOnceImage, remoteJid: '2348012345678@s.whatsapp.net' });
  await handleVV(h.sock, h.msg, 'cute', deps);
  assert.equal(h.sent.length, 2);
  assert.equal(h.sent[0].content.viewOnce, true);
  assert.equal(h.sent[1].content.viewOnce, undefined);
});

test('a failing DM copy does not break the command or lose the view-once send', async () => {
  const h = harness({ quoted: viewOnceImage, failOwner: true });
  assert.equal(await handleVV(h.sock, h.msg, 'cute', deps), true);
  const viewOnceSends = h.sent.filter(s => s.content.viewOnce === true);
  assert.equal(viewOnceSends.length, 1, 'view-once send still happened');
  const warning = h.sent.find(s => typeof s.content.text === 'string');
  assert.ok(warning, 'user is told the DM copy failed');
  assert.match(warning.content.text, /personal chat failed/i);
});

test('cute ignores non-cute text and unsupported media', async () => {
  const h = harness({ quoted: viewOnceImage });
  assert.equal(await handleVV(h.sock, h.msg, 'hello', deps), false);
  assert.equal(h.sent.length, 0);

  const bad = harness({ quoted: { viewOnceMessageV2: { message: { stickerMessage: {} } } } });
  assert.equal(await handleVV(bad.sock, bad.msg, 'cute', deps), true);
  assert.equal(bad.sent.length, 1);
  assert.match(bad.sent[0].content.text, /no supported view-once media/i);
});

test('cute without a quoted message explains usage', async () => {
  const h = harness({ quoted: null });
  assert.equal(await handleVV(h.sock, h.msg, 'cute', deps), true);
  assert.equal(h.sent.length, 1);
  assert.match(h.sent[0].content.text, /Reply to a view-once/i);
});
