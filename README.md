# Xtreme MD

A clean WhatsApp Multi-Device bot built with Baileys. Official commands begin with a capital `X`, for example `Xmenu` and `Xplay Funk La Peace`. The preserved view-once utility is the single exception: reply with `.vv`.

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
5. Deploy and copy the pairing code from the Render logs.
6. On WhatsApp, open **Linked devices → Link with phone number instead**, then enter the code.

The database tables are created automatically. Never commit `.env` or the `session` directory.

## Command style

Commands must visibly start with capital `X`. `xmenu` is ignored; `Xmenu` works. Command names after the first character are case-insensitive, so `XPLAY` also works.

## Upstream notice

This clean implementation was produced after reviewing the Apache-2.0 JAWAD-MD project for feature inspiration. It does not include its obfuscated runtime or user-facing branding.
