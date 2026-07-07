import React, { useEffect, useState, useRef } from 'react';
import {
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  PermissionsAndroid,
  Platform,
  TextInput,
  Alert,
  ActivityIndicator,
  AppState,
  Linking,
  BackHandler,
} from 'react-native';
import notifee, { AndroidImportance, AndroidForegroundServiceType, AndroidCategory, EventType } from '@notifee/react-native';
import AudioRecord from 'react-native-audio-record';
import { Buffer } from 'buffer';
import * as FileSystem from 'expo-file-system';
import { Audio } from 'expo-av';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DeviceInfo from 'react-native-device-info';
import { showOverlay, hideOverlay, updateOverlayStatus, isOverlayPermissionGranted, requestOverlayPermission, onPttPressIn, onPttPressOut, onBubbleTapped, minimizeApp, getManagedSerialNumber, registerRestrictionsReceiver, onRestrictionsChanged } from '../modules/ptt-overlay';

// Polyfill Buffer jika tidak tersedia secara global
if (typeof global.Buffer === 'undefined') {
  global.Buffer = Buffer;
}

const WEBSOCKET_URL = (typeof process !== 'undefined' && process.env.EXPO_PUBLIC_WS_URL) || 'wss://ptt.teluklamong.co.id/ws';
// C6 fix: do NOT call N8N device-cordinate directly from the mobile app.
//   The old code fetched the full device list and matched serialNumber in the
//   client, which let anyone with the APK enumerate every device, SN, and
//   active PPT code. Now the app posts (serialNumber + pptCode) to a backend
//   endpoint that proxies N8N server-side and returns ONLY the matching device.
const DEVICE_LOGIN_URL = (typeof process !== 'undefined' && process.env.EXPO_PUBLIC_DEVICE_LOGIN_URL) || 'https://ptt.teluklamong.co.id/api/device/login';
const REGISTRATION_SECRET = (typeof process !== 'undefined' && process.env.EXPO_PUBLIC_REGISTRATION_SECRET) || '';

const App = () => {
  const [activeDevice, setActiveDevice] = useState<{ id: string; name: string; tags?: any[] } | null>(null);
  const [pptCodeInput, setPptCodeInput] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isAutoLoggingIn, setIsAutoLoggingIn] = useState(false);
  const [hardwareId, setHardwareId] = useState<string>('');

  const [isConnected, setIsConnected] = useState(false);
  const [callStatus, setCallStatus] = useState('Idle');
  const [isRecording, setIsRecording] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const activeDeviceRef = useRef<{ id: string; name: string; tags?: any[] } | null>(null);
  const foregroundServiceStarted = useRef(false);
  const foregroundNotificationId = useRef<string | null>(null);
  const notificationRecordingRef = useRef(false);
  const reconnectTimer = useRef<any>(null);
  const pingIntervalRef = useRef<any>(null);
  const audioRecordInitDone = useRef(false);
  const locationSubscription = useRef<any>(null);

  const callSessionRef = useRef({ active: false, callerId: null as string | null, incomingPending: false });

  useEffect(() => {
    requestPermissions();
    initializeSession();

    const backAction = () => {
      Alert.alert('Konfirmasi', 'Apakah kamu yakin ingin keluar dari aplikasi?', [
        {
          text: 'Batal',
          onPress: () => null,
          style: 'cancel',
        },
        {
          text: 'Keluar',
          onPress: () => {
            minimizeApp().catch(() => {
              // Fallback jika native minimize gagal
              BackHandler.exitApp();
            });
          },
        },
      ]);
      return true;
    };

    const backHandler = BackHandler.addEventListener(
      'hardwareBackPress',
      backAction,
    );

    // Handle foreground service notification action presses
    const unsubscribe = notifee.onForegroundEvent(async ({ type, detail }) => {
      if (type === EventType.ACTION_PRESS && detail.pressAction?.id === 'ptt-toggle') {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          console.log('Cannot PTT from notification: WS not connected');
          return;
        }
        if (!notificationRecordingRef.current) {
          // Start PTT from notification
          if (!callSessionRef.current.active) {
            // Auto-initiate call to center-main
            ws.send(JSON.stringify({ type: 'call', targetId: 'center-main' }));
            // Wait briefly for callAccepted
            await new Promise(r => setTimeout(r, 500));
          }
          if (callSessionRef.current.active) {
            // C1 fix: only start recording when a call is actually active.
            //   Previous `|| true` allowed mic to stream even before call was
            //   accepted — privacy leak. Now mic gates on callSessionRef.
            notificationRecordingRef.current = true;
            AudioRecord.start();
            updateNotificationAction(true);
            console.log('PTT recording started from notification');
          } else {
            console.log('Cannot start PTT: call not active yet');
          }
        } else {
          // Stop PTT from notification
          notificationRecordingRef.current = false;
          await AudioRecord.stop();
          updateNotificationAction(false);
          console.log('PTT recording stopped from notification');
        }
      }
      if (type === EventType.PRESS && detail.notification?.id === foregroundNotificationId.current) {
        // User tapped the notification itself — bring app to foreground
        // The fullScreenAction intent handles this natively
      }
    });

    // Floating overlay event listeners
    const unsubPressIn = onPttPressIn(() => {
      // Same logic as handlePressIn but via overlay
      if (callSessionRef.current.incomingPending && callSessionRef.current.callerId && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'acceptCall', callerId: callSessionRef.current.callerId }));
        callSessionRef.current = { active: true, callerId: callSessionRef.current.callerId, incomingPending: false };
        dismissCallNotification();
      } else if (!callSessionRef.current.active && callStatus !== 'Menghubungi Pusat...') {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'call', targetId: 'center-main' }));
          setCallStatus('Menghubungi Pusat...');
        }
      }
      if (callSessionRef.current.active) {
        notificationRecordingRef.current = true;
        AudioRecord.start();
        updateNotificationAction(true);
        updateOverlayStatus(callStatus, true).catch(() => {});
      }
    });

    const unsubPressOut = onPttPressOut(() => {
      if (notificationRecordingRef.current) {
        notificationRecordingRef.current = false;
        AudioRecord.stop().catch(() => {});
        updateNotificationAction(false);
        updateOverlayStatus(callStatus, false).catch(() => {});
      }
    });

    const unsubBubbleTapped = onBubbleTapped(() => {
      // Tapped (not dragged) — could bring app to foreground, handled by Android intent
      console.log('Floating bubble tapped');
    });

    return () => {
      backHandler.remove();
      unsubscribe();
      unsubPressIn.remove();
      unsubPressOut.remove();
      unsubBubbleTapped.remove();
    };
  }, []);

  const initializeSession = async () => {
    try {
      // ---- 4-TIER SN RESOLUTION CHAIN (no single point of failure) ----

      let sn: string | null = null;

      // TIER 1: Knox AppConfig (IT admin inject via Knox Manage console — highest priority)
      try {
        sn = await getManagedSerialNumber();
        if (sn) {
          console.log('[SN] Tier 1: Knox AppConfig SN:', sn);
          setHardwareId(sn);
          await AsyncStorage.setItem('cachedSerialNumber', sn);
        }
      } catch (e) {
        console.log('[SN] Tier 1 failed (Knox AppConfig):', e);
      }

      // TIER 2: AsyncStorage cache (last-known SN, survive reboot/Knox config delay)
      if (!sn) {
        try {
          const cached = await AsyncStorage.getItem('cachedSerialNumber');
          if (cached && cached.length > 0) {
            sn = cached;
            console.log('[SN] Tier 2: Cached SN:', sn);
            setHardwareId(sn);
          }
        } catch (e) {
          console.log('[SN] Tier 2 failed (cache):', e);
        }
      }

      // TIER 3: DeviceInfo.getSerialNumber() (hardware SN fallback)
      if (!sn) {
        try {
          const hardwareSN = await DeviceInfo.getSerialNumber();
          if (hardwareSN && hardwareSN !== 'unknown' && hardwareSN.length > 0) {
            sn = hardwareSN;
            console.log('[SN] Tier 3: Hardware SN:', sn);
            setHardwareId(sn);
            await AsyncStorage.setItem('cachedSerialNumber', sn);
          }
        } catch (e) {
          console.log('[SN] Tier 3 failed (hardware):', e);
        }
      }

      // ---- Session check ----
      const stored = await AsyncStorage.getItem('activeDevice');
      if (stored) {
        setActiveDevice(JSON.parse(stored));
        return;
      }

      // ---- Auto-login dengan SN yang resolved ----
      if (sn) {
        await attemptAutoLogin(sn);
      }
      // TIER 4: Manual PPT Code (last resort — UI tetap ditampilkan ke user)
    } catch (e) {
      console.error('Failed to initialize session', e);
    }
  };

  // ---- Live Knox AppConfig update listener ----
  // Jika IT admin push SN baru via KM console, app pickup otomatis tanpa restart
  useEffect(() => {
    let unsubscribe: { remove: () => void } | null = null;
    (async () => {
      try {
        await registerRestrictionsReceiver();
        unsubscribe = onRestrictionsChanged(async (event) => {
          const newSN = event?.serial_number;
          if (!newSN || newSN.length === 0) return;
          console.log('[Knox] Live update: new SN pushed:', newSN);
          setHardwareId(newSN);
          await AsyncStorage.setItem('cachedSerialNumber', newSN);
          // Clear session & re-login with new SN
          await AsyncStorage.removeItem('activeDevice');
          setActiveDevice(null);
          await attemptAutoLogin(newSN);
        });
      } catch (e) {
        console.log('[Knox] registerRestrictionsReceiver error:', e);
      }
    })();
    return () => {
      if (unsubscribe) unsubscribe.remove();
    };
  }, []);

  const attemptAutoLogin = async (id: string) => {
    setIsAutoLoggingIn(true);
    try {
      console.log('Attempting auto-login with Serial Number:', id);

      // C6: send the SN to backend; backend validates against N8N and returns
      //   only the matched device. We cannot pre-validate the PPT code here
      //   without it, so the device gets a tentative session — the user must
      //   enter a valid PPT code on next login screen to finalize.
      const response = await fetch(DEVICE_LOGIN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serialNumber: id, pptCode: '' }),
      });
      const data = await response.json();

      if (response.ok && data.success) {
        console.log('Auto-login successful!');
        const deviceData = {
          id: data.device.id,
          name: data.device.name,
          tags: data.device.tags || [],
        };
        setActiveDevice(deviceData);
        await AsyncStorage.setItem('activeDevice', JSON.stringify(deviceData));
        requestPermissions();
      } else {
        console.log('Auto-login failed:', data.message);
        Alert.alert(
          'Device Belum Terdaftar',
          'Serial Number device ini (' + id + ') tidak ditemukan di sistem. Silakan masukkan PPT Code untuk mendaftarkan device ini secara manual.',
          [{ text: 'OK' }]
        );
      }
    } catch (err) {
      console.log('Auto-login error:', err);
    } finally {
      setIsAutoLoggingIn(false);
    }
  };

  const loadStoredDevice = async () => {
    // Dipindahkan ke initializeSession
  };

  // Keep activeDeviceRef in sync with state
  useEffect(() => {
    activeDeviceRef.current = activeDevice;
  }, [activeDevice]);

  // Sync call status to floating overlay
  useEffect(() => {
    const status = isMuted ? 'muted' : callStatus;
    updateOverlayStatus(status, isRecording).catch(() => {});
  }, [callStatus, isRecording, isMuted]);

  // Hanya connect WebSockets dan Service ketika sudah login (punya activeDevice)
  useEffect(() => {
    if (activeDevice) {
      // Enable background audio playback
      Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        staysActiveInBackground: true,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      }).catch(e => console.log('Audio mode error:', e));

      initAudioRecord();
      connectWebSocket();

      // Initialize floating overlay
      (async () => {
        const granted = await isOverlayPermissionGranted();
        if (!granted) {
          // Hanya minta jika aplikasi aktif
          if (AppState.currentState === 'active') {
            await requestOverlayPermission();
          }
        }
      })();
    } else {
      // Cleanup ketika logout
      hideOverlay().catch(() => {});
      stopLocationTracking();
      // C8 fix: stop foreground service BEFORE clearing the started flag,
      //   and only clear the flag after the stop resolves. Otherwise a parallel
      //   activeDevice state flip can re-enter startForegroundService with the
      //   flag already false but the notification still alive → orphaned
      //   service that never gets a stop().
      const wasStarted = foregroundServiceStarted.current;
      foregroundServiceStarted.current = false;
      if (wasStarted) {
        notifee.stopForegroundService().catch(() => {});
      }
      if (reconnectTimer.current) { clearTimeout(reconnectTimer.current); reconnectTimer.current = null; }
      if (pingIntervalRef.current) { clearInterval(pingIntervalRef.current); pingIntervalRef.current = null; }
      if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); wsRef.current = null; }
    }

    return () => {
      // C8 fix: also stop service in unmount path; clear started flag inside
      //   the resolve to prevent re-entry.
      const wasStarted = foregroundServiceStarted.current;
      foregroundServiceStarted.current = false;
      if (wasStarted) {
        notifee.stopForegroundService().catch(() => {});
      }
      if (reconnectTimer.current) { clearTimeout(reconnectTimer.current); reconnectTimer.current = null; }
      if (pingIntervalRef.current) { clearInterval(pingIntervalRef.current); pingIntervalRef.current = null; }
      if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); wsRef.current = null; }
      stopLocationTracking();
      audioRecordInitDone.current = false;
      AudioRecord.stop().catch(() => {});
    };
  }, [activeDevice]);

  // Handle app foreground/background transitions
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      console.log('AppState changed to:', nextAppState);
      if (nextAppState === 'active' && activeDeviceRef.current) {
        // App came to foreground — hide overlay, aggressively reconnect
        hideOverlay().catch(() => {});
        
        // Start foreground service only when active and after a small delay to ensure stability
        if (!foregroundServiceStarted.current) {
          setTimeout(() => {
            if (AppState.currentState === 'active') {
              startForegroundService();
            }
          }, 2000);
        }

        const ws = wsRef.current;
        if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
          console.log('App returned to foreground, reconnecting WS...');
          if (reconnectTimer.current) { clearTimeout(reconnectTimer.current); reconnectTimer.current = null; }
          connectWebSocket();
        }
      }
      if (nextAppState === 'background' && activeDeviceRef.current) {
        // App going to background — show floating bubble, send ping
        console.log('App backgrounded, handling background tasks...');
        isOverlayPermissionGranted().then(granted => {
          if (granted) {
            // Beri sedikit jeda agar transisi activity selesai
            setTimeout(() => {
              // Hanya tampilkan jika masih di background
              if (AppState.currentState === 'background') {
                showOverlay().catch(err => console.log('Failed to show overlay:', err));
              }
            }, 1000);
          }
        });
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
          console.log('Keepalive ping sent');
        }
      }
    });

    // Handle initial state if it starts as active
    if (AppState.currentState === 'active' && activeDeviceRef.current && !foregroundServiceStarted.current) {
      setTimeout(() => {
        if (AppState.currentState === 'active') {
          startForegroundService();
        }
      }, 3000);
    }

    return () => subscription.remove();
  }, []);

  const handleLogin = async () => {
    if (!pptCodeInput) {
      Alert.alert('Perhatian', 'Masukkan PPT Code terlebih dahulu.');
      return;
    }

    setIsLoggingIn(true);
    try {
      // C6: same backend endpoint as auto-login, this time with a real PPT code.
      //   Server validates SN + code pair against N8N and returns the device.
      const response = await fetch(DEVICE_LOGIN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serialNumber: hardwareId, pptCode: pptCodeInput }),
      });
      const data = await response.json();

      if (response.ok && data.success) {
        const deviceData = {
          id: data.device.id,
          name: data.device.name,
          tags: data.device.tags || [],
        };
        setActiveDevice(deviceData);
        await AsyncStorage.setItem('activeDevice', JSON.stringify(deviceData));
        // Request permissions after successful login for the first time
        requestPermissions();
      } else {
        Alert.alert('Gagal Login', data.message || 'PPT Code tidak valid atau sudah kadaluarsa.');
      }
    } catch (err) {
      Alert.alert('Error Koneksi', 'Gagal memuat data dari server.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Removed handleLogout — M01 P3: logout harus dari pusat, tombol UI jadi Minimize.
  // Fungsi clear session tetap dipanggil di handler WS 'forceLogout' (lihat onmessage switch).

  const requestPermissions = async () => {
    if (Platform.OS === 'android') {
      try {
        // Request location permissions
        const { status: foregroundStatus } = await Location.requestForegroundPermissionsAsync();
        if (foregroundStatus !== 'granted') {
          console.warn('Foreground location permission denied');
        }
        
        // Hanya minta background jika foreground diberikan
        if (foregroundStatus === 'granted') {
          const { status: backgroundStatus } = await Location.requestBackgroundPermissionsAsync();
          if (backgroundStatus !== 'granted') {
            console.warn('Background location permission denied');
          }
        }

        // Request microphone permission
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          {
            title: 'Izin Microphone',
            message: 'Aplikasi PTT membutuhkan akses microphone untuk berbicara.',
            buttonNeutral: 'Nanti',
            buttonNegative: 'Batal',
            buttonPositive: 'OK',
          },
        );
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          console.warn('Microphone permission denied');
        }

        // Request notification permission (Android 13+)
        await notifee.requestPermission();

        // Request battery optimization exemption ONLY IF needed (manually for now to avoid loops)
        // We will only do this if specifically requested or on first setup
      } catch (err) {
        console.warn(err);
      }
    }
  };

  const startLocationTracking = async () => {
    try {
      // Clean up previous subscription if exists
      if (locationSubscription.current) {
        locationSubscription.current.remove();
        locationSubscription.current = null;
      }

      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') return;

      locationSubscription.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 2000, // Update every 2 seconds
          distanceInterval: 2, // Or every 2 meters
        },
        (location) => {
          const ws = wsRef.current;
          if (ws && ws.readyState === WebSocket.OPEN && activeDeviceRef.current) {
            ws.send(JSON.stringify({
              type: 'locationUpdate',
              deviceId: activeDeviceRef.current.id,
              coordinates: [location.coords.latitude, location.coords.longitude]
            }));
            console.log('Location sent via WS:', [location.coords.latitude, location.coords.longitude]);
          }
        }
      );
    } catch (e) {
      console.log('Failed to start location tracking:', e);
    }
  };

  const stopLocationTracking = () => {
    if (locationSubscription.current) {
      locationSubscription.current.remove();
      locationSubscription.current = null;
    }
  };

  const startForegroundService = async () => {
    try {
      // C2 fix: allow start in any state. The whole point of the foreground service
      //   is to keep mic/WS alive when the app is backgrounded (overlay-PTT, lock
      //   screen, doze). The previous guard meant the service never started in
      //   exactly the situations we need it.
      if (foregroundServiceStarted.current) {
        console.log('Foreground service already started, skipping.');
        return;
      }

      const channelId = await notifee.createChannel({
        id: 'ptt-service',
        name: 'Push To Talk Service',
        importance: AndroidImportance.HIGH,
      });

      const id = await notifee.displayNotification({
        title: 'Truck PTT Aktif',
        body: `Login sebagai: ${activeDevice?.name}`,
        android: {
          channelId,
          asForegroundService: true,
          ongoing: true,
          smallIcon: 'ic_launcher',
          actions: [
            {
              title: 'Push To Talk',
              pressAction: { id: 'ptt-toggle' },
            },
          ],
        },
      });
      foregroundNotificationId.current = id;
      foregroundServiceStarted.current = true;
      console.log('Foreground service started successfully');
    } catch (e) {
      console.log('Foreground service failed (non-fatal):', e);
      foregroundServiceStarted.current = false;
    }
  };

  const updateNotificationAction = async (recording: boolean) => {
    if (!foregroundNotificationId.current) return;
    try {
      const channelId = await notifee.createChannel({
        id: 'ptt-service',
        name: 'Push To Talk Service',
        importance: AndroidImportance.HIGH,
      });
      await notifee.displayNotification({
        id: foregroundNotificationId.current,
        title: recording ? 'PTT - Berbicara' : 'Truck PTT Aktif',
        body: recording ? 'Merekam...' : `Login sebagai: ${activeDeviceRef.current?.name}`,
        android: {
          channelId,
          asForegroundService: true,
          ongoing: true,
          smallIcon: 'ic_launcher',
          actions: [
            {
              title: recording ? 'Stop PTT' : 'Push To Talk',
              pressAction: { id: 'ptt-toggle' },
            },
          ],
        },
      });
    } catch (e) {
      console.log('Failed to update notification:', e);
    }
  };

  const initAudioRecord = () => {
    if (audioRecordInitDone.current) return;
    audioRecordInitDone.current = true;

    const options = {
      sampleRate: 16000,
      channels: 1,
      bitsPerSample: 16,
      audioSource: 6, // VOICE_RECOGNITION
      wavFile: 'temp_ptt.wav',
    };
    AudioRecord.init(options);
    
    AudioRecord.on('data', data => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && callSessionRef.current.active) {
        const buffer = Buffer.from(data, 'base64');
        wsRef.current.send(buffer);
      }
    });
  };

  const connectWebSocket = () => {
    // Prevent duplicate connections
    if (wsRef.current && (wsRef.current.readyState === WebSocket.CONNECTING || wsRef.current.readyState === WebSocket.OPEN)) {
      console.log('WS already connected or connecting, skip');
      return;
    }

    // Clear any stale timers from previous connection
    if (reconnectTimer.current) { clearTimeout(reconnectTimer.current); reconnectTimer.current = null; }
    if (pingIntervalRef.current) { clearInterval(pingIntervalRef.current); pingIntervalRef.current = null; }

    console.log('Connecting to ' + WEBSOCKET_URL);
    const ws = new WebSocket(WEBSOCKET_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('WS Connected');
      setIsConnected(true);
      // Start client-side ping to keep connection alive through Android doze
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 20000);
      // Use ref to avoid stale closure on reconnect
      const device = activeDeviceRef.current;
      if (device) {
        ws.send(JSON.stringify({ 
          type: 'register', 
          id: device.id,
          secret: REGISTRATION_SECRET 
        }));
        console.log('Registered as:', device.id);
        
        // Start location tracking after registration
        startLocationTracking();
      } else {
        console.log('WS Connected but no active device to register');
      }
    };

    ws.onmessage = e => {
      if (e.data instanceof Blob || typeof e.data === 'object') {
        // Binary PCM audio from server (16-bit, 16000Hz, mono)
        handleBinaryAudio(e.data);
      } else {
        try {
          const data = JSON.parse(e.data);
          handleSignaling(data, ws);
        } catch (err) {
          console.error(err);
        }
      }
    };

    ws.onclose = (event) => {
      console.log('WS Disconnected', event?.code || '');
      setIsConnected(false);
      // Clean up ping interval
      if (pingIntervalRef.current) { clearInterval(pingIntervalRef.current); pingIntervalRef.current = null; }
      // M01 P4: server force-logout pakai close code 4001 — jangan reconnect
      if (event?.code === 4001) {
        console.log('WS closed by server (force-logout). Skipping reconnect.');
        return;
      }
      // Auto reconnect if still logged in
      if (activeDeviceRef.current) {
        if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
        reconnectTimer.current = setTimeout(connectWebSocket, 5000);
      }
    };

    ws.onerror = (e) => {
      console.log('WS Error: ', JSON.stringify(e));
    };
  };

  const showIncomingCallNotification = async (callerId: string) => {
    try {
      const channelId = await notifee.createChannel({
        id: 'incoming-calls',
        name: 'Panggilan Masuk',
        importance: AndroidImportance.HIGH,
        sound: 'default',
        vibration: true,
      });

      await notifee.displayNotification({
        id: 'incoming-call',
        title: '📞 Panggilan Masuk dari Pusat',
        body: 'Ketuk untuk membuka PTT',
        android: {
          channelId,
          category: AndroidCategory.CALL,
          importance: AndroidImportance.HIGH,
          sound: 'default',
          vibrationPattern: [300, 500, 300, 500],
          fullScreenAction: {
            id: 'default',
          },
          pressAction: {
            id: 'default',
          },
          autoCancel: false,
          ongoing: true,
        },
      });
    } catch (e) {
      console.log('Failed to show incoming call notification:', e);
    }
  };

  const dismissCallNotification = async () => {
    try {
      await notifee.cancelNotification('incoming-call');
    } catch (e) {
      // ignore
    }
  };

  const audioQueue = useRef<Blob[]>([]);
  const isAudioPlaying = useRef(false);

  const handleBinaryAudio = async (blob: Blob) => {
    audioQueue.current.push(blob);
    processAudioQueue();
  };

  const processAudioQueue = async () => {
    if (isAudioPlaying.current || audioQueue.current.length === 0) return;
    
    isAudioPlaying.current = true;
    const blob = audioQueue.current.shift();
    
    if (blob) {
      try {
        let arrayBuffer: ArrayBuffer;
        if (typeof blob.arrayBuffer === 'function') {
          arrayBuffer = await blob.arrayBuffer();
        } else {
          arrayBuffer = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as ArrayBuffer);
            reader.onerror = reject;
            reader.readAsArrayBuffer(blob);
          });
        }
        
        const int16Array = new Int16Array(arrayBuffer);
        const wavBuffer = buildWav(int16Array, 16000);
        const tempUri = FileSystem.documentDirectory + 'ptt_stream_' + Date.now() + '.wav';
        
        await FileSystem.writeAsStringAsync(tempUri, Buffer.from(wavBuffer).toString('base64'), {
          encoding: FileSystem.EncodingType?.Base64 || 'base64',
        });

        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          staysActiveInBackground: true,
          playsInSilentModeIOS: true,
          shouldDuckAndroid: true,
          playThroughEarpieceAndroid: false,
        });

        const { sound } = await Audio.Sound.createAsync({ uri: tempUri });
        await sound.playAsync();

        sound.setOnPlaybackStatusUpdate(async (status: any) => {
          if (status.didJustFinish) {
            await sound.unloadAsync();
            // Hapus file sementara setelah selesai diputar
            await FileSystem.deleteAsync(tempUri).catch(() => {});
            isAudioPlaying.current = false;
            processAudioQueue();
          }
        });
      } catch (e) {
        console.log('Failed to play binary audio:', e);
        isAudioPlaying.current = false;
        processAudioQueue();
      }
    } else {
      isAudioPlaying.current = false;
    }
  };

  const buildWav = (samples: Int16Array, sampleRate: number): ArrayBuffer => {
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * bitsPerSample / 8;
    const blockAlign = numChannels * bitsPerSample / 8;
    const dataSize = samples.length * (bitsPerSample / 8);
    const headerSize = 44;
    const buffer = new ArrayBuffer(headerSize + dataSize);
    const view = new DataView(buffer);
    // RIFF header
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(view, 8, 'WAVE');
    // fmt chunk
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    // data chunk
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);
    // PCM samples
    for (let i = 0; i < samples.length; i++) {
      view.setInt16(headerSize + i * 2, samples[i], true);
    }
    return buffer;
  };

  const writeString = (view: DataView, offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  const handleSignaling = async (data: any, ws: WebSocket) => {
    switch (data.type) {
      case 'incomingCall':
        // SECURITY (M02 H6): only auto-answer if BOTH starts with 'center' AND server
        //   tagged this caller as trustedCenter (i.e. authenticated HTTP session).
        //   Prevents attacker from spoofing 'center-evil' id to covertly open mic.
        const isTrustedCenter = data.callerId && data.callerId.startsWith('center') && data.trustedCenter === true;
        if (isTrustedCenter) {
          // AUTO-ANSWER for verified Center Calls
          console.log(`Auto-answering call from verified Center (${data.callerId})...`);
          ws.send(JSON.stringify({ type: 'acceptCall', callerId: data.callerId }));
          callSessionRef.current = { active: true, callerId: data.callerId, incomingPending: false };
          setCallStatus('Terhubung dengan Pusat');
        } else {
          // Manual answer for others (unverified centers fall back to manual as a safety net)
          await showIncomingCallNotification(data.callerId);
          callSessionRef.current = { active: false, callerId: data.callerId, incomingPending: true };
          setCallStatus('Panggilan Masuk... Tekan untuk Jawab');
        }
        break;
      case 'callAccepted':
        await dismissCallNotification();
        callSessionRef.current = { active: true, callerId: data.targetId, incomingPending: false };
        setCallStatus('Terhubung');
        break;
      case 'callEnded':
        await dismissCallNotification();
        if (notificationRecordingRef.current) {
          notificationRecordingRef.current = false;
          await AudioRecord.stop().catch(() => {});
          updateNotificationAction(false);
        }
        setIsRecording(false);
        callSessionRef.current = { active: false, callerId: null, incomingPending: false };
        setCallStatus('Idle');
        break;
      case 'error':
        await dismissCallNotification();
        setCallStatus('Idle');
        callSessionRef.current = { active: false, callerId: null, incomingPending: false };
        setIsRecording(false);
        AudioRecord.stop().catch(() => {});
        if (data.code === 'CENTER_OFFLINE') {
           Alert.alert('Pusat Offline', data.message);
        } else {
           Alert.alert('Error', data.message);
        }
        break;
      case 'voiceMessage':
        if (data.audioBase64) {
          try {
            const dataUri = `data:audio/wav;base64,${data.audioBase64}`;
            await Audio.setAudioModeAsync({
              allowsRecordingIOS: false,
              staysActiveInBackground: true,
              playsInSilentModeIOS: true,
              shouldDuckAndroid: true,
              playThroughEarpieceAndroid: false,
            });
            const { sound } = await Audio.Sound.createAsync({ uri: dataUri });
            await sound.playAsync();
            sound.setOnPlaybackStatusUpdate((status: any) => {
              if (status.didJustFinish) sound.unloadAsync();
            });
          } catch (e) {
            console.log('Failed to play voice message:', e);
          }
        }
        break;
      case 'muteStatus':
        setIsMuted(data.muted);
        if (data.muted) {
          // Update floating bubble to muted color
          updateOverlayStatus('muted', false).catch(() => {});
          // If muted while in a call, end the call on our side
          if (callSessionRef.current.active) {
            callSessionRef.current = { active: false, callerId: null, incomingPending: false };
            setCallStatus('Idle');
            setIsRecording(false);
            AudioRecord.stop().catch(() => {});
          }
        } else {
          // Restore normal bubble color when unmuted
          updateOverlayStatus(callStatus, isRecording).catch(() => {});
        }
        break;
      case 'forceLogout':
        // M01 P4: pusat (admin) force-logout device ini. Clear session + kembali ke login.
        console.log('[WS] Force logout from center:', data.reason || 'no reason');
        // Stop any active PTT/recording
        if (notificationRecordingRef.current) {
          notificationRecordingRef.current = false;
          await AudioRecord.stop().catch(() => {});
          updateNotificationAction(false);
        }
        setIsRecording(false);
        callSessionRef.current = { active: false, callerId: null, incomingPending: false };
        // Clear session
        setActiveDevice(null);
        setPptCodeInput('');
        setIsConnected(false);
        setCallStatus('Idle');
        await AsyncStorage.removeItem('activeDevice');
        // Close WS (server will close with 4001)
        if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); wsRef.current = null; }
        // Stop foreground service
        try { await notifee.stopForegroundService(); } catch (e) { console.log('stopForegroundService err:', e); }
        Alert.alert('Sesi diakhiri', 'Sesi Anda telah diakhiri oleh pusat. Silakan login ulang.');
        break;
    }
  };

  const handlePressIn = () => {
    // If muted, don't allow any call action
    if (isMuted) {
      Alert.alert('Device Di-Mute', 'Anda sedang di-mute oleh Command Center. Tidak dapat melakukan panggilan.');
      return;
    }

    // If incoming call is pending, accept it instead of placing a new call
    if (callSessionRef.current.incomingPending && callSessionRef.current.callerId) {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'acceptCall', callerId: callSessionRef.current.callerId }));
        callSessionRef.current = { active: true, callerId: callSessionRef.current.callerId, incomingPending: false };
        setCallStatus('Terhubung dengan Pusat');
        dismissCallNotification();
      }
      return;
    }

    if (!callSessionRef.current.active) {
      // Guard against duplicate call requests when already calling
      if (callStatus === 'Menghubungi Pusat...') return;
      if (wsRef.current && isConnected) {
        wsRef.current.send(JSON.stringify({ type: 'call', targetId: 'center-main' }));
        setCallStatus('Menghubungi Pusat...');
      }
      return;
    }
    setIsRecording(true);
    notificationRecordingRef.current = true;
    AudioRecord.start();
    updateNotificationAction(true);
  };

  const handlePressOut = async () => {
    if (!isRecording) return;
    setIsRecording(false);
    notificationRecordingRef.current = false;
    await AudioRecord.stop();
    updateNotificationAction(false);
  };

  // --- RENDER LOGIN SCREEN ---
  if (!activeDevice) {
    return (
      <SafeAreaView style={styles.loginContainer}>
        <View style={styles.loginBox}>
          <Text style={styles.loginTitle}>Login Truk PTT</Text>
          <Text style={styles.loginSubtitle}>Masukkan PPT Code Anda yang Aktif</Text>
          
          <TextInput
            style={styles.input}
            placeholder="Contoh: X7Y8Z9"
            placeholderTextColor="#64748b"
            value={pptCodeInput}
            onChangeText={setPptCodeInput}
            autoCapitalize="characters"
          />
          
          <TouchableOpacity 
            style={styles.loginBtn}
            onPress={handleLogin}
            disabled={isLoggingIn || isAutoLoggingIn}
          >
            {isLoggingIn || isAutoLoggingIn ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.loginBtnText}>Masuk & Hubungkan</Text>
            )}
          </TouchableOpacity>

          <View style={{ marginTop: 30, borderTopWidth: 1, borderTopColor: '#334155', paddingTop: 20, alignItems: 'center' }}>
            <Text style={{ color: '#94a3b8', fontSize: 12 }}>ID Perangkat Anda:</Text>
            <Text style={{ color: '#fff', fontSize: 14, fontWeight: 'bold', marginTop: 5 }}>{hardwareId || 'Mencari ID...'}</Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // --- RENDER MAIN PTT SCREEN ---
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Truck PTT</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
            <Text style={styles.deviceId}>Truk: {activeDevice.name}</Text>
            {activeDevice.tags?.map((tag, idx) => (
              <View key={idx} style={styles.tagBadge}>
                <Text style={styles.tagText}>{tag.tagValue || tag}</Text>
              </View>
            ))}
          </View>
        </View>
        <TouchableOpacity style={styles.logoutBtnSmall} onPress={() => minimizeApp()}>
          <Text style={styles.logoutBtnText}>Minimize</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.statusContainer}>
        <View style={[styles.statusDot, isConnected ? styles.bgGreen : styles.bgRed]} />
        <Text style={styles.statusText}>
          {isConnected ? 'Terhubung ke Relay Pusat' : 'Terputus... Menghubungkan ulang'}
        </Text>
      </View>

      <View style={styles.callBox}>
        <Text style={styles.callStatusLabel}>Status Panggilan:</Text>
        <Text style={[styles.callStatusValue, callSessionRef.current.active && styles.textBlue]}>
          {isMuted ? '🔇 Di-Mute oleh Pusat' : callStatus}
        </Text>
      </View>

      <View style={styles.main}>
        <TouchableOpacity
          style={[
            styles.pttButton,
            isMuted ? styles.pttMuted : (isRecording ? styles.pttActive : styles.pttIdle),
            (!callSessionRef.current.active && !isMuted) || isMuted ? styles.pttDisabled : null,
          ]}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          activeOpacity={0.8}
        >
          <Text style={styles.pttText}>
            {isMuted ? '🔇 MUTED' : (isRecording ? 'MEREKAM...' : 'TAHAN UNTUK BICARA')}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.footer}>
        {callSessionRef.current.active && (
          <TouchableOpacity 
            style={styles.endBtn} 
            onPress={() => {
              if (wsRef.current) wsRef.current.send(JSON.stringify({ type: 'endCall' }));
              callSessionRef.current.active = false;
              setCallStatus('Idle');
            }}
          >
            <Text style={styles.endBtnText}>Akhiri Panggilan</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  // Login Styles
  loginContainer: {
    flex: 1,
    backgroundColor: '#0f172a',
    justifyContent: 'center',
    padding: 20,
  },
  loginBox: {
    backgroundColor: '#1e293b',
    padding: 30,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  loginTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: 10,
  },
  loginSubtitle: {
    color: '#94a3b8',
    textAlign: 'center',
    marginBottom: 30,
    fontSize: 14,
  },
  input: {
    backgroundColor: '#0f172a',
    color: '#ffffff',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    padding: 15,
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 20,
    fontWeight: 'bold',
    letterSpacing: 2,
  },
  loginBtn: {
    backgroundColor: '#3b82f6',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
  },
  loginBtnText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  
  // Main PTT Styles
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  header: {
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 4,
  },
  deviceId: {
    fontSize: 14,
    color: '#94a3b8',
    backgroundColor: '#1e293b',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  tagBadge: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#3b82f6',
  },
  tagText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
  logoutBtnSmall: {
    backgroundColor: '#ef4444',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  logoutBtnText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 12,
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    backgroundColor: '#1e293b',
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 10,
  },
  bgGreen: { backgroundColor: '#10b981' },
  bgRed: { backgroundColor: '#ef4444' },
  statusText: {
    color: '#cbd5e1',
    fontSize: 14,
  },
  callBox: {
    margin: 20,
    padding: 20,
    backgroundColor: '#1e293b',
    borderRadius: 12,
    alignItems: 'center',
  },
  callStatusLabel: {
    color: '#94a3b8',
    fontSize: 14,
    marginBottom: 5,
  },
  callStatusValue: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  textBlue: { color: '#3b82f6' },
  main: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pttButton: {
    width: 250,
    height: 250,
    borderRadius: 125,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  pttIdle: {
    backgroundColor: '#1e293b',
    borderColor: '#334155',
  },
  pttActive: {
    backgroundColor: '#ef4444',
    borderColor: '#fca5a5',
  },
  pttDisabled: {
    opacity: 0.5,
  },
  pttMuted: {
    backgroundColor: '#64748b',
    borderColor: '#475569',
  },
  pttText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  footer: {
    padding: 20,
    alignItems: 'center',
  },
  endBtn: {
    backgroundColor: '#ef4444',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    width: '100%',
    alignItems: 'center',
  },
  endBtnText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 16,
  },
});

export default App;
