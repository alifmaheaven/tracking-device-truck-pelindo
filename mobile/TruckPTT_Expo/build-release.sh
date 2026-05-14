#!/bin/bash

# ============================================
# Truck PTT - Production Build Script
# ============================================
# Builds a STANDALONE production APK without
# expo-dev-client so the app works completely
# independently without Metro bundler.
# ============================================

BUILD_OUTPUT_DIR="./builds"
APK_SOURCE="./android/app/build/outputs/apk/release/app-release.apk"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
APK_NAME="TruckPTT_production_${TIMESTAMP}.apk"

echo "🧹 Cleaning previous builds..."
rm -rf "$BUILD_OUTPUT_DIR"
mkdir -p "$BUILD_OUTPUT_DIR"

echo "📦 Creating production JS bundle..."
npx react-native bundle \
  --platform android \
  --dev false \
  --entry-file node_modules/expo-router/entry.js \
  --bundle-output android/app/src/main/assets/index.android.bundle \
  --assets-dest android/app/src/main/res/

echo "🔨 Building release APK..."
cd android && ./gradlew assembleRelease 2>&1 | tail -10
cd ..

BUILD_EXIT_CODE=$?

if [ -f "$APK_SOURCE" ]; then
    cp "$APK_SOURCE" "$BUILD_OUTPUT_DIR/$APK_NAME"
    cp "$APK_SOURCE" "$BUILD_OUTPUT_DIR/TruckPTT_latest.apk"
    
    echo ""
    echo "✅ Production build successful!"
    echo "📦 APK saved to: $BUILD_OUTPUT_DIR/$APK_NAME"
    echo "📦 Latest copy:  $BUILD_OUTPUT_DIR/TruckPTT_latest.apk"
    echo "📏 Size: $(du -h "$BUILD_OUTPUT_DIR/$APK_NAME" | cut -f1)"
    echo ""
    echo "To install on device:"
    echo "  adb install -r $BUILD_OUTPUT_DIR/TruckPTT_latest.apk"
else
    echo ""
    echo "❌ Build failed!"
    exit 1
fi
