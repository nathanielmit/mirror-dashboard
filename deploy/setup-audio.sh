#!/usr/bin/env bash
# Bring up audio on the mirror and pin the USB mic as the default input.
#
# Why this exists: the NUC shipped with no sound server at all — no PipeWire,
# no PulseAudio, just raw ALSA devices. Snap Chromium reaches audio only
# through the PulseAudio socket, so with no daemon it sees zero input devices
# and the Web Speech API reports "not-allowed" (which reads like a permission
# problem but isn't). Installing PipeWire gives Chromium a socket to talk to.
#
# There are three capture devices in this box:
#   card 0  USB PnP Sound Device (C-Media 08bb:2902)  <- the USB mic, we want this
#   card 1  USB Webcam gadget                          <- the camera's built-in mic
#   card 2  HDA Intel PCH                              <- onboard analog
#
# Run:  ./deploy/setup-audio.sh
set -euo pipefail

MIC_MATCH="USB_PnP_Sound_Device"   # matches the C-Media USB mic's node name
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

say() { printf '\n=== %s\n' "$1"; }

say "Installing PipeWire (needs sudo)"
sudo apt-get update -qq
sudo apt-get install -y pipewire pipewire-pulse pipewire-audio wireplumber

say "Starting the user sound services"
systemctl --user daemon-reload
systemctl --user enable --now pipewire.socket pipewire-pulse.socket wireplumber.service

# Survive reboots even when nobody is logged in on a TTY: the kiosk session is
# graphical-only, and without lingering the user manager may not start early.
sudo loginctl enable-linger "$USER" || true

# Wait for real ALSA inputs, NOT merely for the socket to answer. pactl info
# succeeds the instant pipewire-pulse is up, seconds before WirePlumber has
# finished walking the cards — polling the wrong condition reports "no mic"
# on a machine whose mic is perfectly fine.
for _ in $(seq 1 60); do
  pactl list sources short 2>/dev/null | grep -q "alsa_input" && break
  sleep 0.5
done

if ! pactl list sources short 2>/dev/null | grep -q "alsa_input"; then
  echo "ERROR: no ALSA inputs after 30s. Check: journalctl --user -u wireplumber -n 50" >&2
  exit 1
fi

say "Capture devices PipeWire can see"
pactl list sources short

# Pick the USB mic by name, not by index — card numbers shuffle between boots.
SRC="$(pactl list sources short | awk -v m="$MIC_MATCH" '$0 ~ m && $0 !~ /\.monitor/ {print $2; exit}')"
if [ -z "$SRC" ]; then
  echo "ERROR: no source matching '$MIC_MATCH'. Is the USB mic plugged in?" >&2
  echo "Pick one from the list above and run: pactl set-default-source <name>" >&2
  exit 1
fi

say "Setting default input to the USB mic"
pactl set-default-source "$SRC"
pactl set-source-mute "$SRC" 0
pactl set-source-volume "$SRC" 100%
echo "default source is now: $(pactl get-default-source)"

# wpctl records the choice in ~/.local/state/wireplumber/default-nodes, so it
# sticks across reboots without any extra config file.

say "Restarting the kiosk browser so it re-enumerates audio devices"
pkill -f "app=http://127.0.0.1:3000" || true
echo "The kiosk supervisor relaunches Chromium within ~15s."

say "Done"
echo "Say \"hey mirror, good evening\" at the glass."
echo "If the mirror still shows a mic error, check:  snap connections chromium | grep audio-record"
