# Xtreme Stickers 1.1 — native fast engine

## Install

This APK has a **new permanent release signing key**. It cannot install over the old preview. Uninstalling the old preview deletes its local packs and settings. Keep any Telegram pack links you want to re-import. Remove unwanted packs from WhatsApp before uninstalling their provider app.

Install the supplied 1.1 APK, enter the same Render origin in Settings, then import a pack. If your server already works with 1.0, **no Render redeploy or new environment variable is needed for this speed update**.

Upload the source patch into your existing repository root to keep your app code current. It contains only changed/new source files, not the private signing backup. No bot session or database code changes are included.

## Engine changes

- TGS vector animation is now rendered by a native C++ ThorVG software/Lottie engine (v0.15.16). Frames go directly from a straight-alpha RGBA native buffer into libwebp, avoiding the Java Canvas / Android Bitmap round trip. The previous Android Lottie renderer remains a parse-compatibility fallback.
- Native WebP encoding uses method 0, encoder threading, and reused scratch buffers. The previous mode was method 4. Compression can produce larger files, so the existing size checks still apply.
- Speed-first presets: 15 fps / quality 60, then 10 / 40, then 8 / 25 only when needed to meet 500 KiB. The older first preset was 20 fps / quality 75. This is an explicit smoothness/quality tradeoff for faster processing; dimensions remain 512×512 and duration remains capped at 10 seconds.
- SHA-256 conversion cache, keyed by the source content, format and engine version. Repeat imports still fetch source files but reuse valid converted bytes instead of encoding again. The cache is capped at 64 MiB and may be evicted by Android.
- One-file download look-ahead overlaps the next download with the current conversion. It does not download a whole pack into RAM or launch dozens of competing encoders. ThorVG uses two renderer worker threads; sticker conversion remains memory-bounded and sequential.
- GIF/video inputs benefit from faster WebP encoding and caching. WebM/video decoding still uses Android's decoder path; this update does not replace it with a new sequential video decoder.
- Conversion timing is logged under `XtremeConvert` with format, elapsed milliseconds and output size; no source files or Telegram credentials are logged.

Samsung's original rlottie was considered but is now marked unsupported upstream. This update uses ThorVG rather than shipping that renderer.

## Signing — keep this private

The separate **Xtreme-Stickers-PRIVATE-Signing-Backup.zip** contains the new encrypted JKS and its credentials. Keep a private offline copy. **Never upload that ZIP, JKS or signing.json to the public repository.** It allows future APKs to install over 1.1 without uninstalling or clearing packs.

For GitHub Actions, base64-encode its JKS into the existing `XTREME_KEYSTORE_BASE64` secret, and use the JSON values for `XTREME_STORE_PASSWORD`, `XTREME_KEY_PASSWORD` and `XTREME_KEY_ALIAS`. Download the signed **release** artifact, not the temporary debug preview, for compatible updates. Future versions must increment `versionCode`.

## Validation

The native test target checks real rendering, changing frames, transparency, RGBA order, malformed JSON handling, WebP decoding, 512×512 output and duration/size limits. It also compares method 4 and method 0 with the same renderer, frame rate and quality on a small synthetic animation. Those host timings are **not** end-to-end phone timings or a guaranteed speedup for a 50-sticker pack.

Run the included Android instrumentation tests on a device to exercise the JNI/cache path. Rendering compatibility and real conversion speed on your particular pack still need phone testing.

Third-party licenses are included for ThorVG, RapidJSON, Lottie and libwebp.
