#!/usr/bin/env python3
"""Local voice loop for the mirror: listen -> transcribe -> answer -> speak.

Speech recognition used to run in the browser via the Web Speech API, but
Google restricts that backend to official Chrome builds; the Chromium snap on
this box gets rejected with a bare "network" error no configuration can fix.
So recognition moved here, on-device:

    USB mic --pw-record--> VAD --> faster-whisper --> wake check
                                                       |
                              (only if you said "hey mirror")
                                                       v
                                        POST /api/voice --> Claude Haiku
                                                       |
                                        piper --pw-play--> speakers

Nothing leaves the machine unless the wake phrase is matched. Everything heard
is posted to /api/voice/state so the page can show it, which is local-only.

Runs as a systemd *user* service (see deploy/mirror-voice.service).
"""
import array
import collections
import json
import math
import os
import re
import select
import struct
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import wave

HOME = os.path.expanduser("~")
SHARE = os.path.join(HOME, ".local/share/mirror-voice")
MIRROR_URL = os.environ.get("MIRROR_URL", "http://localhost:3000")
# The mic's node name embeds its card profile, and the profile is not ours to
# control — an ALSA card-profile change renamed this device's source from
# ...mono-fallback to ...analog-mono, which would have pinned us to a node that
# no longer exists. Match on the stable middle of the name instead. Set
# MIRROR_MIC to override with an exact node name.
MIC = os.environ.get("MIRROR_MIC", "")
MIC_MATCH = os.environ.get("MIRROR_MIC_MATCH", "USB_PnP_Sound_Device")
VOICE_ONNX = os.environ.get("MIRROR_TTS_VOICE", os.path.join(SHARE, "voices/en_GB-alan-medium.onnx"))
WHISPER_MODEL = os.environ.get("MIRROR_WHISPER_MODEL", "base.en")
# Speech is scaled down to sit alongside music rather than shout over it.
TTS_GAIN = float(os.environ.get("MIRROR_TTS_GAIN", "0.22"))

RATE = 16000            # whisper wants 16k mono
FRAME_MS = 30
FRAME = RATE * FRAME_MS // 1000          # samples per frame
SILENCE_END_MS = 800    # trailing quiet that ends an utterance
MIN_SPEECH_MS = 350     # ignore coughs, door clicks, a single loud tap
MAX_UTTER_S = 15        # hard stop so a running tap can't record forever
PREROLL_MS = 500        # keep audio from *before* the trigger, or we clip "hey"
NOISE_WINDOW = 120      # frames of history for the adaptive noise floor
TRIGGER_OVER_NOISE = 3.0  # speech must be this many times the noise floor
NO_SPEECH_MAX = 0.5     # reject Whisper's noise hallucinations
LOGPROB_MIN = -1.0      # ...and anything it clearly guessed at
HEARTBEAT_S = 5         # keep in step with HEARTBEAT_MS in lib/liveness.js
STALL_S = 30            # main loop silent this long = wedged, stop the heartbeat
READ_TIMEOUT_S = 5      # no audio for this long = the capture stream is dead
PROBE_TRIES = 12        # ~60s of waiting for PipeWire before we intervene

# Must stay in step with lib/wake.js — the browser, the API and this file all
# have to agree on what counts as the wake phrase.
WAKE_RE = re.compile(r"\b(?:hey|ok|okay)[\s,]+mirror\b", re.I)


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def strip_wake(text):
    """Everything after the LAST wake phrase — mirrors stripWake() in wake.js."""
    out, last = text, None
    for m in WAKE_RE.finditer(text):
        last = m
    if last:
        out = text[last.end():]
    return out.lstrip(" ,.:;!?-").strip()


def rms(frame_bytes):
    n = len(frame_bytes) // 2
    if n == 0:
        return 0.0
    vals = struct.unpack("<%dh" % n, frame_bytes[: n * 2])
    return math.sqrt(sum(float(v) * v for v in vals) / n) / 32768.0


def post_json(path, payload, timeout=30):
    req = urllib.request.Request(
        MIRROR_URL + path,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode() or "{}")


# Last moment the main loop was known to be making progress. Only ever written
# from the main thread, only ever read from the heartbeat thread.
_alive_at = 0.0


def touch():
    global _alive_at
    _alive_at = time.monotonic()


def report(**state):
    """Tell the web page what just happened. Never fatal — display only.

    Also counts as proof of progress: this is only ever called from the main
    thread, so reaching it means the loop is running. That keeps the heartbeat
    alive through a long reply, when no audio frames are being read.
    """
    touch()
    try:
        post_json("/api/voice/state", state, timeout=5)
    except Exception:
        pass


def heartbeat():
    """Say "still here" on a timer, forever.

    Without this, silence and death look identical to the page: reports were
    only sent when something was heard, so a quiet house for fifteen seconds
    made the mirror declare its own voice daemon dead and shut the face's eyes.
    Daytime chatter refreshed the state often enough to hide it.

    The beat is deliberately not a bare "the process exists" ping — it stops if
    the main loop stops making progress, so a wedged listener still shows up as
    down. The window is generous because a reply legitimately blocks the loop
    for several seconds.

    An empty patch bumps the server's timestamp without touching status, so a
    beat landing mid-reply can't overwrite "thinking" or "speaking". It runs on
    its own thread because the main loop is blocked reading the mic, and a POST
    there would stall capture — the pw-record pipe holds only about two seconds.
    """
    while True:
        time.sleep(HEARTBEAT_S)
        if time.monotonic() - _alive_at > STALL_S:
            continue      # loop is stuck; let the page notice
        try:
            post_json("/api/voice/state", {}, timeout=4)
        except Exception:
            pass          # web server restarting; the next beat will land


def find_mic():
    """The USB mic's current PipeWire node name, or "" if it isn't there yet."""
    if MIC:
        return MIC
    try:
        out = subprocess.run(["pactl", "list", "short", "sources"],
                             capture_output=True, text=True, timeout=5).stdout
    except Exception:
        return ""
    for line in out.splitlines():
        cols = line.split("\t")
        name = cols[1] if len(cols) > 1 else ""
        if MIC_MATCH in name and not name.endswith(".monitor"):
            return name
    return ""


def capture_works(target):
    """Does a fresh capture stream actually deliver audio within a second?

    Existence of the node proves nothing. At boot this daemon and WirePlumber
    start in the same second, and a capture stream opened while WirePlumber is
    still configuring devices is handed out happily but never delivers a single
    frame — the link sits in "init" forever and the mirror is silently deaf.
    Nothing errors, nothing logs; it just never hears anything again.
    """
    cmd = ["pw-record", "--rate", str(RATE), "--channels", "1", "--format", "s16", "-"]
    if target:
        cmd[1:1] = ["--target", target]
    try:
        p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=0)
    except Exception:
        return False
    try:
        got = 0
        deadline = time.monotonic() + 2.0
        while got < 4096 and time.monotonic() < deadline:
            r, _, _ = select.select([p.stdout], [], [], deadline - time.monotonic())
            if not r:
                break
            b = p.stdout.read(4096)
            if not b:
                break
            got += len(b)
        return got >= 4096      # more than pw-record's header, so real samples
    finally:
        try:
            p.kill()
        except Exception:
            pass


def wait_for_audio():
    """Block until capture genuinely works, healing the sound server if it must.

    Returns the mic node name to record from.
    """
    for attempt in range(PROBE_TRIES):
        target = find_mic()
        if capture_works(target):
            return target
        log(f"waiting for audio input (attempt {attempt + 1}/{PROBE_TRIES})")
        time.sleep(5)

    # A minute of nothing. Restarting the sound server is the one thing that
    # reliably clears a wedged capture graph; without it the mirror stays deaf
    # until someone notices and SSHes in. Playback drops for a moment, and
    # mirror-spotify restarts itself.
    log("audio input still dead — restarting the PipeWire stack")
    subprocess.run(["systemctl", "--user", "restart", "pipewire", "pipewire-pulse", "wireplumber"],
                   check=False)
    time.sleep(5)
    target = find_mic()
    if not capture_works(target):
        log("audio input still dead after restarting PipeWire — carrying on anyway")
    return target


class Recorder:
    """Continuous raw PCM from the USB mic via pw-record, restarted if it dies.

    pw-record is used rather than a Python audio binding so the daemon needs no
    system packages at all (portaudio would have meant another sudo apt).
    """

    def __init__(self, target):
        self.p = None
        self.target = target
        self.start()

    def start(self):
        self.stop()
        # Re-resolve every time: if this restart is because the stream stalled,
        # the device may well have come back under a different node name.
        self.target = find_mic() or self.target
        cmd = ["pw-record", "--rate", str(RATE),
               "--channels", "1", "--format", "s16", "-"]
        if self.target:
            cmd[1:1] = ["--target", self.target]
        # bufsize=0 so select() on the pipe tells the truth — a buffered reader
        # can hold data that select never reports as ready.
        self.p = subprocess.Popen(cmd, stdout=subprocess.PIPE,
                                  stderr=subprocess.DEVNULL, bufsize=0)
        log("recorder started on", self.target or "(default source)")

    def stop(self):
        if self.p:
            try:
                self.p.kill()
            except Exception:
                pass
            self.p = None

    def read(self, nbytes):
        """Exactly nbytes of audio, or None if the stream died or went quiet.

        "Quiet" here means no bytes at all, which is not the same as silence:
        silence still arrives as zeroes. A capture stream that delivers nothing
        is broken, and reconnecting is what clears it.
        """
        if not self.p or self.p.poll() is not None:
            log("recorder died — restarting")
            time.sleep(1)
            self.start()
            return None

        buf = b""
        deadline = time.monotonic() + READ_TIMEOUT_S
        while len(buf) < nbytes:
            left = deadline - time.monotonic()
            if left <= 0:
                log(f"no audio for {READ_TIMEOUT_S}s — reconnecting recorder")
                self.start()
                return None
            r, _, _ = select.select([self.p.stdout], [], [], left)
            if not r:
                continue                  # loop until the deadline passes
            chunk = self.p.stdout.read(nbytes - len(buf))
            if not chunk:                 # pipe closed under us
                log("recorder stream ended — restarting")
                self.start()
                return None
            buf += chunk
        return buf

    def flush(self):
        """Drop everything captured while the mirror was talking.

        The speakers and the mic share one enclosure, so the mic hears every
        reply loudly. Without this the mirror transcribes its own voice and can
        answer itself. Restarting the capture is the one reliable way to clear
        both the pipe and the kernel buffer.
        """
        self.start()


class Duck:
    """Hold the music down while the mirror is thinking and talking.

    Routed through the server (which holds the Spotify token) rather than the
    local PipeWire stream. librespot's pw-play blocks reading its pipe whenever
    playback is stopped, so it cannot service a control round trip — both
    `wpctl set-volume` and `pactl set-sink-input-volume` hang on that node,
    which would stall this daemon before every single reply.

    Every call is best-effort with a short timeout: ducking is a nicety, and it
    must never delay or break an answer. Restoring happens in __exit__, so an
    exception mid-reply cannot leave the music stuck quiet.
    """

    def _send(self, on):
        try:
            post_json("/api/spotify/duck", {"on": on}, timeout=4)
        except Exception:
            pass

    def __enter__(self):
        self._send(True)
        return self

    def __exit__(self, *exc):
        self._send(False)
        return False


def speak(voice, text):
    """Synthesize with piper and play it out the default sink.

    Piper renders near full scale, while Spotify arrives already attenuated by
    librespot's softvol — so at a sink level tuned for music, speech is
    painfully loud. Scale the samples here rather than with `pw-play --volume`:
    that option is non-linear (0.3 measured only ~2.6 dB down) and left peaks
    clipping, whereas multiplying the PCM is exact and predictable.
    """
    wav = "/tmp/mirror-voice-reply.wav"
    with wave.open(wav, "wb") as w:
        voice.synthesize_wav(text, w)

    if TTS_GAIN != 1.0:
        with wave.open(wav, "rb") as w:
            params, frames = w.getparams(), w.readframes(w.getnframes())
        a = array.array("h")
        a.frombytes(frames)
        for i, v in enumerate(a):
            a[i] = max(-32768, min(32767, int(v * TTS_GAIN)))
        with wave.open(wav, "wb") as w:
            w.setparams(params)
            w.writeframes(a.tobytes())

    subprocess.run(["pw-play", wav], check=False,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def main():
    from faster_whisper import WhisperModel
    from piper import PiperVoice

    # Before anything else, make sure we can actually hear. Loading Whisper
    # first would only delay the discovery by six seconds.
    mic = wait_for_audio()

    log("loading whisper", WHISPER_MODEL)
    asr = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8", cpu_threads=6)
    log("loading piper voice")
    tts = PiperVoice.load(VOICE_ONNX)
    log("ready — listening")
    touch()
    report(status="listening", heard="", event="ready")
    threading.Thread(target=heartbeat, daemon=True).start()

    rec = Recorder(mic)
    noise = collections.deque(maxlen=NOISE_WINDOW)
    preroll = collections.deque(maxlen=max(1, PREROLL_MS // FRAME_MS))
    speech = []
    in_speech = False
    quiet_ms = 0

    while True:
        chunk = rec.read(FRAME * 2)
        touch()             # audio is flowing, whatever it contains
        if not chunk:
            continue
        if len(chunk) < FRAME * 2:      # short read at stream start
            continue

        level = rms(chunk)

        if not in_speech:
            noise.append(level)
            preroll.append(chunk)
            # 20th percentile of recent frames = the room's resting level, so a
            # noisy mic (this C-Media one hisses) doesn't hold the gate open.
            floor = sorted(noise)[len(noise) // 5] if len(noise) >= 10 else 0.02
            if level > max(floor * TRIGGER_OVER_NOISE, 0.012):
                in_speech = True
                quiet_ms = 0
                speech = list(preroll)   # include the run-up so "hey" survives
                speech.append(chunk)
            continue

        speech.append(chunk)
        floor = sorted(noise)[len(noise) // 5] if len(noise) >= 10 else 0.02
        if level <= max(floor * TRIGGER_OVER_NOISE, 0.012):
            quiet_ms += FRAME_MS
        else:
            quiet_ms = 0

        dur_ms = len(speech) * FRAME_MS
        if quiet_ms < SILENCE_END_MS and dur_ms < MAX_UTTER_S * 1000:
            continue

        # --- utterance complete -------------------------------------------
        in_speech = False
        audio = b"".join(speech)
        speech = []
        if dur_ms - quiet_ms < MIN_SPEECH_MS:
            continue                      # too short to be words

        path = "/tmp/mirror-utterance.wav"
        with wave.open(path, "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE)
            w.writeframes(audio)

        t0 = time.time()
        try:
            segs, _ = asr.transcribe(path, beam_size=1, vad_filter=True,
                                     condition_on_previous_text=False)
            # Whisper invents fluent sentences when handed noise or clipped
            # audio, so drop anything it isn't confident about. Clean speech
            # measures around no_speech 0.01 / logprob -0.4; garbage sits far
            # outside that.
            keep = [s for s in segs
                    if s.no_speech_prob < NO_SPEECH_MAX and s.avg_logprob > LOGPROB_MIN]
            text = " ".join(s.text.strip() for s in keep).strip()
        except Exception as e:
            log("transcribe failed:", e)
            report(status="listening", event="error", error=str(e)[:200])
            continue
        took = time.time() - t0

        if not text:
            continue
        woke = bool(WAKE_RE.search(text))
        log(f"[{took:.1f}s] {'WAKE' if woke else 'heard'}: {text}")
        report(status="listening", heard=text, event="wake" if woke else "heard")

        if not woke:
            continue                      # never leaves the machine

        cmd = strip_wake(text)
        reply = ""
        # Duck from the moment we know it was addressed to us until the reply
        # has finished, so the thinking pause isn't filled with loud music and
        # the answer isn't competing with it.
        with Duck():
            if not cmd:
                speak(tts, "Yes?")
            else:
                report(status="thinking", heard=text, event="thinking")
                try:
                    r = post_json("/api/voice", {"transcript": text})
                    reply = (r or {}).get("reply") or ""
                except Exception as e:
                    log("ask failed:", e)
                    reply = "I'm having trouble thinking right now."
                if reply:
                    report(status="speaking", heard=text, reply=reply, event="reply")
                    speak(tts, reply)

        rec.flush()                       # forget our own voice
        noise.clear(); preroll.clear(); in_speech = False; quiet_ms = 0
        report(status="listening", heard=text, reply=reply)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
