const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  handleMessage, handleCommand, handleVV,
  isTransientError, noteThrottle, resetThrottle, isThrottled
} = require('../src/bot');
const config = require('../config');

const OWNER = config.ownerNumbers[0];
const OWNER_JID = `${OWNER}@s.whatsapp.net`;
const STRANGER = '2348012345678';
const GROUP = 'group@g.us';

// A socket that records every send, so a test can assert on the exact set of
// messages that reached the owner DM and the chat where the command was used.
function harness({ text = 'Xping', remoteJid = GROUP, sender = OWNER, key = {}, groupMetadata } = {}) {
  const sent = [];
  const sock = {
    user: { id: '2349999999999:12@s.whatsapp.net' },
    signalRepository: { lidMapping: { getPNForLID: async () => null } },
    groupMetadata: groupMetadata || (async () => ({ subject: 'Test', participants: [] })),
    sendMessage: async (jid, content, options) => { sent.push({ jid, content, options }); }
  };
  const msg = {
    key: { remoteJid, participant: `${sender}@s.whatsapp.net`, ...key },
    message: { extendedTextMessage: { text } }
  };
  return { sent, sock, msg };
}

const toOwner = h => h.sent.filter(s => s.jid === OWNER_JID);
const toOrigin = (h, jid = GROUP) => h.sent.filter(s => s.jid === jid);

// A Baileys-shaped throttle error: the status lives on output.statusCode.
const rateOverlimit = () => {
  const error = new Error('rate-overlimit');
  error.output = { statusCode: 429 };
  return error;
};

// --- The reported bug -------------------------------------------------------

test('rate-overlimit during message handling produces zero owner DMs and zero chat messages', async () => {
  resetThrottle();
  const h = harness({
    text: 'Xping',
    groupMetadata: async () => { throw rateOverlimit(); }
  });

  await assert.doesNotReject(() => handleMessage(h.sock, h.msg));

  assert.equal(toOwner(h).length, 0, 'the owner DM is never spammed with throttling');
  assert.equal(toOrigin(h).length, 0, 'the chat stays silent');
  assert.equal(h.sent.length, 0, 'nothing at all is sent');
  resetThrottle();
});

test('a bare rate-overlimit error with no status code is also dropped', async () => {
  resetThrottle();
  const h = harness({
    text: 'Xping',
    groupMetadata: async () => { throw new Error('rate-overlimit'); }
  });

  await handleMessage(h.sock, h.msg);

  assert.equal(h.sent.length, 0, 'no DM, no chat message');
  resetThrottle();
});

test('a stream error carrying 429 is dropped', async () => {
  resetThrottle();
  const error = new Error('stream errored');
  error.data = { status: 429 };
  const h = harness({ text: 'Xping', groupMetadata: async () => { throw error; } });

  await handleMessage(h.sock, h.msg);

  assert.equal(h.sent.length, 0);
  resetThrottle();
});

// --- Only cute may report ---------------------------------------------------

test('a generic non-cute command error produces zero owner DMs', async () => {
  resetThrottle();
  const h = harness({ text: 'Xplay boom' });

  await handleMessage(h.sock, h.msg, {
    runCommand: async () => { throw new Error('music api down'); }
  });

  assert.equal(toOwner(h).length, 0, 'non-cute failures never reach the owner DM');
  assert.equal(toOrigin(h).length, 0, 'and never reach the chat');
  assert.equal(h.sent.length, 0);
  resetThrottle();
});

test('a generic message-handling error produces zero owner DMs', async () => {
  resetThrottle();
  const h = harness({
    text: 'Xping',
    groupMetadata: async () => { throw new Error('metadata unavailable'); }
  });

  await handleMessage(h.sock, h.msg);

  assert.equal(h.sent.length, 0, 'swallowed silently');
  resetThrottle();
});

test('a cute command error still produces exactly one owner DM', async () => {
  resetThrottle();
  const h = harness({ text: 'cute' });
  h.msg.message = {
    extendedTextMessage: {
      text: 'cute',
      contextInfo: { quotedMessage: { viewOnceMessageV2: { message: { imageMessage: { mimetype: 'image/jpeg' } } } } }
    }
  };

  await handleMessage(h.sock, h.msg, {
    download: async () => { throw new Error('download exploded'); }
  });

  assert.equal(toOwner(h).length, 1, 'cute errors are reported to the owner DM');
  assert.match(toOwner(h)[0].content.text, /cute.*failed/i);
  assert.equal(toOrigin(h).length, 0, 'the chat stays silent');
  resetThrottle();
});

test('a cute throttle error is dropped rather than reported', async () => {
  resetThrottle();
  const h = harness({ text: 'cute' });
  h.msg.message = {
    extendedTextMessage: {
      text: 'cute',
      contextInfo: { quotedMessage: { viewOnceMessageV2: { message: { imageMessage: { mimetype: 'image/jpeg' } } } } }
    }
  };

  await handleMessage(h.sock, h.msg, { download: async () => { throw rateOverlimit(); } });

  assert.equal(h.sent.length, 0, 'throttling is never reported, even for cute');
  resetThrottle();
});

// --- Non-owner silence is preserved ----------------------------------------

test('a non-owner still gets zero messages in the originating chat', async () => {
  resetThrottle();
  for (const text of ['Xping', 'Xmenu', 'Xplay funk', 'Xsticker']) {
    const h = harness({ text, sender: STRANGER });
    await handleMessage(h.sock, h.msg, { runCommand: async () => {} });
    assert.equal(toOrigin(h).length, 0, `${text} leaks nothing into the chat`);
    resetThrottle();
  }
});

test('the owner still gets normal replies for every command', async () => {
  resetThrottle();
  const h = harness({ text: 'Xping' });
  await handleMessage(h.sock, h.msg, {
    runCommand: async ({ sock, msg }) => { await sock.sendMessage(msg.key.remoteJid, { text: 'pong' }); }
  });

  assert.equal(toOrigin(h).length, 1, 'the owner reply reaches the chat');
  assert.equal(h.sent[0].content.text, 'pong');
  resetThrottle();
});

// --- Detection & backoff ----------------------------------------------------

test('isTransientError recognises every throttling shape', () => {
  assert.equal(isTransientError(rateOverlimit()), true);
  assert.equal(isTransientError(new Error('rate-overlimit')), true);
  assert.equal(isTransientError(new Error('Rate Overlimit')), true);
  assert.equal(isTransientError(new Error('too many requests')), true);
  assert.equal(isTransientError(Object.assign(new Error('x'), { statusCode: 429 })), true);
  assert.equal(isTransientError(Object.assign(new Error('x'), { status: 429 })), true);
  assert.equal(isTransientError(Object.assign(new Error('x'), { code: 429 })), true);
});

test('isTransientError does not swallow real failures', () => {
  assert.equal(isTransientError(new Error('music api down')), false);
  assert.equal(isTransientError(new Error('download exploded')), false);
  assert.equal(isTransientError(Object.assign(new Error('x'), { statusCode: 500 })), false);
  assert.equal(isTransientError(null), false);
  assert.equal(isTransientError(undefined), false);
});

test('repeated throttling backs off exponentially and caps out', () => {
  resetThrottle();
  assert.equal(isThrottled(), false);

  const first = noteThrottle();
  assert.equal(first, 1000, 'first hit backs off 1s');
  assert.equal(isThrottled(), true, 'messages are dropped while backing off');

  const second = noteThrottle();
  assert.equal(second, 2000, 'the delay doubles');

  let last = 0;
  for (let i = 0; i < 10; i++) last = noteThrottle();
  assert.equal(last, 30000, 'the delay is capped at 30s, never a tight loop');

  resetThrottle();
  assert.equal(isThrottled(), false, 'a success clears the backoff');
});

test('a non-owner message is dropped while throttled, then resumes after the backoff', async () => {
  resetThrottle();
  noteThrottle();

  const h = harness({ text: 'Xping', sender: STRANGER });
  await handleMessage(h.sock, h.msg, {
    runCommand: async ({ sock, msg }) => { await sock.sendMessage(msg.key.remoteJid, { text: 'pong' }); }
  });
  assert.equal(h.sent.length, 0, 'dropped during the backoff window');

  resetThrottle();
  await handleMessage(h.sock, h.msg, {
    runCommand: async ({ sock, msg }) => { await sock.sendMessage(msg.key.remoteJid, { text: 'pong' }); }
  });
  assert.equal(h.sent.length, 1, 'resumes once the backoff clears');
  resetThrottle();
});

// --- The owner is never blocked by the throttle guard -----------------------

test('the owner is not blocked while throttled: the command still runs', async () => {
  resetThrottle();
  noteThrottle();
  assert.equal(isThrottled(), true, 'we really are inside the backoff window');

  const h = harness({ text: 'Xping' });
  await handleMessage(h.sock, h.msg, {
    runCommand: async ({ sock, msg }) => { await sock.sendMessage(msg.key.remoteJid, { text: 'pong' }); }
  });

  assert.equal(toOrigin(h).length, 1, 'the owner reply reaches the chat even while throttled');
  assert.equal(h.sent[0].content.text, 'pong');
  resetThrottle();
});

test('the owner is not blocked while throttled in any sender format', async () => {
  const formats = [
    ['plain digits', { participant: `${OWNER}@s.whatsapp.net` }],
    ['with a leading +', { participant: `+${OWNER}@s.whatsapp.net` }],
    ['as a full JID', { participant: `${OWNER}@s.whatsapp.net` }],
    ['with a device suffix', { participant: `${OWNER}:12@s.whatsapp.net` }],
    ['in participantAlt only', { participant: `${STRANGER}@s.whatsapp.net`, participantAlt: `${OWNER}@s.whatsapp.net` }],
    ['in remoteJidAlt only', { participant: `${STRANGER}@s.whatsapp.net`, remoteJidAlt: `${OWNER}@s.whatsapp.net` }]
  ];

  for (const [label, key] of formats) {
    resetThrottle();
    noteThrottle();
    const h = harness({ text: 'Xping', sender: STRANGER, key });
    await handleMessage(h.sock, h.msg, {
      runCommand: async ({ sock, msg }) => { await sock.sendMessage(msg.key.remoteJid, { text: 'pong' }); }
    });
    assert.equal(toOrigin(h).length, 1, `owner recognised ${label} and not blocked while throttled`);
  }
  resetThrottle();
});

test('the owner is not blocked while throttled when the sender is a LID', async () => {
  resetThrottle();
  noteThrottle();

  const h = harness({
    text: 'Xping',
    sender: STRANGER,
    key: { participant: '111222333444555@lid', participantAlt: '111222333444555@lid' }
  });
  h.sock.signalRepository.lidMapping.getPNForLID = async () => `${OWNER}@s.whatsapp.net`;

  await handleMessage(h.sock, h.msg, {
    runCommand: async ({ sock, msg }) => { await sock.sendMessage(msg.key.remoteJid, { text: 'pong' }); }
  });

  assert.equal(toOrigin(h).length, 1, 'the LID owner is recognised and not blocked');
  resetThrottle();
});

// --- The owner's command output is delivered to the owner DM ----------------

test("the owner's command result is delivered to the owner DM", async () => {
  resetThrottle();
  const h = harness({ text: 'Xping' });
  await handleMessage(h.sock, h.msg, {
    runCommand: async ({ sock, msg }) => { await sock.sendMessage(msg.key.remoteJid, { text: 'pong' }); }
  });

  assert.equal(toOrigin(h).length, 1, 'the normal reply still reaches the chat');
  assert.equal(toOwner(h).length, 1, "the result is also delivered to the owner's DM");
  assert.equal(toOwner(h)[0].content.text, 'pong');
  resetThrottle();
});

test("the owner's command result reaches the owner DM in every sender format", async () => {
  const formats = [
    ['plain digits', { participant: `${OWNER}@s.whatsapp.net` }],
    ['with a leading +', { participant: `+${OWNER}@s.whatsapp.net` }],
    ['as a full JID', { participant: `${OWNER}@s.whatsapp.net` }],
    ['with a device suffix', { participant: `${OWNER}:12@s.whatsapp.net` }],
    ['in participantAlt only', { participant: `${STRANGER}@s.whatsapp.net`, participantAlt: `${OWNER}@s.whatsapp.net` }],
    ['in remoteJidAlt only', { participant: `${STRANGER}@s.whatsapp.net`, remoteJidAlt: `${OWNER}@s.whatsapp.net` }]
  ];

  for (const [label, key] of formats) {
    resetThrottle();
    const h = harness({ text: 'Xping', sender: STRANGER, key });
    await handleMessage(h.sock, h.msg, {
      runCommand: async ({ sock, msg }) => { await sock.sendMessage(msg.key.remoteJid, { text: 'pong' }); }
    });
    assert.equal(toOwner(h).length, 1, `owner DM copy delivered for ${label}`);
    assert.equal(toOwner(h)[0].content.text, 'pong');
  }
  resetThrottle();
});

test("the owner's command result reaches the owner DM when the sender is a LID", async () => {
  resetThrottle();
  const h = harness({
    text: 'Xping',
    sender: STRANGER,
    key: { participant: '111222333444555@lid', participantAlt: '111222333444555@lid' }
  });
  h.sock.signalRepository.lidMapping.getPNForLID = async () => `${OWNER}@s.whatsapp.net`;

  await handleMessage(h.sock, h.msg, {
    runCommand: async ({ sock, msg }) => { await sock.sendMessage(msg.key.remoteJid, { text: 'pong' }); }
  });

  assert.equal(toOwner(h).length, 1, 'the LID owner gets the DM copy');
  resetThrottle();
});

test('a non-owner command result is never mirrored to the owner DM', async () => {
  resetThrottle();
  const h = harness({ text: 'Xping', sender: STRANGER });
  await handleMessage(h.sock, h.msg, {
    runCommand: async ({ sock, msg }) => { await sock.sendMessage(msg.key.remoteJid, { text: 'pong' }); }
  });

  assert.equal(toOrigin(h).length, 0, 'the chat stays silent');
  assert.equal(h.sent.length, 1, 'only the ignored notice is sent');
  assert.match(h.sent[0].content.text, /non-owner/i);
  resetThrottle();
});

test('the owner mirror does not duplicate a send that already targets the owner DM', async () => {
  resetThrottle();
  const h = harness({ text: 'Xping' });
  await handleMessage(h.sock, h.msg, {
    runCommand: async ({ sock }) => { await sock.sendMessage(OWNER_JID, { text: 'direct' }); }
  });

  assert.equal(toOwner(h).length, 1, 'the direct owner DM is not duplicated');
  resetThrottle();
});

test('the owner mirror never breaks the command when the DM copy fails', async () => {
  resetThrottle();
  const h = harness({ text: 'Xping' });
  const original = h.sock.sendMessage;
  h.sock.sendMessage = async (jid, content, options) => {
    if (jid === OWNER_JID) throw new Error('dm blocked');
    return original(jid, content, options);
  };

  await assert.doesNotReject(() => handleMessage(h.sock, h.msg, {
    runCommand: async ({ sock, msg }) => { await sock.sendMessage(msg.key.remoteJid, { text: 'pong' }); }
  }));

  assert.equal(toOrigin(h).length, 1, 'the chat reply still went out');
  resetThrottle();
});

// --- The error path itself can never throw ---------------------------------

test('handleMessage never throws, whatever the socket does', async () => {
  resetThrottle();
  const h = harness({ text: 'Xping' });
  h.sock.sendMessage = async () => { throw new Error('socket dead'); };
  h.sock.groupMetadata = async () => { throw new Error('socket dead'); };

  await assert.doesNotReject(() => handleMessage(h.sock, h.msg));
  await assert.doesNotReject(() => handleMessage(h.sock, null));
  await assert.doesNotReject(() => handleMessage(h.sock, { key: {}, message: null }));
  resetThrottle();
});

test('a failing owner DM notice never throws out of the guard', async () => {
  resetThrottle();
  const h = harness({ text: 'Xping', sender: STRANGER });
  h.sock.sendMessage = async () => { throw new Error('dm blocked'); };

  await assert.doesNotReject(() => handleCommand(h.sock, h.msg, 'Xping', { runCommand: async () => {} }));
  resetThrottle();
});
