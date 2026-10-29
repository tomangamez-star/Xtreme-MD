# Xtreme Stickers 1.2 validation

- Signed release build passed: clean testDebugUnitTest lintDebug assembleRelease assembleDebugAndroidTest.
- Version 1.2.0, versionCode 3, Android 9+.
- Android unit tests: 13 passed (journal restart/partial-write recovery, path boundaries, retained minority group, 49 static + 1 animated save planning, WebP validation and existing limits).
- Android lint: 0 errors, 3 warnings.
- Node API/video regression tests: 10 passed, including real synthetic WebM motion, rejection of static output, bounded workers, cache reuse, idempotency and invalid ticket handling.
- Exact real pack: OshinoKoVid, 50 original WebM videos. Local full HTTP job/packet integration test passed for 50/50 animated outputs; decoded pixels change in all 50. The exact Java WebP validator shipped in the APK accepted all 50 outputs.
- APK signature verifies against the same v1.1 certificate: 3f6f986733e27a1f9bdc87845525f4dd7a47779c59d6908f99994cb1f6bb03c2.
- git diff --check passed.

See REAL-PACK-VALIDATION.json for measurements and per-sticker frame counts. Local API timing uses already downloaded source videos and does not measure Telegram downloads, deployed Render performance or phone speed. An additional live cold-source test could not complete because the supplied server timed out; it is not reported as a successful deployed-server benchmark.

The instrumentation APK compiles, but no Android device/emulator UI or live WhatsApp installation was exercised here. The UI save flow uses the unit-tested save planner and journal; component tests do not replace an actual device acceptance check.

The production Render service has NOT been changed by these local tests. Upload the repository patch and redeploy before testing Telegram video import in v1.2. Install the APK over v1.1 to preserve data; do not uninstall.
