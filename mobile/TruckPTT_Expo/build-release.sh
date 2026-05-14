#!/bin/bash

# ============================================
# Truck PTT - Release Build Script
# ============================================
# Builds the release APK, copies it to the
# builds/ folder, and cleans previous builds.
# ============================================

BUILD_OUTPUT_DIR="./builds"
APK_SOURCE="./android/app/build/outputs/apk/release/app-release.apk"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
APK_NAME="TruckPTT_release_${TIMESTAMP}.apk"

echo "🧹 Cleaning previous builds..."
rm -rf "$BUILD_OUTPUT_DIR"
mkdir -p "$BUILD_OUTPUT_DIR"

echo "🔨 Starting release build..."
npx expo run:android --variant release --no-install

BUILD_EXIT_CODE=$?

if [ $BUILD_EXIT_CODE -eq 0 ] && [ -f "$APK_SOURCE" ]; then
    cp "$APK_SOURCE" "$BUILD_OUTPUT_DIR/$APK_NAME"
    
    # Also keep a copy with a fixed name for easy access
    cp "$APK_SOURCE" "$BUILD_OUTPUT_DIR/TruckPTT_latest.apk"
    
    echo ""
    echo "✅ Build successful!"
    echo "📦 APK saved to: $BUILD_OUTPUT_DIR/$APK_NAME"
    echo "📦 Latest copy:  $BUILD_OUTPUT_DIR/TruckPTT_latest.apk"
    echo "📏 Size: $(du -h "$BUILD_OUTPUT_DIR/$APK_NAME" | cut -f1)"
    echo ""
    echo "To install on device:"
    echo "  adb install -r $BUILD_OUTPUT_DIR/TruckPTT_latest.apk"
else
    echo ""
    echo "❌ Build failed! Exit code: $BUILD_EXIT_CODE"
    exit 1
fi
