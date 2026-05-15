import { requireNativeModule, EventEmitter } from 'expo-modules-core';
import { NativeModule } from 'expo-modules-core/types';

// Define the native module interface
interface PttOverlayInterface extends NativeModule {
  show(): Promise<void>;
  hide(): Promise<void>;
  updateStatus(status: string, recording: boolean): Promise<void>;
  isOverlayPermissionGranted(): Promise<boolean>;
  requestOverlayPermission(): Promise<void>;
  isVisible(): Promise<boolean>;
}

const PttOverlayModule = requireNativeModule<PttOverlayInterface>('PttOverlay');
const emitter = new EventEmitter<{ pttPressIn: () => void; pttPressOut: () => void; bubbleTapped: () => void }>(PttOverlayModule);

export type PttOverlayEvents = {
  pttPressIn: () => void;
  pttPressOut: () => void;
  bubbleTapped: () => void;
};

/**
 * Show the floating PTT bubble overlay.
 * Requires SYSTEM_ALERT_WINDOW permission on Android.
 */
export async function showOverlay(): Promise<void> {
  return PttOverlayModule.show();
}

/**
 * Hide the floating PTT bubble overlay.
 */
export async function hideOverlay(): Promise<void> {
  return PttOverlayModule.hide();
}

/**
 * Update the floating bubble status text and recording indicator.
 */
export async function updateOverlayStatus(status: string, recording: boolean): Promise<void> {
  return PttOverlayModule.updateStatus(status, recording);
}

/**
 * Check if SYSTEM_ALERT_WINDOW permission is granted.
 */
export async function isOverlayPermissionGranted(): Promise<boolean> {
  return PttOverlayModule.isOverlayPermissionGranted();
}

/**
 * Open the system settings to request overlay permission.
 */
export async function requestOverlayPermission(): Promise<void> {
  return PttOverlayModule.requestOverlayPermission();
}

/**
 * Check if the overlay is currently visible.
 */
export async function isOverlayVisible(): Promise<boolean> {
  return PttOverlayModule.isVisible();
}

/**
 * Listen for PTT press events from the floating bubble.
 * Returns an unsubscribe function.
 */
export function onPttPressIn(callback: () => void) {
  return emitter.addListener('pttPressIn', callback);
}

export function onPttPressOut(callback: () => void) {
  return emitter.addListener('pttPressOut', callback);
}

export function onBubbleTapped(callback: () => void) {
  return emitter.addListener('bubbleTapped', callback);
}
