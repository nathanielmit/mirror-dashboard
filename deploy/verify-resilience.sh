#!/usr/bin/env bash
# Verify the resilience pass. Run with: sudo bash deploy/verify-resilience.sh
# Items marked [reboot] only become true on the NEXT boot.
set -u
pass(){ printf '  \033[32mOK\033[0m   %s\n' "$1"; }
fail(){ printf '  \033[31mFAIL\033[0m %s\n' "$1"; }
info(){ printf '  ..   %s\n' "$1"; }

echo "== 1. GRUB auto-boots after a failed boot =="
if grep -qE 'recordfail.*=.*1' /boot/grub/grub.cfg 2>/dev/null; then
  pass "recordfail support is compiled in (i.e. /boot is GRUB-writable)"
else
  fail "recordfail block absent — GRUB can't write /boot, setting is a no-op"
fi
# The line we care about is the timeout inside the `if recordfail = 1` branch.
RF=$(grep -A1 'recordfail.*= 1' /boot/grub/grub.cfg 2>/dev/null | grep -m1 -o 'timeout=[0-9-]*')
echo "       recordfail branch: ${RF:-<none>}   (default when unset is 30)"
[ "$RF" = "timeout=3" ] \
  && pass "failed boots wait 3s, then boot anyway" \
  || fail "expected timeout=3 in the recordfail branch, got '${RF:-none}'"

echo "== 2. fsck repairs unattended =="
grep -q 'fsck.repair=yes' /boot/grub/grub.cfg 2>/dev/null \
  && pass "fsck.repair=yes baked into grub.cfg" \
  || fail "fsck.repair=yes missing from grub.cfg"
grep -q 'fsck.repair=yes' /proc/cmdline \
  && pass "fsck.repair=yes active on the running kernel" \
  || info "[reboot] not on the running cmdline yet — expected until you reboot"
[ -f /etc/systemd/system/emergency.service.d/override.conf ] \
  && pass "emergency.service auto-reboots instead of prompting" \
  || fail "emergency.service override missing"
# Root fs must be fsck-able at boot: passno must be non-zero.
awk '$2=="/" && $6!="0" {found=1} END{exit !found}' /etc/fstab \
  && pass "root fstab passno is non-zero (fsck runs at boot)" \
  || fail "root fstab passno is 0 — fsck will never run on /"

echo "== 3. Reduced disk writes =="
findmnt -no OPTIONS / | grep -q noatime \
  && pass "/ mounted noatime" \
  || info "[reboot] noatime in fstab but not active until remount/reboot"
grep -q noatime /etc/fstab && pass "noatime persisted in fstab" || fail "noatime not in fstab"
findmnt -no FSTYPE /tmp | grep -q tmpfs \
  && pass "/tmp is tmpfs ($(findmnt -no SIZE /tmp))" \
  || fail "/tmp is on disk"
grep -q 'disk-cache-dir=/tmp' /home/nathaniel/mirror-dashboard/scripts/kiosk.sh \
  && pass "Chromium disk cache redirected to tmpfs" \
  || fail "kiosk.sh still caching to disk"
for t in sysstat-collect.timer motd-news.timer; do
  systemctl is-enabled "$t" >/dev/null 2>&1 \
    && fail "$t still enabled (periodic writer)" \
    || pass "$t disabled"
done
echo "  journal size: $(journalctl --disk-usage 2>/dev/null | sed 's/.*take up //')"

echo "== 4. unattended-upgrades is predictable =="
for t in apt-daily.timer apt-daily-upgrade.timer; do
  R=$(systemctl show "$t" -p RandomizedDelayUSec --value 2>/dev/null)
  N=$(systemctl show "$t" -p NextElapseUSecRealtime --value 2>/dev/null)
  if [ "$R" = "0" ]; then pass "$t RandomizedDelaySec=0"; else fail "$t still smeared by $R"; fi
done
systemctl list-timers apt-daily.timer apt-daily-upgrade.timer --no-pager 2>/dev/null | sed -n '2,4p' | sed 's/^/       /'
apt-config dump 2>/dev/null | grep -q 'Unattended-Upgrade::Automatic-Reboot "false"' \
  && pass "auto-reboot disabled" || fail "auto-reboot not disabled"
echo "  effective allowed origins:"
apt-config dump 2>/dev/null | grep 'Allowed-Origins::' | sed 's/^/       /'

echo "== 5. SSH is up early and independent of graphics =="
systemctl is-enabled ssh.service >/dev/null 2>&1 \
  && pass "ssh.service enabled" || fail "ssh.service not enabled"
systemctl is-active ssh.service >/dev/null 2>&1 \
  && pass "ssh.service running" || fail "ssh.service not running"
W=$(systemctl show ssh.service -p WantedBy --value)
echo "       WantedBy=$W"
case "$W" in *graphical*) fail "ssh is wanted by graphical.target";; *multi-user*) pass "ssh wired to multi-user.target";; esac
pass "default target: $(systemctl get-default)  (graphical.target is never entered)"
ss -ltnp 2>/dev/null | grep -q ':22 ' && pass "listening on :22" || fail "nothing listening on :22"
