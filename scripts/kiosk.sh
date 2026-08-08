#!/usr/bin/env bash
# Self-healing kiosk supervisor.
# Launches Chromium and relaunches it if it crashes, if the web server recovers
# from an outage, or if the page stops sending heartbeats (white-screen / hung
# renderer). Launched from the Openbox autostart; runs in the X session.
set -u

URL="http://localhost:3000"
HB_MAX_AGE=60000   # ms: relaunch if the page heartbeat is older than this
CHROME="$(command -v chromium-browser || command -v chromium || echo /snap/bin/chromium)"
CHROME_PID=0

# Keep Chromium's churn off the SSD. /tmp is already tmpfs, so the disk cache
# and crash dumps live in RAM and simply vanish on a power cut instead of being
# a half-written file on disk. This is the largest single source of continuous
# writes on a display that renders the same page 24/7 (favicons, fonts, the
# anime sprites, every API poll). Nothing here is worth persisting across boots.
CACHE_DIR="/tmp/chromium-kiosk-cache"
mkdir -p "$CACHE_DIR"

launch() {
  # match the known-good kiosk flags
  "$CHROME" \
    --kiosk --incognito --noerrdialogs --disable-infobars --no-first-run \
    --disable-session-crashed-bubble --check-for-update-interval=31536000 \
    --autoplay-policy=no-user-gesture-required \
    --use-fake-ui-for-media-stream \
    --unsafely-treat-insecure-origin-as-secure="$URL" \
    --disk-cache-dir="$CACHE_DIR" --disk-cache-size=134217728 \
    --disable-breakpad --disable-crash-reporter \
    --app="$URL" &
  CHROME_PID=$!
  echo "kiosk: launched chromium pid=$CHROME_PID"
}

kill_chrome() {
  [ "$CHROME_PID" -gt 0 ] || return 0
  kill "$CHROME_PID" 2>/dev/null
  sleep 2
  kill -9 "$CHROME_PID" 2>/dev/null
}

# wait for the web server to answer before the first launch
until curl -sf --max-time 5 "$URL" >/dev/null; do sleep 1; done
launch
sleep 25   # allow first paint + first heartbeat

prev_up=1
while true; do
  sleep 15

  # 1) process died (crash)?
  if ! kill -0 "$CHROME_PID" 2>/dev/null; then
    echo "kiosk: chromium gone — relaunching"
    launch; sleep 25; prev_up=1; continue
  fi

  # 2) is the web server reachable right now?
  if curl -sf --max-time 5 "$URL/api/health" >/dev/null; then
    up=1
    AGE=$(curl -sf --max-time 5 "$URL/api/health" | sed -n 's/.*"ageMs":\([0-9]\{1,\}\).*/\1/p')
    # 3) heartbeat stale -> white screen / hung renderer
    if [ -n "$AGE" ] && [ "$AGE" -gt "$HB_MAX_AGE" ]; then
      echo "kiosk: heartbeat stale (${AGE}ms) — relaunching"
      kill_chrome; launch; sleep 25; prev_up=1; continue
    fi
  else
    up=0
  fi

  # 4) server just recovered from an outage -> clear any chrome error page
  if [ "$prev_up" -eq 0 ] && [ "$up" -eq 1 ]; then
    echo "kiosk: web server recovered — relaunching"
    kill_chrome; launch; sleep 25
  fi
  prev_up=$up
done
