# Xtreme Stickers 1.1 validation

- Clean build passed: `clean testDebugUnitTest lintDebug assembleRelease assembleDebugAndroidTest`.
- Signed release: versionName 1.1.0, versionCode 2, Android 9+.
- Android unit tests: 4 passed, no failures.
- Android lint: 0 errors, 3 warnings (legacy backup configuration and English-only text/localization).
- Native C++ smoke/benchmark test: passed on this Linux x86-64 host. It exercises real ThorVG rendering, movement, transparent padding, straight-alpha RGBA channel order, malformed JSON, encoding, decoded frame count, 512×512 dimensions, duration and output size.
- Example host run with the same simple 1-second animation, 15 fps and quality 60: method 4 took 80 ms / 1958 bytes; method 0 took 41 ms / 2240 bytes. Timings vary between runs. This compares compression modes using the same native renderer, NOT the previous complete Android pipeline.
- Updated native engine compiled for arm64-v8a (NEON enabled), armeabi-v7a and x86_64.
- APK signature verifies and matches the permanent certificate fingerprint in `SIGNING-CERTIFICATE.sha256`.
- ARM64 native shared library LOAD segments use 16 KB alignment.
- Existing sticker API regression tests: 6 passed. No server code changes are included in this update.
- `git diff --check`: passed.

The Android instrumentation APK compiles, including the new conversion-cache round-trip assertion. Instrumentation tests were not executed on a device here. No phone or emulator visual verification was completed for this update.

Not yet measured: conversion time on your phone, a real 50-sticker Telegram pack, device-specific WebM decoding, thermal throttling, and WhatsApp/Business acceptance of the new encoder output. The native test fixture is simple and does not cover every Lottie feature. Check actual artwork and speed on your pack.

No GitHub push or Render deployment was performed. The old preview signing key is unavailable; this release uses a new key and therefore requires uninstalling the old preview. The private signing backup is supplied separately, not in the repository patch.
