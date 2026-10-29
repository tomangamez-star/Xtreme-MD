# Xtreme Stickers 1.2 — WebM animation and draft recovery fix

## Do this in order

1. Upload the contents of the v1.2 repo patch ZIP into the **Xtreme-MD repository root**, preserving the `android`, `src`, `scripts`, `test` and `.github` folders and updated `index.js`.
2. Redeploy the existing **Docker-based Render service**. Its existing Dockerfile already installs FFmpeg/ffprobe. No new token or environment variable is needed. Keep `TELEGRAM_BOT_TOKEN` on the server only.
3. Check `https://YOUR-SERVER/api/stickers/health`. Its capabilities must contain `video-batch-v1`. The app shows Limited if the updated video engine is missing.
4. Install the v1.2 APK **over v1.1. Do not uninstall, clear data or clear cache.** The release certificate is the same as v1.1 and versionCode increases to 3.
5. Import `https://t.me/addstickers/OshinoKoVid` again through the updated app. Previously flattened files cannot magically regain motion; this re-import uses the original videos and the new batch engine.

The supplied signed APK reuses the private v1.1 signing backup. Keep that backup private. Do not substitute a GitHub Actions debug-preview APK; future Actions updates must use the matching signed release artifact.

The patch includes the complete small Android source project (including v1.1's native renderer dependencies) plus the video API changes, so future builds do not depend on having uploaded the earlier Android source patch. Unrelated bot commands, database and session files are not included.

## Why the previous patch missed this failure

The supplied pack contains **50 WebM videos**, not TGS vector animations. The prior TGS engine change was irrelevant to its video-decoding failure. The old app could accept single-frame output and label it static. With only one animated result, its all-or-nothing minimum-count check then blocked saving every selected sticker.

## What changed

- Telegram WebM conversion now runs in a bounded **server-side FFmpeg batch job**, not repeated Android MediaMetadataRetriever frame extraction. Two workers decode the original videos. Decoder, filter and encoder thread counts are capped to avoid exhausting a small server.
- Speed-first video presets start at **10 fps / WebP quality 45**, then 8/30 or 6/20 only if required to fit 500 KiB. This trades some smoothness/quality for speed. Canvas stays 512×512; duration is capped at 10 seconds.
- Converted videos must contain multiple decoded animation frames, valid dimensions/duration and a valid size. The APK independently checks animation chunks/frame counts. An animated failure is reported, **never silently saved as a static substitute**.
- Progress is polled while conversion runs. The phone downloads all successful animations in one bounded binary packet rather than 50 separate converted-file requests. The packet is streamed to disk and validated one record at a time.
- Server outputs use a 32 MiB LRU cache. Repeat successful pack submissions reuse a completed job; failed jobs can be retried while successful individual results remain cached.
- Mixed selections split automatically: 49 static + 1 animated saves the 49 static stickers as valid packs and **retains the animated sticker in a draft**. A one- or two-sticker group no longer blocks another eligible group. No repeated minimum-count modal loop.
- Drafts, labels, selection and pending server-job metadata are checkpointed in app-private durable files using a synced temp file + atomic rename. They survive ordinary app/process restarts. Cancelling does not clear completed work. There is a Resume server job button and an Add more media action.
- The app attempts to recover old `draft-*` cache files left by v1.1. Recovery depends on those files still existing. Old flattened results remain still; the source pack must be re-imported to repair animation. Android may already have evicted some old cache files.

## Server limits and lifecycle

One active batch job; two conversion workers; at most two retained jobs; each output packet ≤32 MiB; video source ≤5 MiB / 1024 pixels per dimension; jobs expire after 30 minutes. Source downloads retry transient failures. The existing API rate limit remains in place. There are no new npm dependencies.

Jobs/cache are in server RAM and **do not survive a Render restart/redeploy**. Phone draft files do survive an in-place APK update and app restarts, but uninstalling or clearing app data removes them. A pending server job can resume only while that server job still exists. Redeploy before starting an import, not during one.

Native TGS and local GIF/photo creation remain on the phone. Gallery video creation still depends on Android's codec path; this patch specifically replaces the Telegram WebM import path and rejects invalid animated output instead of flattening it.

## Real-pack evidence, without a speed guarantee

The exact 50 original WebM files from `OshinoKoVid` were retrieved through the supplied server. The revised local batch API produced **50/50 animated outputs**; decoded pixels showed changing frames for all 50, and the APK's Java animation validator accepted all 50. See `REAL-PACK-VALIDATION.json`.

The local HTTP batch test used already-downloaded original source files in place of Telegram HTTP responses. Its timing includes conversion, local packet download and validation, **not Telegram source download time or your Render hardware/network**. It is not a promise that the deployed free Render service will finish in the same time.

Phone UI and live WhatsApp acceptance still need device testing. The release build, lint, 13 Android unit tests (including draft journaling and the 49+1 case) and 10 Node/video tests pass. No GitHub push or Render deployment was performed automatically.
