# Start here

1. Install the supplied **Xtreme-Stickers-preview.apk** on an Android 9+ phone.
2. Extract the **repo patch ZIP** into your Xtreme-MD repository root. It adds an `android` folder, a GitHub Actions workflow, a sticker API and tests. The only change to existing bot code is one new route in `index.js`. It does not include or replace `.env` or sessions.
3. Commit/upload the patch and redeploy your existing Render service. Keep `TELEGRAM_BOT_TOKEN` in the server environment, never in the Android app.
4. Open the app → **Settings** → enter `https://YOUR-SERVICE.onrender.com` → **Save & check connection**.
5. Use **Import a Telegram pack**, paste a public `t.me/addstickers/...` link, review the stickers, set name/author, then save. In **Packs**, choose **Add whole pack to WhatsApp** and approve WhatsApp's confirmation.

You can create packs from local photos, GIFs and videos without configuring a server. Select at least three stickers of each included type. Larger collections are split automatically into valid packs; each pack has its own Add button.

## Important

This is a **preview APK**, not a production-signed release. Set up the permanent release signing secrets described in `README.md` before relying on future app updates. Different preview signing keys can require uninstalling the old app, which deletes local packs.

No repository push or server deployment is performed by downloading this patch. Your Render address is intentionally not hardcoded.

Live Telegram imports, device-specific video decoding, and WhatsApp acceptance should be tested on your phone before distributing the app to others.
