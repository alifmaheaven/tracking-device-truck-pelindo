/**
 * Shared mutable state — imported by all modules.
 * All modules see the same object reference.
 */
export const state = {
  devicesData: [],
  onlineDeviceIds: [], // IDs connected via WebSocket PTT
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
