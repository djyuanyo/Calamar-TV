#!/usr/bin/env bash
set -eu
adb shell settings put system screen_off_timeout 2147483647
adb shell input keyevent KEYCODE_WAKEUP
adb shell wm dismiss-keyguard
gradle --no-daemon :app:connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=es.yuanyo.calamartv.MultiPlaybackTest || {
  mkdir -p app/build/reports/androidTests/connected
  adb exec-out run-as es.yuanyo.calamartv cat files/multi-focus.png > app/build/reports/androidTests/connected/multi-focus.png || true
  exit 1
}
gradle --no-daemon :app:connectedDebugAndroidTest
