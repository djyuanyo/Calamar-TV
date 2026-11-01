#!/usr/bin/env bash
set -eu
# AOSP first-use fullscreen teaching overlay owns focus until acknowledged.
adb shell settings put secure immersive_mode_confirmations confirmed
adb shell settings put system screen_off_timeout 2147483647
adb shell input keyevent KEYCODE_WAKEUP
adb shell wm dismiss-keyguard
if [ "${1:-mobile}" = tv ]; then
  gradle --no-daemon :app:connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=es.yuanyo.calamartv.MultiPlaybackTest || {
    mkdir -p app/build/reports/androidTests/connected
    adb exec-out run-as es.yuanyo.calamartv cat files/multi-focus.png > app/build/reports/androidTests/connected/multi-focus.png || true
    exit 1
  }
  gradle --no-daemon :app:connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=es.yuanyo.calamartv.HostingPlaybackTest,es.yuanyo.calamartv.TvCatalogTest,es.yuanyo.calamartv.AppLinksTest,es.yuanyo.calamartv.IptvHostedPlaybackTest,es.yuanyo.calamartv.HttpIptvDataSourceTest
else
  gradle --no-daemon :app:connectedDebugAndroidTest
fi
