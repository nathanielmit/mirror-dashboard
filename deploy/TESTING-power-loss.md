# Simulating an unclean shutdown

Run these **after** `sudo bash deploy/apply-resilience.sh` and one clean reboot
(the kernel cmdline changes don't take effect until then).

**Before you start:** SSH in from another machine and keep that session open, and
have a USB installer available. These tests intentionally leave the filesystem
dirty. That is the point — but it means a real (small) chance of real damage.

`sysrq` is `176` on this box (`128` reboot + `32` remount-ro + `16` sync), so the
`b` trigger below is permitted without changing any sysctl.

---

## Test 1 — the recordfail path (do this one first; it's non-destructive)

This is the actual "power was cut" symptom: GRUB sees the previous boot never
reported success, and shows the menu. You can set that flag by hand instead of
cutting power, so it's a clean test of just the GRUB change.

```bash
sudo grub-editenv /boot/grub/grubenv set recordfail=1
sudo grub-editenv /boot/grub/grubenv list      # expect: recordfail=1
sudo reboot
```

**Watch the physical display.** Expected: GRUB menu appears, counts down ~3s,
boots Ubuntu unattended. Before this change it would have sat there for 30s.

After it comes back:
```bash
sudo grub-editenv /boot/grub/grubenv list      # expect: empty — cleared on success
```

## Test 2 — dirty filesystem via hard reset

`sysrq-b` reboots immediately: no sync, no unmount, no service shutdown. It is
the closest software equivalent to yanking the plug — the difference is only
that the disk itself loses power in the real case.

```bash
# from the physical console or SSH, as root:
echo b | sudo tee /proc/sysrq-trigger
```

The box drops instantly. When it returns, confirm the journal was replayed and
nothing stopped for a human:

```bash
# ext4 recovering its journal = the unclean state was detected and fixed
sudo journalctl -b -k | grep -iE 'recovery|recovering journal|orphan'

# fsck ran and exited cleanly
sudo systemctl status systemd-fsck-root.service
sudo journalctl -b -u systemd-fsck-root.service

# nothing fell into emergency/rescue
sudo journalctl -b -u emergency.service -u rescue.service
systemctl is-active emergency.target rescue.target   # expect inactive/inactive

# the previous boot was recorded as unclean
sudo journalctl --list-boots | tail -3
```

Then confirm the kiosk healed itself end to end:
```bash
systemctl is-active mirror-web            # active
pgrep -af 'chrome .*--kiosk' | head -1    # relaunched by kiosk.sh
curl -sf localhost:3000/api/health        # heartbeat flowing
```

## Test 3 — force a full fsck and prove it can't prompt

Tests 1–2 only replay the ext4 journal, which is the easy case. This forces a
full structural check, which is where preen mode would have bailed to a shell:

For one boot only, from the GRUB menu: press `e`, append
`fsck.mode=force` to the `linux` line, `Ctrl-X`. Or persistently for one cycle:

```bash
sudo touch /forcefsck && sudo reboot     # honoured by systemd-fsck; self-clears
```

Expect a visible check on the display, then a normal boot. Confirm:
```bash
sudo journalctl -b -u systemd-fsck-root.service   # should show a pass count, no prompt
```

## Test 4 — repeat it

One clean recovery proves the config parses. Power-loss resilience is a
probability question, so loop test 2 five or six times before trusting it —
corruption tends to show up on the write that happened to be in flight, not on
the first try.

```bash
for i in $(seq 5); do echo "--- cycle $i ---"; done   # do these by hand, one reboot each
```

After the last cycle:
```bash
sudo dumpe2fs -h /dev/mapper/ubuntu--vg-ubuntu--lv | grep -iE 'state|mount count'
# Filesystem state: clean   <- what you want
```

---

## Rolling back

`apply-resilience.sh` backs up to `/root/kiosk-backup-<timestamp>/`.

The one to know by heart — if the emergency auto-reboot override ever puts the
box in a reboot loop, interrupt at GRUB, press `e`, append
`systemd.unit=multi-user.target`, `Ctrl-X`, then:

```bash
sudo rm /etc/systemd/system/{emergency,rescue}.service.d/override.conf
sudo systemctl daemon-reload
```
