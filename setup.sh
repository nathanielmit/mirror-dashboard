#!/usr/bin/env bash
# Mirror dashboard setup for Ubuntu Server 24.04 (run on the NUC over SSH).
# Usage:  cd ~/mirror-dashboard && chmod +x setup.sh && ./setup.sh
set -e

USER_NAME="$(whoami)"
APP_DIR="$(pwd)"
ROTATE="left"   # panel is portrait. try "left"; if upside down use "right".

echo "==> 1/6  Installing packages (X, Openbox, Chromium, Node)…"
sudo apt update
sudo apt install --no-install-recommends -y \
  xserver-xorg x11-xserver-utils xinit openbox unclutter

# Node 20 LTS
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt install -y nodejs
fi

# Chromium (snap on 24.04). chromium-browser shim usually works; fall back to snap.
sudo apt install -y chromium-browser || sudo snap install chromium
CHROME_BIN="$(command -v chromium-browser || command -v chromium || echo /snap/bin/chromium)"
echo "    using browser: $CHROME_BIN"

echo "==> 2/7  Installing app dependencies + production build…"
cd "$APP_DIR"
npm install
npm run build
chmod +x scripts/kiosk.sh scripts/screen-schedule.sh

echo "==> 3/7  Creating Next.js systemd service (production)…"
sudo tee /etc/systemd/system/mirror-web.service >/dev/null << EOF
[Unit]
Description=Mirror Next.js dashboard
After=network.target
[Service]
Type=simple
User=$USER_NAME
WorkingDirectory=$APP_DIR
ExecStart=$(command -v npm) run start
Restart=always
RestartSec=3
Environment=NODE_ENV=production
[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now mirror-web.service

echo "==> 4/7  Capping journald disk usage…"
sudo mkdir -p /etc/systemd/journald.conf.d
sudo cp "$APP_DIR/deploy/journald-mirror.conf" /etc/systemd/journald.conf.d/mirror.conf
sudo systemctl restart systemd-journald

echo "==> 5/7  Configuring Openbox autostart (self-healing kiosk + dim schedule)…"
mkdir -p ~/.config/openbox
cat > ~/.config/openbox/autostart << EOF
# Portrait rotation, disable blanking/DPMS, hide the cursor.
OUT=\$(xrandr | awk '/ connected/{print \$1; exit}')
xrandr --output \$OUT --rotate $ROTATE || true
xset s off; xset -dpms; xset s noblank
unclutter -idle 0.5 -root &

# Nightly screen dimming (runs in this X session).
$APP_DIR/scripts/screen-schedule.sh &

# Self-healing kiosk supervisor: waits for the web server, launches Chromium,
# relaunches on crash / white-screen. Keep last (runs forever).
exec $APP_DIR/scripts/kiosk.sh
EOF

echo "==> 6/7  Auto-start X on login + auto-login on tty1…"
# start X automatically when this user logs in on tty1
if ! grep -q "startx" ~/.bash_profile 2>/dev/null; then
  echo '[ "$(tty)" = "/dev/tty1" ] && ! pgrep -x Xorg >/dev/null && startx -- -nocursor' >> ~/.bash_profile
fi
echo "exec openbox-session" > ~/.xinitrc
# auto-login user on tty1
sudo mkdir -p /etc/systemd/system/getty@tty1.service.d
sudo tee /etc/systemd/system/getty@tty1.service.d/override.conf >/dev/null << EOF
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin $USER_NAME --noclear %I \$TERM
EOF
sudo systemctl daemon-reload

echo "==> 7/7  Done."
echo "-------------------------------------------------"
echo "Web service:   sudo systemctl status mirror-web"
echo "View logs:     journalctl -u mirror-web -f"
echo "Reboot to launch the kiosk:   sudo reboot"
echo "If display is upside-down, set ROTATE=\"right\" at top of this script and re-run."
echo "-------------------------------------------------"
