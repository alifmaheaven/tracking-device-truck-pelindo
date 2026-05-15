// Stub type declarations for the native PttOverlay Expo module.
// The real implementation is in android/src/main/java/expo/modules/pttoverlay/PttOverlayModule.kt
// This file exists only to satisfy TypeScript type-checking for the module's source directory.

declare module '../index' {
  export function showOverlay(): Promise<void>;
  export function hideOverlay(): Promise<void>;
  export function updateOverlayStatus(status: string, recording: boolean): Promise<void>;
  export function isOverlayPermissionGranted(): Promise<boolean>;
  export function requestOverlayPermission(): Promise<void>;
  export function isOverlayVisible(): Promise<boolean>;
  export function onPttPressIn(callback: () => void): { remove: () => void };
  export function onPttPressOut(callback: () => void): { remove: () => void };
  export function onBubbleTapped(callback: () => void): { remove: () => void };
}
