#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [[ -z "$SDK" ]]; then echo 'Set ANDROID_HOME to the Android SDK directory.' >&2; exit 1; fi
TOOLS="$SDK/build-tools/35.0.0"
PLATFORM="$SDK/platforms/android-35/android.jar"
for tool in aapt2 d8 zipalign apksigner; do test -x "$TOOLS/$tool"; done
test -f "$PLATFORM"
BUILD="$(mktemp -d "${TMPDIR:-/tmp}/volna-android.XXXXXX")"
mkdir -p "$BUILD/classes" "$BUILD/generated" "$BUILD/dex" "$BUILD/tests" dist
javac -encoding UTF-8 -d "$BUILD/tests" android/app/src/main/java/app/volna/messenger/ServerAddress.java android/tests/ServerAddressTest.java
java -cp "$BUILD/tests" ServerAddressTest
"$TOOLS/aapt2" compile --dir android/app/src/main/res -o "$BUILD/resources.zip"
"$TOOLS/aapt2" link -o "$BUILD/resources.apk" --manifest android/app/src/main/AndroidManifest.xml \
  -I "$PLATFORM" --java "$BUILD/generated" --auto-add-overlay "$BUILD/resources.zip"
find android/app/src/main/java "$BUILD/generated" -name '*.java' > "$BUILD/sources.txt"
javac -encoding UTF-8 -source 8 -target 8 -bootclasspath "$PLATFORM" -d "$BUILD/classes" @"$BUILD/sources.txt"
jar cf "$BUILD/classes.jar" -C "$BUILD/classes" .
"$TOOLS/d8" --release --min-api 26 --lib "$PLATFORM" --output "$BUILD/dex" "$BUILD/classes.jar"
cp "$BUILD/resources.apk" "$BUILD/unpacked.apk"
(cd "$BUILD/dex" && zip -q -0 "$BUILD/unpacked.apk" classes.dex)
"$TOOLS/zipalign" -f -p 4 "$BUILD/unpacked.apk" "$BUILD/aligned.apk"
# A personal test build is installable without Google Play or an account.
# Keep production signing keys out of the public repository and build artifacts.
keytool -genkeypair -keystore "$BUILD/personal-test.p12" -storetype PKCS12 \
  -storepass android -keypass android -alias volna-test -keyalg RSA -keysize 2048 \
  -validity 10000 -dname 'CN=Volna Personal Test, OU=Development, O=Volna, C=US' -noprompt
"$TOOLS/apksigner" sign --ks "$BUILD/personal-test.p12" --ks-pass pass:android \
  --ks-key-alias volna-test --out dist/Volna.apk "$BUILD/aligned.apk"
"$TOOLS/apksigner" verify --verbose --print-certs dist/Volna.apk
"$TOOLS/zipalign" -c -v 4 dist/Volna.apk
"$TOOLS/aapt2" dump badging dist/Volna.apk
sha256sum dist/Volna.apk | tee dist/Volna.apk.sha256
echo 'Created dist/Volna.apk — signed personal test build for Android 8.0+.'
