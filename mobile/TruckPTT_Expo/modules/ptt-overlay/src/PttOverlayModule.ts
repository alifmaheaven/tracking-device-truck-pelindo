import { Module, registerModule } from 'expo-modules-core';

// No-op stub — the real module is implemented natively on Android.
// This file ensures TypeScript compilation passes.
class PttOverlayStub extends Module {
  override async show(): Promise<void> {}
  override async hide(): Promise<void> {}
  override async updateStatus(status: string, recording: boolean): Promise<void> {}
  override async isOverlayPermissionGranted(): Promise<boolean> { return false; }
  override async requestOverlayPermission(): Promise<void> {}
  override async isVisible(): Promise<boolean> { return false; }
}

registerModule(PttOverlayStub as any);
