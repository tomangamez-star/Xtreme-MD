#!/usr/bin/env bash
# Optional local smoke runner. Uses one emulator and cleans up only that process.
set -euo pipefail
: "${ANDROID_HOME:?Set ANDROID_HOME}"
: "${GRADLE_BIN:=gradle}"
: "${XTREME_AVD:=xtreme-test}"
cd "$(dirname "$0")/.."
mkdir -p app/build/smoke
"$ANDROID_HOME/platform-tools/adb" start-server
"$ANDROID_HOME/emulator/emulator" -avd "$XTREME_AVD" -no-window -no-audio -no-snapshot -no-boot-anim -accel off -gpu swiftshader_indirect -memory 2048 >app/build/smoke/emulator.log 2>&1 &
emulator_pid=$!
trap 'kill "$emulator_pid" 2>/dev/null || true' EXIT
booted=false
for attempt in $(seq 1 60); do
  if [ "$("$ANDROID_HOME/platform-tools/adb" -e shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ]; then
    booted=true
    break
  fi
  if ! kill -0 "$emulator_pid" 2>/dev/null; then
    echo 'Emulator exited; inspect app/build/smoke/emulator.log'
    exit 1
  fi
  sleep 10
done
if [ "$booted" != true ]; then
  echo 'Emulator did not boot within ten minutes.'
  exit 1
fi
"$GRADLE_BIN" --no-daemon connectedDebugAndroidTest
mkdir -p app/build/smoke
"$ANDROID_HOME/platform-tools/adb" -e shell am start -n com.xtreme.stickers/.MainActivity
sleep 10
"$ANDROID_HOME/platform-tools/adb" -e exec-out screencap -p >app/build/smoke/studio.png
"$ANDROID_HOME/platform-tools/adb" -e logcat -d -s AndroidRuntime:E >app/build/smoke/runtime-errors.txt
