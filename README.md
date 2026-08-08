# Mirror Dashboard

A Next.js dashboard that runs full-screen behind a two-way mirror: clock,
weather, calendar, news, Spotify, a pixel face that tracks you, and voice
control. One machine, no cloud, no keyboard.

## The machine
- **Intel NUC10i7FNH** (i7-10710U), board mounted behind the glass.
- **Ubuntu 26.04 LTS**, server install — no desktop, no display manager.
  `systemctl get-default` is `multi-user.target`.
- **It powers on by itself.** BIOS → Power → Secondary Power Settings →
  *After Power Failure: **Power On***. That is a firmware setting, not in this
  repo, and it is the only thing that starts the mirror — there is no reachable
  power button once the glass is on. Cut power, restore power, it comes back.

## Boot chain — headless OS to a full-screen web page
There is no display manager. X is started by the login shell on tty1; that is
the whole trick.

```
power on  →  GRUB  →  systemd (multi-user.target)
             │         ├─ mirror-web.service      npm run start, :3000, Restart=always
             │         └─ getty@tty1  --autologin nathaniel
             │                └─ ~/.bash_profile  startx -- -nocursor   (tty1 only)
             │                     └─ ~/.xinitrc  exec openbox-session
             │                          └─ openbox autostart
             │                               ├─ xrandr --rotate left    (portrait panel)
             │                               ├─ xset s off -dpms        (never blank)
             │                               ├─ unclutter               (hide cursor)
             │                               └─ exec scripts/kiosk.sh
             │                                    └─ chromium --kiosk --app=127.0.0.1:3000
             └─ GRUB_TIMEOUT=0, GRUB_RECORDFAIL_TIMEOUT=3
                so an unclean shutdown costs 3s at the menu, not 30
```

`kiosk.sh` is a supervisor, not a one-shot: it waits for the web server, then
relaunches Chromium on crash, on white-screen (via the `/api/health`
heartbeat), and when the server recovers from an outage.

Two **user** services also start at boot (`loginctl enable-linger nathaniel`,
so they don't need a login session):
- `mirror-voice.service` → `scripts/listen.py` — wake word, speech, speech back
- `mirror-spotify.service` → librespot, so the mirror is a Spotify target

`mirror-web` is a **system** unit (needs `sudo` to restart); the other two are
user units (`systemctl --user`).

## Quick start on the NUC (over SSH)
1. Copy this folder to the NUC home dir (see scp command from your laptop).
2. cd ~/mirror-dashboard
3. chmod +x setup.sh && ./setup.sh
4. sudo reboot   # kiosk launches automatically on boot

## Tweak your location
Edit lib/config.js (lat/lon/name, fahrenheit|celsius). Restart: sudo systemctl restart mirror-web

## Voice ("hey mirror")
Everything runs **on the box**: `scripts/listen.py` captures the USB mic through
PipeWire, gates on energy, transcribes with faster-whisper (`base.en`, int8),
checks for the wake phrase, and speaks the answer back with piper. Nothing
leaves the machine unless the wake phrase matched. (This used to be the
browser's Web Speech API — that is gone; it doesn't work in the Chromium snap.)

The transcript is sent to `/api/voice`, which uses the authenticated **`claude` CLI** for intent
understanding with live weather/news/todo data injected as context — so
conversational questions work, e.g.:
- "hey mirror, will I need a jacket tomorrow?"
- "hey mirror, what should I do first today?"
- "hey mirror, give me the headlines" / "what time is it"

The green dot = listening, blue = thinking/handling a command.

No API key needed — it reuses the CLI's existing login. Config lives in
`.env.local` (see `.env.local.example`): `MIRROR_VOICE_LLM=0` disables the LLM
and uses simple keyword answers; `MIRROR_LLM_MODEL` picks the model (default
`haiku`). If the CLI is missing or offline, voice degrades gracefully to the
keyword fallback. Note: each LLM voice command spawns a `claude` process
(~few-second latency, small per-call cost).

## Data sources (no API keys needed)
- Weather: Open-Meteo
- News: Hacker News front page
- Todos: data/todos.json (edit directly, or POST /api/todos)

## Google Calendar (optional)
In Google Calendar → Settings → *your calendar* → "Integrate calendar" → copy
the **Secret address in iCal format**, and put it in `.env.local`:
`GOOGLE_CALENDAR_ICS_URL=...`, then `sudo systemctl restart mirror-web`. The
Schedule widget and "what's on my calendar?" voice answers appear automatically;
without the URL they stay hidden. Read-only; Google's feed can lag edits by up
to an hour or two.

## Anime zone
Drop clips into `public/anime/` (subfolders per show are fine). They auto-appear
and cycle at random on black. See `public/anime/README.txt`.

## Test before mounting
Run on your laptop first:  npm install && npm run dev  → open http://localhost:3000

## Robustness (production kiosk)
- **Production server**: the service runs `npm run start` (NODE_ENV=production). Rebuild after code changes: `npm run build && sudo systemctl restart mirror-web`.
- **Self-healing kiosk**: `scripts/kiosk.sh` (from Openbox autostart) relaunches Chromium on crash, on white-screen (the page sends a heartbeat to `/api/health`; a stale heartbeat triggers relaunch), and when the web server recovers from an outage.
- **Last-good cache**: weather + news keep their last successful payload (memory + `data/cache/`), so a network blip shows stale data instead of "loading…".
- **Daily refresh**: the page reloads itself at 4am to clear browser cruft (`components/Kiosk.js`, REFRESH_HOUR).
- **Screen dimming**: `scripts/screen-schedule.sh` dims the panel overnight via `xrandr --brightness` (no hardware backlight on this panel). Tune hours/levels at the top of the script.
- **Log caps**: `deploy/journald-mirror.conf` caps journald disk use (installed to `/etc/systemd/journald.conf.d/mirror.conf`).
- Root-owned config (systemd unit + journald cap) lives in `deploy/`; `setup.sh` installs it.
