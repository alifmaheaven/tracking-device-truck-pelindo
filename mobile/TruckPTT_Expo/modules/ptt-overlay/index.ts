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
  minimizeApp(): Promise<void>;
  // Knox AppConfig / Managed Configuration
  getManagedConfig(key: string): Promise<string | Record<string, string> | null>;
  registerRestrictionsReceiver(): Promise<boolean>;
}

const PttOverlayModule = requireNativeModule<PttOverlayInterface>('PttOverlay');
const emitter = new EventEmitter<{
  pttPressIn: () => void;
  pttPressOut: () => void;
  bubbleTapped: () => void;
  restrictionsChanged: (event: { serial_number: string }) => void;
}>(PttOverlayModule);

export type PttOverlayEvents = {
  pttPressIn: () => void;
  pttPressOut: () => void;
  bubbleTapped: () => void;
  restrictionsChanged: (event: { serial_number: string }) => void;
};

/**
 * Minimize the application (move task to back).
 */
export async function minimizeApp(): Promise<void> {
  return PttOverlayModule.minimizeApp();
}

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

/**
 * Get a managed configuration value injected by Knox Manage (AppConfig).
 * Returns the string value if found, null otherwise.
 */
export async function getManagedConfig(key: string): Promise<string | Record<string, string> | null> {
  try {
    return await PttOverlayModule.getManagedConfig(key);
  } catch (e) {
    console.log('getManagedConfig error:', e);
    return null;
  }
}

/**
 * Convenience: get the injected serial_number (Tier 1 of the auto-login chain).
 */
export async function getManagedSerialNumber(): Promise<string | null> {
  const value = await getManagedConfig('serial_number');
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return null;
}

/**
 * Subscribe to live updates when IT admin pushes a new serial_number
 * via Knox Manage console. App re-logs in automatically without restart.
 * Returns an unsubscribe function.
 */
export function onRestrictionsChanged(callback: (event: { serial_number: string }) => void) {
  return emitter.addListener('restrictionsChanged', callback);
}

/**
 * Register the native BroadcastReceiver for ACTION_APPLICATION_RESTRICTIONS_CHANGED.
 * Call once at app startup.
 */
export async function registerRestrictionsReceiver(): Promise<boolean> {
  try {
    return await PttOverlayModule.registerRestrictionsReceiver();
  } catch (e) {
    console.log('registerRestrictionsReceiver error:', e);
    return false;
  }
}
