#!/usr/bin/env bash
# Nightly screen dimming. This panel has no hardware backlight control
# (/sys/class/backlight is empty), so we dim via xrandr's software brightness
# (gamma). Runs inside the X session from the Openbox autostart.
#
# Tune these four values to taste:
DAY_START=7        # hour (24h) full brightness begins
NIGHT_START=22     # hour (24h) dimming begins
DAY_LEVEL="1.0"    # 1.0 = full
NIGHT_LEVEL="0.35" # 0.0-1.0; lower = dimmer
set -u

OUT="$(xrandr | awk '/ connected/{print $1; exit}')"
[ -n "$OUT" ] || { echo "screen-schedule: no connected output"; exit 0; }

last=""
while true; do
  H=$(date +%-H)
  if [ "$H" -ge "$DAY_START" ] && [ "$H" -lt "$NIGHT_START" ]; then
    want="$DAY_LEVEL"
  else
    want="$NIGHT_LEVEL"
  fi
  if [ "$want" != "$last" ]; then
    xrandr --output "$OUT" --brightness "$want" || true
    echo "screen-schedule: brightness -> $want (hour $H)"
    last="$want"
  fi
  sleep 60
done
