# Mirror Dashboard — quick start

## On the NUC (over SSH)
1. Copy this folder to the NUC home dir (see scp command from your laptop).
2. cd ~/mirror-dashboard
3. chmod +x setup.sh && ./setup.sh
4. sudo reboot   # kiosk launches automatically on boot

## Tweak your location
Edit lib/config.js (lat/lon/name, fahrenheit|celsius). Restart: sudo systemctl restart mirror-web

## Voice ("hey mirror")
Browser does the wake-word + speech-to-text + text-to-speech. The transcript is
sent to `/api/voice`, which uses the authenticated **`claude` CLI** for intent
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
