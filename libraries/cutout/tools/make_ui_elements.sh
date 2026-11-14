#!/usr/bin/env bash
# Makes dist/models/ui_elements.onnx (the UI-element detector build.sh puts in the cut-out library) from its pinned source, in its pinned environment:
#
#   PYTHON=python3.12 libraries/cutout/tools/make_ui_elements.sh
#
# PYTHON must be Python 3.12.7 (library.json uiElementsSource.python). The packages are the exact versions in export_requirements.txt, installed with
# --no-deps into a fresh venv; the three source files come from Hugging Face at the pinned revision and are checked by sha256; the export must come out as
# library.json's uiElementsSha256, or nothing is written. The export (export_ui_elements.py) leaves out the exporter's path-bearing debug notes, so it is the
# same bytes on any computer with this environment. GitHub Actions runs it on macos-latest (Apple silicon) (.github/workflows/build-library.yml).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
LIB="$(cd "$HERE/.." && pwd)"
ROOT="$(cd "$LIB/../.." && pwd)"
PY="${PYTHON:-python3.12}"
sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
pin() { "$PY" -I -c 'import json,sys; d=json.load(open(sys.argv[1]))["upstream"]; print(eval(sys.argv[2], {}, {"u": d}))' "$LIB/library.json" "$1"; }

WANT_PY="$(pin 'u["uiElementsSource"]["python"]')"
GOT_PY="$("$PY" -I -c 'import platform; print(platform.python_version())')"
[ "$GOT_PY" = "$WANT_PY" ] || { echo "make_ui_elements.sh: $PY is Python $GOT_PY, the export is pinned to $WANT_PY" >&2; exit 1; }
REPO="$(pin 'u["uiElementsSource"]["repo"]')"
REV="$(pin 'u["uiElementsSource"]["revision"]')"
WANT="$(pin 'u["uiElementsSha256"]')"
DEST="$ROOT/$(pin 'u["uiElementsFile"]')"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
"$PY" -m venv "$WORK/env"
"$WORK/env/bin/python" -I -m pip install --quiet --disable-pip-version-check --no-deps -r "$HERE/export_requirements.txt"

mkdir -p "$WORK/model"
pin '"\n".join(f["name"] + " " + f["sha256"] for f in u["uiElementsSource"]["files"])' | while read -r NAME SHA; do
  curl -fsSL --retry 5 "https://huggingface.co/$REPO/resolve/$REV/$NAME" -o "$WORK/model/$NAME"
  [ "$(sha256 "$WORK/model/$NAME")" = "$SHA" ] || { echo "make_ui_elements.sh: $NAME at $REV does not match its pinned sha256" >&2; exit 1; }
done

# any picture serves: it only feeds the export's comparison with torch
"$WORK/env/bin/python" -I -c 'import sys
from PIL import Image, ImageDraw
im = Image.new("RGB", (900, 600), (246, 247, 250)); d = ImageDraw.Draw(im)
d.rectangle((40, 40, 860, 110), fill=(30, 41, 59)); d.rectangle((60, 160, 420, 520), fill=(255, 255, 255), outline=(200, 205, 215))
d.rectangle((480, 160, 840, 360), fill=(99, 102, 241)); d.text((80, 180), "Sign in", fill=(0, 0, 0)); d.text((500, 180), "Overview", fill=(255, 255, 255))
im.save(sys.argv[1])' "$WORK/picture.png"

"$WORK/env/bin/python" -I "$HERE/export_ui_elements.py" "$WORK/model" "$WORK/ui_elements.onnx" "$WORK/picture.png"
GOT="$(sha256 "$WORK/ui_elements.onnx")"
[ "$GOT" = "$WANT" ] || { echo "make_ui_elements.sh: the export is $GOT, library.json pins $WANT" >&2; exit 1; }
mkdir -p "$(dirname "$DEST")"
cp "$WORK/ui_elements.onnx" "$DEST"
echo "$DEST ($GOT)"
