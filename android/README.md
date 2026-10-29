# Xtreme Stickers — Android

Version 1.1 uses the native fast engine. See `UPGRADE-1.1.md` for the
new signing key, installation steps, speed/quality tradeoff and validation.

A standalone native Android app in the Xtreme MD repository. It does not pair with WhatsApp, use the bot session, or send individual stickers into chats. Android 9+ is required.

## Included

- Dark cyan / violet studio, connection badge, local pack vault and animated previews.
- Import public `https://t.me/addstickers/NAME` links through the existing server.
- Local TGS (native ThorVG with Android Lottie parse fallback), GIF and video conversion to animated WebP using libwebp JNI. The device must support decoding the source video codec; some phones cannot decode transparent VP9 correctly. Conversion failures are shown, not silently replaced with static stickers.
- Photo-to-static-sticker conversion. Photos are fitted on transparent padding; no crop editor, background removal or text overlay yet. Animated WebP files selected from the gallery currently import as static images; use GIF or video for local animated creation.
- Review/select stickers, set pack name/author, separate animated/static packs, partition into 3–30 stickers each, preview saved packs, edit labels, choose a tray icon from a sticker, and delete local packs.
- Official WhatsApp / WhatsApp Business pack-add intent with user confirmation.
- HTTPS server setting, real Telegram health check, 60-second foreground status refresh, limited/disconnected explanations and manual retry.

## Apply to the existing repo

Copy `android/`, `.github/workflows/android.yml`, `src/sticker-api.js`, and `test/sticker-api.test.js` into the repo. Add this line after the JSON middleware in `index.js` (included in the patch):

```js
app.use('/api/stickers', require('./src/sticker-api').createStickerApi());
```

Do not replace your `.env`, bot session or database configuration. No new Node packages are needed. Redeploy the existing server with `TELEGRAM_BOT_TOKEN` set. Its `/api/stickers/health` route should return `api: 1`. App functionality does not require a paired bot, though a process-wide failure elsewhere in the existing server can still interrupt the API.

In the app, open **Settings**, paste the server origin such as `https://your-app.onrender.com`, and choose **Save & check connection**. Never put a Telegram token in the app. An idle Render service may take time to wake; retry the check if it times out.

## Build an APK with GitHub Actions

1. Push these files to your repository.
2. Open **Actions → Build Xtreme Stickers APK → Run workflow**.
3. Download `Xtreme-Stickers-preview-APK` from the successful run's Artifacts section, unzip, and install the APK on Android.

Preview APKs use a debug key. Different CI runs may use different debug keys, so they are **not a safe update channel for saved packs**. Android may demand uninstalling the old preview before installing another; uninstalling deletes local packs. For continuing use, configure a permanent release key before distributing the app.

### Stable release signing

Generate a keystore once on your own machine, back it up securely, and add these GitHub repository Actions secrets:

- `XTREME_KEYSTORE_BASE64`: base64-encoded keystore
- `XTREME_STORE_PASSWORD`
- `XTREME_KEY_ALIAS`
- `XTREME_KEY_PASSWORD`

Never commit the keystore or passwords. CI then also uploads a signed release APK. Reuse the same key forever and increment `versionCode` in `app/build.gradle` for each release. An existing debug installation cannot be upgraded to a release signed with a different key.

Local build: JDK 17, Gradle 8.11.1, Android SDK 35, NDK 27.0.12077973 and CMake 3.22.1; run `gradle testDebugUnitTest lintDebug assembleDebug` from `android/` with `ANDROID_HOME` configured. CMake fetches libwebp v1.5.0 from its official repository. No Gradle wrapper binary is included; CI provisions the pinned Gradle version.

## Behaviour and limits

- Sticker assets: 512×512, static ≤100 KiB, animated ≤500 KiB and first 10 seconds. Native encoding retries lower quality/frame rates to meet the limit. Tray icon: 96×96 PNG ≤50 KiB.
- At least three selected stickers per type are needed. Splitting balances pack sizes (31 becomes 16 + 15, never 30 + 1).
- Imports are foreground tasks. Keep the app open. Cancel preserves completed draft stickers; killing the process loses the unsaved draft. Saved packs remain available offline. Download tickets expire in 30 minutes, so a very large/slow import may require starting again.
- File fetches are bounded to 5 MB; selected local media to 30 MB; packs to 200 stickers. Imports download/convert sequentially rather than allocating a whole pack of frames.
- Original photos/GIFs/videos never upload to the server. Only pack names and download tickets are sent. Android app-private files contain saved packs; backups are disabled. Clearing app data or uninstalling removes those packs.
- The public API has request limits, a concurrent-operation cap, bounded ticket storage and expiring opaque tickets. It is intended for a small personal deployment, not an authenticated multi-tenant public service. Configure infrastructure-level limits before public distribution. The server does not trust arbitrary forwarded IP headers; a reverse proxy may cause users to share a rate-limit bucket.
- Label/tray changes may require removing and re-adding a pack in WhatsApp. Do not uninstall this app if you want it to keep supplying packs.

## Validation before distribution

Run Node tests, Android lint/unit tests and a device smoke test: static Telegram pack; TGS pack; WebM pack; local photos/GIF/video; mixed-type split; cancel; offline restart; unreachable server; missing Telegram token; WhatsApp and Business confirmation; install an update with the same signing key. The build alone does not validate WhatsApp acceptance on a real account.

## Dependencies

Lottie Android is Apache-2.0; libwebp is BSD-licensed; ThorVG and RapidJSON use MIT licenses. Their licenses are included with this source distribution under `app/src/main/assets/licenses/`. WhatsApp's public sticker-provider protocol is implemented independently. Xtreme Stickers is not affiliated with WhatsApp or Telegram.
