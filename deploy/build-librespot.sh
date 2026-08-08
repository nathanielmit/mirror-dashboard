#!/usr/bin/env bash
# Build librespot so the mirror itself becomes a Spotify Connect speaker.
#
# No sudo anywhere: rustup installs under ~/.cargo, and we build with
# --no-default-features so no audio backend is compiled in. librespot's "pipe"
# backend needs no system libraries at all — it writes raw PCM to stdout and we
# hand that to pw-play, which is already how the voice daemon plays audio.
# (The usual alsa/pulse backends would each drag in -dev headers via apt.)
set -euo pipefail

LOG() { printf '\n=== %s\n' "$1"; }

if ! command -v rustc >/dev/null 2>&1 && [ ! -x "$HOME/.cargo/bin/rustc" ]; then
  LOG "Installing the Rust toolchain into ~/.cargo (no root needed)"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --no-modify-path --profile minimal
fi

export PATH="$HOME/.cargo/bin:$PATH"
LOG "Toolchain"
rustc --version
cargo --version

LOG "Building librespot (this is the slow part, ~10-20 min)"
# --no-default-features drops the audio backends AND the default TLS stack, so
# TLS has to be named explicitly or the build stops at a compile_error!.
# rustls-tls-native-roots is pure Rust and reads the system CA store, so it
# needs no libssl-dev — which keeps this whole script sudo-free.
# with-libmdns restores zeroconf discovery (also dropped by --no-default-features).
# Without it librespot can only log in via an OAuth redirect to 127.0.0.1 ON THIS
# BOX, which is painful over SSH. With it, the mirror just appears in the Spotify
# app's device list and one tap caches the credentials for good. It's pure Rust,
# so still no apt packages.
cargo install librespot --no-default-features \
  --features "rustls-tls-native-roots,with-libmdns" --locked

LOG "Done"
"$HOME/.cargo/bin/librespot" --version
