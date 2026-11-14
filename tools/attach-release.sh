#!/usr/bin/env bash
# Attaches one built archive to the release `<id>-v<version>`, making the release first if it is missing (title "<name> <version>", notes "<name> <version>.",
# as tools/publish.js makes it). Used by .github/workflows/build-library.yml with the job's GITHUB_TOKEN; it never touches the `index` release and signs nothing.
#
#   tools/attach-release.sh <id> <version> <archive named <id>-<version>-<platform>.tar.gz>
set -euo pipefail
ID="${1:?id}"; VERSION="${2:?version}"; ARCHIVE="${3:?archive}"
TAG="$ID-v$VERSION"
[ "$TAG" != index ] || { echo "attach-release.sh: refusing the index release" >&2; exit 1; }
case "$(basename "$ARCHIVE")" in "$ID-$VERSION-"*.tar.gz|"$ID-$VERSION-"*.zip) ;; *) echo "attach-release.sh: $ARCHIVE is not named $ID-$VERSION-<platform>.tar.gz" >&2; exit 1 ;; esac
NAME="$(node -p "require('./libraries/$ID/library.json').name")"
if DRAFT="$(gh release view "$TAG" --json isDraft -q .isDraft 2>/dev/null)"; then
  # a draft's assets are not public, and the index lists only what anyone can download
  [ "$DRAFT" = false ] || { echo "attach-release.sh: $TAG is a draft; publish or delete it first" >&2; exit 1; }
else
  gh release create "$TAG" --title "$NAME $VERSION" --notes "$NAME $VERSION."
fi
gh release upload "$TAG" --clobber "$ARCHIVE"
gh release view "$TAG" --json assets -q '.assets[] | "\(.name) \(.size)"'
