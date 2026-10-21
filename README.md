# Xtreme MD

A clean WhatsApp Multi-Device bot built with Baileys. Commands accept `X`, `/` or `.` prefixes, for example `Xmenu` and `Xplay Funk La Peace`. The preserved view-once utility is the single exception: reply with `.vv`.

## Included

- Render-ready Docker deployment
- Pairing code login through `BOT_NUMBER`
- Supabase/Postgres persistence for WhatsApp auth, group settings and music quotas
- Curated group moderation and utilities
- Welcome/goodbye messages
- Anti-link modes
- Music downloading with duration, file-size and daily limits
- Sticker creation
- `.vv` view-once recovery

Video, TikTok, Instagram, APK and GitHub ZIP downloaders are intentionally excluded.

## Render setup

1. Create a new repository and upload these files.
2. Create a Render Blueprint/Web Service using `render.yaml`.
3. Add the values shown in `.env.example` to Render.
4. Use your Supabase pooler connection string as `DATABASE_URL`.
5. Deploy, then open `https://YOUR-RENDER-URL.onrender.com/pair`.
6. Tap **Generate pairing code**.
7. On WhatsApp, open **Linked devices → Link with phone number instead**, then enter the code.

The database tables are created automatically. Never commit `.env` or the `session` directory.

## Command style

Use `Xmenu`, `/menu`, or `.menu`. Lowercase `xmenu` remains ignored. Names after the prefix are case-insensitive. Use `Xmenu stickers`, `Xmenu group`, `Xmenu tools`, `Xmenu music`, `Xmenu fun`, `Xmenu system`, or `Xmenu all`.

## Upstream notice

This clean implementation was produced after reviewing the Apache-2.0 JAWAD-MD project for feature inspiration. It does not include its obfuscated runtime or user-facing branding.

## Telegram sticker importer

Add `TELEGRAM_BOT_TOKEN` to Render using a bot token created with Telegram's
@BotFather. It only fetches public sticker packs; you do not need to log into
Telegram or connect the bot to a Telegram chat. Keep the token secret.
Redeploy with the updated Dockerfile so Python, Cairo and the TGS renderer install.
For a non-Docker install, install FFmpeg, Python 3, libcairo2 and
`pip install -r requirements-stickers.txt` in a virtual environment.

- `Xtgpack https://t.me/addstickers/PackName`
- `Xtgpack https://t.me/addstickers/PackName | MONTAI | Toman`
- `Xnext` sends the next five entries from your pack.
- `Xcancel` stops your import, including a batch currently converting.

Defaults use the existing `STICKER_PACK` and `STICKER_AUTHOR` settings.
Static WebP, animated TGS and video WebM stickers are converted to 512×512
WebP, with labels embedded. Animations are capped at ten seconds and compressed
to at most 500 KiB including labels; static stickers use at most 100 KiB.
Complex animations may render differently; files that cannot convert are
skipped and counted. Delivery is individual stickers you can favourite,
not an installable pack or native Add Pack button.

The first five entries are processed immediately; each subsequent batch requires
`Xnext`. Sends are spaced by 1.2 seconds. Queues belong to the requesting sender
in that chat, expire after 30 idle minutes, and reset on restart. One batch runs
at a time across the bot to keep memory use down on Render. At most 50 queues
are kept. A failed WhatsApp send leaves the unsent sticker ready for `Xnext`.

## Group status

Reply inside the target group with `Xgstatus` (alias `Xgroupstatus`) to submit
text, photos, videos/GIFs or audio as that group's native status. Add text to
replace a photo/video caption; use `Xgstatus <text>` for a direct text status.
The bot must be admin, and the requester must be a group admin or bot owner.
Phone-number and LID admin identities are both checked. Media downloads are
capped at 20 MiB. Unsupported messages are rejected.

This uses the installed Baileys `groupStatusMessageV2` protobuf and relay API,
following the group-story wrapper used by xhclintohn/Baileys. No fork is installed.
It does not post to the bot's personal status or mention unrelated groups.
The bot reports submission only: real visibility depends on WhatsApp's support
for the account/group and must be verified in the group after deployment.
A media/reply fetch may fail if WhatsApp no longer has the original file.

## Timed repeats

`Xspam 5 enjoy` (alias `Xrepeat`) sends the text five times over ten seconds,
with the first send immediately and the last approximately ten seconds later.
`Xspam 5 20s enjoy` sets the total duration. `Xstopspam` / `Xstoprepeat` cancels
remaining sends in that chat. A message already in flight may still arrive.
Only the configured bot owner/sudo numbers can start or stop repeats. Group
admins cannot use them. Repeats run in the
current chat only, with one job per chat and ten jobs globally. Limits: 1–20
messages, 1–120 seconds, at least one second between repeats, 1,000 text
characters. Text beginning with a bot command is rejected to prevent command loops. Network time can extend the total duration. Jobs reset on restart.
No new environment variables are needed for status, repeats, or menus.

## Persistent WhatsApp login

Set `DATABASE_URL` to the Supabase Postgres pooler connection string. Every
Baileys credential update is saved to `xtreme_auth` in a serialized transaction.
Rotated/deleted key files are removed from the database, preventing stale keys
from returning after a deploy. On a fresh Render instance the session is
restored before Baileys starts, so the number remains linked across deploys.

If Supabase is unavailable at startup, the bot can run from its local session,
but it logs a clear warning that a fresh deployment cannot restore that state.
Do not run two permanent Render services for the same WhatsApp number.

## Dynamic welcome card

`Xwelcome on` generates a 1200×675 XTRΞMΞ card for each new member. It includes
the member profile picture, group profile picture, number, group name and member
count. Private/missing profile pictures use branded fallback avatars. The image
uses the selected glitch/anime/luxury/cyber theme and is followed by a tagged
welcome caption. The Docker image installs DejaVu fonts for consistent rendering.

`Xmenu` uses the same visual theme and attempts an interactive module selector.
If WhatsApp rejects interactive buttons for the connected account/version, it
automatically falls back to the complete text menu.
