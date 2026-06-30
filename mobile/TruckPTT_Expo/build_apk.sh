#!/bin/bash

# ============================================
# Truck PTT - Production Build Script
# ============================================
# Builds a STANDALONE production APK including
# the ptt-overlay native module (floating bubble).
#
# Usage:
#   ./build_apk.sh                        # Local build (Gradle, default)
#   ./build_apk.sh --cloud                # EAS cloud build (Expo servers)
#   ./build_apk.sh --version 1.0.3         # Set versionName, auto-increment versionCode
#   ./build_apk.sh --cloud --version 1.1.0  # Cloud build with specific version
#   ./build_apk.sh --cloud --preview      # Cloud build with preview profile
# ============================================

set -e

BUILD_OUTPUT_DIR="./builds"
APK_SOURCE="./android/app/build/outputs/apk/release/app-release.apk"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
APK_NAME="TruckPTT_production_${TIMESTAMP}.apk"
PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"

# ---- Parse args ----
BUILD_MODE="local"
EAS_PROFILE="production"
CUSTOM_VERSION=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --cloud)    BUILD_MODE="cloud"; shift ;;
    --preview)  EAS_PROFILE="preview"; shift ;;
    --local)    BUILD_MODE="local"; shift ;;
    --version)  CUSTOM_VERSION="$2"; shift 2 ;;
    *) echo "⚠️  Unknown arg: $1"; shift ;;
  esac
done

echo "📋 Build mode: $BUILD_MODE${BUILD_MODE=="cloud" ? " (profile: $EAS_PROFILE)" : ""}${CUSTOM_VERSION ? " (version: $CUSTOM_VERSION)" : ""}"

cd "$PROJECT_ROOT"

# ---- Env check ----
if [ ! -f ".env" ]; then
  echo "⚠️  .env file not found. EXPO_PUBLIC_* vars will use defaults."
else
  echo "✅ .env file found"
  # Export EXPO_PUBLIC_* vars for prebuild/bundle
  set -a
  source .env
  set +a
fi

# ---- Native module check ----
if [ -f "./modules/ptt-overlay/expo-module.config.json" ]; then
  echo "✅ ptt-overlay native module found"
else
  echo "❌ ptt-overlay native module missing (modules/ptt-overlay/expo-module.config.json)"
  exit 1
fi

# ---- Clean output dir ----
echo "🧹 Cleaning output dir..."
rm -rf "$BUILD_OUTPUT_DIR"
mkdir -p "$BUILD_OUTPUT_DIR"

# ---- Auto increment versionCode + optional versionName override ----
echo "🔢 Auto incrementing versionCode..."
CURRENT_VERSION_CODE=$(python3 -c "
import json
with open('app.json') as f:
    data = json.load(f)
print(data.get('expo', {}).get('android', {}).get('versionCode', 1))
")
NEW_VERSION_CODE=$((CURRENT_VERSION_CODE + 1))

# Set versionName: --version override if provided, else keep existing
if [ -n "$CUSTOM_VERSION" ]; then
  NEW_VERSION_NAME="$CUSTOM_VERSION"
else
  NEW_VERSION_NAME=$(python3 -c "
import json
with open('app.json') as f:
    data = json.load(f)
print(data.get('expo', {}).get('version', '1.0.0'))
")
fi

# Write both versionCode++ and versionName (if overridden) to app.json
python3 -c "
import json
with open('app.json', 'r') as f:
    data = json.load(f)
data['expo']['android']['versionCode'] = $NEW_VERSION_CODE
data['expo']['version'] = '$NEW_VERSION_NAME'
with open('app.json', 'w') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
    f.write('\n')
"
echo "✅ versionCode: $CURRENT_VERSION_CODE → $NEW_VERSION_CODE (versionName: $NEW_VERSION_NAME)"

# ---- Cloud build: EAS Build (Expo servers) ----
if [ "$BUILD_MODE" = "cloud" ]; then
  echo ""
  echo "☁️  Starting EAS cloud build (profile: $EAS_PROFILE)..."
  echo "   EAS will build on Expo's servers. No local Gradle/Android SDK needed."
  echo ""

  # EAS uses .env automatically if EAS_BUILD_SCRIPT or env vars are set in eas.json
  # But we also export EXPO_PUBLIC_* from .env for inline embedding
  npx eas build \
    --platform android \
    --profile "$EAS_PROFILE" \
    --non-interactive \
    --auto-submit-with-profile=production 2>&1 || true

  EAS_EXIT=$?
  if [ $EAS_EXIT -ne 0 ]; then
    echo ""
    echo "❌ EAS build failed with exit code $EAS_EXIT"
    echo "   Check: https://expo.dev/accounts/[your-account]/projects/TruckPTT_Expo/builds"
    exit 1
  fi

  echo ""
  echo "✅ EAS cloud build submitted!"
  echo "   Track progress: https://expo.dev/accounts/[your-account]/projects/TruckPTT_Expo/builds"
  echo "   APK will be available for download from the EAS dashboard."
  echo ""
  echo "   Once ready, download APK and install:"
  echo "     adb install -r TruckPTT_latest.apk"
  exit 0
fi

# ---- Local build: Prebuild + Gradle (original flow) ----
echo "🔧 Regenerating android/ with native modules (expo prebuild)..."
npx expo prebuild --platform android --no-install 2>&1 | tail -5
echo "✅ Prebuild done"

# ---- Bundle JS (optional: Gradle will also bundle, this catches errors early) ----
echo "📦 Bundling JS..."
npx react-native bundle \
  --platform android \
  --dev false \
  --entry-file node_modules/expo-router/entry.js \
  --bundle-output android/app/src/main/assets/index.android.bundle \
  --assets-dest android/app/src/main/res/ \
  --reset-cache 2>&1 | tail -5
echo "✅ Bundle done"

# ---- Build release APK ----
echo "🔨 Building release APK (Gradle)..."
cd android
./gradlew assembleRelease 2>&1
GRADLE_EXIT=$?
cd ..

if [ $GRADLE_EXIT -ne 0 ]; then
  echo ""
  echo "❌ Gradle build failed with exit code $GRADLE_EXIT"
  echo "   Check android/app/build/outputs/logs/ for details"
  exit 1
fi

# ---- Verify APK ----
if [ -f "$APK_SOURCE" ]; then
  cp "$APK_SOURCE" "$BUILD_OUTPUT_DIR/$APK_NAME"
  cp "$APK_SOURCE" "$BUILD_OUTPUT_DIR/TruckPTT_latest.apk"

  echo ""
  echo "✅ Production build successful!"
  echo "📦 APK:  $BUILD_OUTPUT_DIR/$APK_NAME"
  echo "📦 Latest: $BUILD_OUTPUT_DIR/TruckPTT_latest.apk"
  echo "📏 Size:  $(du -h "$BUILD_OUTPUT_DIR/$APK_NAME" | cut -f1)"
  echo "🔢 Version: $NEW_VERSION_NAME (versionCode: $NEW_VERSION_CODE)"
  echo ""
  echo "Install on device:"
  echo "  adb install -r $BUILD_OUTPUT_DIR/TruckPTT_latest.apk"
else
  echo ""
  echo "❌ APK not found at $APK_SOURCE"
  echo "   Gradle succeeded but APK was not produced."
  exit 1
fi
