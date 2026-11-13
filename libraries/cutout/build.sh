#!/usr/bin/env bash
# Builds the cut-out library for the computer it runs on: dist/cutout-<version>-<platform>.tar.gz
#
#   libraries/cutout/build.sh 1.0.0
#
# The archive holds a Node.js runtime, engine/cutout.mjs with onnxruntime-node and pngjs installed beside it (onnxruntime's native part for this platform only),
# the model, the launchers and the notice. Nothing outside the folder is needed to run it. engine/cutout.mjs and engine/model.onnx are the same bytes on
# every platform: one engine, one model, so a cut-out on Windows is the cut-out on a Mac.
# On Windows, run it from Git Bash: the launcher there is bin/cutout.cmd and the runtime node/node.exe.
set -euo pipefail

VERSION="${1:?usage: build.sh <version>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
field() { sed -n "s/.*\"$1\": *\"\([^\"]*\)\".*/\1/p" "$HERE/library.json" | head -1; }
NODE_VERSION="$(field node)"
MODEL_URL="$(field modelUrl)"
MODEL_SHA="$(field modelSha256)"

case "$(uname -s)" in
  Darwin) OS=darwin; NODE_OS=darwin ;;
  Linux) OS=linux; NODE_OS=linux ;;
  MINGW*|MSYS*|CYGWIN*) OS=windows; NODE_OS=win ;;
  *) echo "build.sh: unknown system $(uname -s)" >&2; exit 1 ;;
esac
case "$(uname -m)" in
  arm64|aarch64) ARCH=arm64 ;;
  x86_64|AMD64) ARCH=x64 ;;
  *) echo "build.sh: unknown machine $(uname -m)" >&2; exit 1 ;;
esac
PLATFORM="$OS-$ARCH"
sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
OUT="$WORK/cutout"
mkdir -p "$OUT" "$ROOT/dist"
cp -R "$HERE/files/." "$OUT/"
printf '%s\n' "$VERSION" > "$OUT/VERSION"

# 1. Node.js, from nodejs.org, checked against the release's SHASUMS256.txt.
BASE="https://nodejs.org/dist/v$NODE_VERSION"
if [ "$OS" = windows ]; then PKG="node-v$NODE_VERSION-$NODE_OS-$ARCH.zip"; else PKG="node-v$NODE_VERSION-$NODE_OS-$ARCH.tar.gz"; fi
curl -fsSL "$BASE/$PKG" -o "$WORK/$PKG"
curl -fsSL "$BASE/SHASUMS256.txt" -o "$WORK/SHASUMS256.txt"
WANT="$(grep " $PKG\$" "$WORK/SHASUMS256.txt" | cut -d' ' -f1)"
[ -n "$WANT" ] && [ "$(sha256 "$WORK/$PKG")" = "$WANT" ] || { echo "build.sh: $PKG does not match nodejs.org's checksum" >&2; exit 1; }
if [ "$OS" = windows ]; then unzip -q "$WORK/$PKG" -d "$WORK/node-x"; else mkdir -p "$WORK/node-x"; tar -xzf "$WORK/$PKG" -C "$WORK/node-x"; fi
mv "$WORK/node-x/node-v$NODE_VERSION-$NODE_OS-$ARCH" "$OUT/node"
if [ "$OS" = windows ]; then NODE="$OUT/node/node.exe"; NPM="$OUT/node/npm.cmd"; else NODE="$OUT/node/bin/node"; NPM="$OUT/node/bin/npm"; fi

# 2. The engine's packages, by that Node's own npm (exact versions in engine/package.json); then only this platform's onnxruntime binary is kept, and npm itself
#    leaves (the library never installs anything).
( cd "$OUT/engine" && PATH="$(dirname "$NODE"):$PATH" "$NPM" install --omit=dev --no-audit --no-fund --loglevel=error )
ORT_BIN="$OUT/engine/node_modules/onnxruntime-node/bin/napi-v6"
case "$OS" in windows) KEEP=win32 ;; *) KEEP=$OS ;; esac
for d in "$ORT_BIN"/*; do [ "$(basename "$d")" = "$KEEP" ] || rm -rf "$d"; done
for d in "$ORT_BIN/$KEEP"/*; do [ "$(basename "$d")" = "$ARCH" ] || rm -rf "$d"; done
rm -rf "$OUT/node/lib/node_modules/npm" "$OUT/node/lib/node_modules/corepack" "$OUT/node/node_modules" "$OUT/node/include" "$OUT/node/share"
rm -f "$OUT/node/bin/npm" "$OUT/node/bin/npx" "$OUT/node/bin/corepack" "$OUT/node/npm" "$OUT/node/npm.cmd" "$OUT/node/npx" "$OUT/node/npx.cmd" "$OUT/node/corepack" "$OUT/node/corepack.cmd"

# 3. The model, checked against the sha256 in library.json.
curl -fsSL "$MODEL_URL" -o "$OUT/engine/model.onnx"
[ "$(sha256 "$OUT/engine/model.onnx")" = "$MODEL_SHA" ] || { echo "build.sh: the model does not match library.json's sha256" >&2; exit 1; }

# 4. It answers for its version from where it stands, and each system keeps only its own launcher.
if [ "$OS" = windows ]; then rm -f "$OUT/bin/cutout"; GOT="$("$NODE" "$OUT/engine/cutout.mjs" --version | tr -d '\r')"; else rm -f "$OUT/bin/cutout.cmd"; GOT="$("$OUT/bin/cutout" --version)"; fi
[ "$GOT" = "$VERSION" ] || { echo "build.sh: the library reports '$GOT', not $VERSION" >&2; exit 1; }

ARCHIVE="$ROOT/dist/cutout-$VERSION-$PLATFORM.tar.gz"
tar -czf "$ARCHIVE" -C "$OUT" .
echo "$ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"
