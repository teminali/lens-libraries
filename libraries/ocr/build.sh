#!/usr/bin/env bash
# Builds the word reader library for the computer it runs on: dist/ocr-<version>-<platform>.tar.gz
#
#   libraries/ocr/build.sh 1.0.0
#
# The archive holds a portable CPython (python-build-standalone, through uv), indra-ocr and its packages installed into it, the models at the revision that
# indra-ocr version was built against, the launchers, the licences and the notice. Nothing outside the folder is needed to run it.
# On Windows, run it from Git Bash: the launcher there is bin/ocr.cmd and the Python is python/python.exe.
set -euo pipefail

VERSION="${1:?usage: build.sh <version>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
INDRA="$(python3 -c "import json; print(json.load(open('$HERE/library.json'))['upstream']['version'])")"
REVISION="$(python3 -c "import json; print(json.load(open('$HERE/library.json'))['upstream']['modelRevision'])")"
PYTHON_VERSION="3.11"

case "$(uname -s)" in
  Darwin) OS=darwin ;;
  Linux) OS=linux ;;
  MINGW*|MSYS*|CYGWIN*) OS=windows ;;
  *) echo "build.sh: unknown system $(uname -s)" >&2; exit 1 ;;
esac
case "$(uname -m)" in
  arm64|aarch64) ARCH=arm64 ;;
  x86_64|AMD64) ARCH=x64 ;;
  *) echo "build.sh: unknown machine $(uname -m)" >&2; exit 1 ;;
esac
PLATFORM="$OS-$ARCH"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
OUT="$WORK/ocr"
mkdir -p "$OUT" "$ROOT/dist"
cp -R "$HERE/files/." "$OUT/"
printf '%s\n' "$VERSION" > "$OUT/VERSION"

# 1. A portable CPython, moved into the library (python-build-standalone runs from any folder).
UV_PYTHON_INSTALL_DIR="$WORK/pythons" uv python install "$PYTHON_VERSION" >/dev/null
SRC="$(find "$WORK/pythons" -mindepth 1 -maxdepth 1 -type d -name 'cpython-*' | head -1)"
mv "$SRC" "$OUT/python"
if [ "$OS" = windows ]; then PY="$OUT/python/python.exe"; else PY="$OUT/python/bin/python3"; fi

# 2. indra-ocr and what it needs, into that Python (pillow reads the pictures).
uv pip install --python "$PY" --break-system-packages --no-cache --quiet "indra-ocr==$INDRA" pillow

# 3. The models, at the revision this indra-ocr was built against, inside the library.
"$PY" -I -c "from huggingface_hub import snapshot_download; snapshot_download('datalab-to/indra-ocr', revision='$REVISION', local_dir='$OUT/models')" >/dev/null
rm -rf "$OUT/models/.cache"

# 4. It answers for its version from where it stands (through its launcher where the shell can run it), and each system keeps only its own launcher.
if [ "$OS" = windows ]; then rm -f "$OUT/bin/ocr"; GOT="$("$PY" -I "$OUT/lib/ocr.py" --version | tr -d '\r')"; else rm -f "$OUT/bin/ocr.cmd"; GOT="$("$OUT/bin/ocr" --version)"; fi
[ "$GOT" = "$VERSION" ] || { echo "build.sh: the library reports '$GOT', not $VERSION" >&2; exit 1; }

ARCHIVE="$ROOT/dist/ocr-$VERSION-$PLATFORM.tar.gz"
tar -czf "$ARCHIVE" -C "$OUT" .
echo "$ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"
