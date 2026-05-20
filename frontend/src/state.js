/**
 * Shared mutable state — imported by all modules.
 * All modules see the same object reference.
 */

const HOST = import.meta.env.VITE_HOST || '10.118.62.60';

export const state = {
  BASE_URL: `http://${HOST}:5678/webhook`,
  WS_URL: `ws://${HOST}:9090`,
  devicesData: [],
  onlineDeviceIds: [], // IDs connected via WebSocket PTT
  activeRealtimeDevices: {}, // deviceId -> last_ws_update_timestamp
  markersList: {},
  map: null,
  pttWs: null,
  pttActiveTarget: null,
  mediaRecorder: null,
  audioStream: null,
  pttNextStartTime: 0,
  audioChunks: [],
  talkingTimeouts: {},
  isNavigating: false,
  navTargetDevice: null,
  navPolylineLayer: null,
  previousAppMode: 'monitoring',
  userWatchId: null,
  userMarker: null,
  refreshInterval: 15,
  countdown: 15,
  currentModalDeviceId: null,
  currentModalTruckNumber: null,
  lastAppliedStartDate: null,
  lastAppliedEndDate: null,
  historyMapInstance: null,
  historyLayerGroup: null,
  speedChartInstance: null,
};
