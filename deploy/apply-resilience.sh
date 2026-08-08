#!/usr/bin/env bash
# Apply the power-loss resilience pass. Run with:  sudo bash deploy/apply-resilience.sh
# Idempotent — safe to re-run. Backs up everything it touches to /root/kiosk-backup-<ts>/.
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "run with sudo"; exit 1; }
D="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BK="/root/kiosk-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BK"
echo "==> backups: $BK"

# ---------------------------------------------------------------------------
# 0. Pin the runlevel in a FILE before regenerating GRUB.
#
# READ THIS ONE. /proc/cmdline currently ends in ` 3` (boot to multi-user, no
# display manager — X comes from the tty1 autologin + startx). But that `3` is
# in NO /etc/default/grub* file, which means it was hand-edited straight into
# the GENERATED /boot/grub/grub.cfg. Any `update-grub` erases it — including the
# one every kernel update runs automatically. So this was already one apt
# upgrade away from changing underneath you.
#
# set-default records the same intent in /etc/systemd/system/default.target,
# which nothing regenerates. After this, the `3` is redundant and update-grub
# is safe.
# ---------------------------------------------------------------------------
cp -a /etc/systemd/system/default.target "$BK/" 2>/dev/null || true
systemctl set-default multi-user.target
echo "==> default target: $(systemctl get-default)"

# ---------------------------------------------------------------------------
# 1. GRUB: recordfail timeout + fsck.repair
# ---------------------------------------------------------------------------
cp -a /etc/default/grub "$BK/"
cp -a /boot/grub/grub.cfg "$BK/grub.cfg.generated"
install -m 0644 "$D/grub-99-kiosk-resilience.cfg" \
  /etc/default/grub.d/99-kiosk-resilience.cfg
update-grub

# ---------------------------------------------------------------------------
# 2. fsck: never stop at a prompt (backstop for anything fsck.repair can't fix)
# ---------------------------------------------------------------------------
for svc in emergency rescue; do
  mkdir -p "/etc/systemd/system/${svc}.service.d"
  cp -a "/etc/systemd/system/${svc}.service.d" "$BK/" 2>/dev/null || true
  install -m 0644 "$D/emergency-autoreboot.conf" \
    "/etc/systemd/system/${svc}.service.d/override.conf"
done

# ---------------------------------------------------------------------------
# 3. Reduce disk writes
# ---------------------------------------------------------------------------
install -m 0644 "$D/journald-mirror.conf" /etc/systemd/journald.conf.d/mirror.conf

# noatime: stop every file READ from generating a metadata WRITE. relatime (the
# current setting) still writes an atime update once per day per file touched.
cp -a /etc/fstab "$BK/"
if grep -q 'ext4 *defaults[^,]*0' /etc/fstab && ! grep -q noatime /etc/fstab; then
  sed -i 's|\(ext4[[:space:]]\+\)defaults|\1defaults,noatime|' /etc/fstab
  echo "==> fstab: added noatime"
else
  echo "==> fstab: noatime already present or pattern not matched — check manually"
fi
grep -vE '^\s*#|^\s*$' /etc/fstab

# sysstat samples system activity to disk EVERY 10 MINUTES, forever. Nothing on
# this kiosk reads sar output. That is ~52k writes/year for nobody.
systemctl disable --now sysstat-collect.timer sysstat-summary.timer sysstat-rotate.timer 2>/dev/null || true
systemctl disable --now sysstat.service 2>/dev/null || true

# motd-news phones home and rewrites the MOTD; apport writes crash blobs. On a
# kiosk with no interactive login, both are pure write amplification.
systemctl disable --now motd-news.timer 2>/dev/null || true
systemctl disable --now apport-autoreport.timer 2>/dev/null || true

# ---------------------------------------------------------------------------
# 4. Tame unattended-upgrades
# ---------------------------------------------------------------------------
cp -a /etc/apt/apt.conf.d/20auto-upgrades "$BK/" 2>/dev/null || true
install -m 0644 "$D/52unattended-upgrades-kiosk" /etc/apt/apt.conf.d/52unattended-upgrades-kiosk
for t in apt-daily apt-daily-upgrade; do
  mkdir -p "/etc/systemd/system/${t}.timer.d"
  install -m 0644 "$D/apt-daily-timer-kiosk.conf" "/etc/systemd/system/${t}.timer.d/kiosk.conf"
done

# ---------------------------------------------------------------------------
# 5. SSH: eager start at multi-user, not socket-activated
#
# ssh.socket (current) does work and is NOT blocked by graphical.target — this
# box never enters graphical.target at all. But socket activation means sshd
# never parses its config until the first connection, so a broken sshd_config
# stays invisible until the moment you actually need to get in. ssh.service
# starts it at boot, where a failure is visible in the journal instead.
# ---------------------------------------------------------------------------
systemctl disable --now ssh.socket 2>/dev/null || true
systemctl enable --now ssh.service

systemctl daemon-reload
systemctl restart systemd-journald

echo
echo "==> DONE. Verify with: bash deploy/verify-resilience.sh"
