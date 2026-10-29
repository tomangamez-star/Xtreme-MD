# Preview validation

Performed for this source delivery:

- Clean Android build: `clean testDebugUnitTest lintDebug assembleDebug assembleDebugAndroidTest` — passed.
- Android unit tests: 4 passed (pack partitions, label limits, HTTPS origins, bounded reads).
- Android lint: 0 errors; 3 warnings remain (2 English-text/localization warnings and 1 legacy backup-configuration warning).
- Native encoder compiled for arm64-v8a, armeabi-v7a and x86_64, with 16 KB page-size alignment.
- APK signature checked with Android `apksigner` — verifies.
- Existing and new Node tests: 24 passed, including static/TGS/WebM bot conversion regression tests and 6 new sticker-API tests.
- `git diff --check` — passed.

Android instrumentation tests are included and their APK compiles. They cover static transparent conversion, saved-pack/provider access, protection of metadata files, and animated TGS conversion. **They were not executed successfully here:** the software-only emulator did not finish booting during the check, which was stopped. There is no completed visual or runtime-device validation.

The existing Node animation regression tests exercise the server's old converter, not the new Android encoder. A successful native compilation is not a substitute for running the included Android tests.

Not yet verified: live Telegram imports through your deployed server, Android gallery import on a physical phone, hardware-specific WebM decoding, WhatsApp / Business acceptance, or signed-release update behaviour. Treat the APK as a preview until these checks pass on your device.

No GitHub changes were pushed and no Render deployment was performed.
