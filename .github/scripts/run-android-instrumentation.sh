#!/usr/bin/env bash
set -euo pipefail

repo_root="${GITHUB_WORKSPACE:?GITHUB_WORKSPACE is required}"
runner_temp="${RUNNER_TEMP:?RUNNER_TEMP is required}"

cd "$repo_root/mobile"
node node_modules/react-native/cli.js start --host 0.0.0.0 > "$runner_temp/metro.log" 2>&1 &
metro_pid=$!
trap 'kill "$metro_pid" 2>/dev/null || true' EXIT

for attempt in $(seq 1 60); do
  if curl --fail --silent http://127.0.0.1:8081/status >/dev/null; then
    break
  fi
  sleep 1
done

if ! curl --fail --silent http://127.0.0.1:8081/status; then
  cat "$runner_temp/metro.log"
  exit 1
fi

adb reverse tcp:8081 tcp:8081
cd "$repo_root/android"
bash gradlew :app:connectedDebugAndroidTest -PreactNativeArchitectures=x86_64 --no-daemon --console=plain --max-workers=2 --stacktrace