#!/bin/bash

# ============================================
# Truck PTT - Production Build Script
# ============================================
# Builds a STANDALONE production APK including
# the ptt-overlay native module (floating bubble).
# ============================================

set -e

BUILD_OUTPUT_DIR="./builds"
APK_SOURCE="./android/app/build/outputs/apk/release/app-release.apk"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
APK_NAME="TruckPTT_production_${TIMESTAMP}.apk"
PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"

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

# ---- Auto increment versionCode ----
echo "🔢 Auto incrementing versionCode..."
CURRENT_VERSION_CODE=$(python3 -c "
import json
with open('app.json') as f:
    data = json.load(f)
print(data.get('expo', {}).get('android', {}).get('versionCode', 1))
")
NEW_VERSION_CODE=$((CURRENT_VERSION_CODE + 1))
python3 -c "
import json
with open('app.json', 'r') as f:
    data = json.load(f)
data['expo']['android']['versionCode'] = $NEW_VERSION_CODE
with open('app.json', 'w') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
    f.write('\n')
"
VERSION_NAME=$(python3 -c "
import json
with open('app.json') as f:
    data = json.load(f)
print(data.get('expo', {}).get('version', '1.0.0'))
")
echo "✅ versionCode: $CURRENT_VERSION_CODE → $NEW_VERSION_CODE (versionName: $VERSION_NAME)"

# ---- Prebuild: regenerate android/ with native modules linked ----
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
  echo "🔢 Version: $VERSION_NAME (versionCode: $NEW_VERSION_CODE)"
  echo ""
  echo "Install on device:"
  echo "  adb install -r $BUILD_OUTPUT_DIR/TruckPTT_latest.apk"
else
  echo ""
  echo "❌ APK not found at $APK_SOURCE"
  echo "   Gradle succeeded but APK was not produced."
  exit 1
fi
