#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo 'This build needs macOS with Xcode. On Windows, use the included GitHub Actions workflow.' >&2
  exit 1
fi
xcodebuild -version
plutil -lint ios/Volna/Info.plist
xcodebuild -project ios/Volna.xcodeproj -scheme Volna -configuration Release \
  -sdk iphoneos -destination 'generic/platform=iOS' -derivedDataPath build/DerivedData \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" build
APP="build/DerivedData/Build/Products/Release-iphoneos/Volna.app"
test -f "$APP/Volna"
lipo -archs "$APP/Volna" | grep -q arm64
# A fresh staging directory avoids accidentally packaging a previous app build.
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/volna-package.XXXXXX")"
mkdir -p "$STAGE/Payload" dist
ditto "$APP" "$STAGE/Payload/Volna.app"
ditto -c -k --keepParent "$STAGE/Payload" "$PWD/dist/Volna-unsigned.ipa"
unzip -t dist/Volna-unsigned.ipa
echo 'Created dist/Volna-unsigned.ipa — needs signing before installation.'
