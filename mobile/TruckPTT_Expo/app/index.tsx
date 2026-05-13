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
} from 'react-native';
import notifee, { AndroidImportance, AndroidForegroundServiceType } from '@notifee/react-native';
import AudioRecord from 'react-native-audio-record';
import { Buffer } from 'buffer';
import * as FileSystem from 'expo-file-system';
import { Audio } from 'expo-av';
import AsyncStorage from '@react-native-async-storage/async-storage';

const WEBSOCKET_URL = 'ws://43.157.242.182:9090';
const API_URL = 'https://n8n.freeat.me/webhook/device-cordinate';

const App = () => {
  const [activeDevice, setActiveDevice] = useState<{ id: string; name: string } | null>(null);
  const [pptCodeInput, setPptCodeInput] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [isConnected, setIsConnected] = useState(false);
  const [callStatus, setCallStatus] = useState('Idle');
  const [isRecording, setIsRecording] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  
  const callSessionRef = useRef({ active: false, callerId: null as string | null });

  useEffect(() => {
    requestPermissions();
    loadStoredDevice();
  }, []);

  const loadStoredDevice = async () => {
    try {
      const stored = await AsyncStorage.getItem('activeDevice');
      if (stored) {
        setActiveDevice(JSON.parse(stored));
      }
    } catch (e) {
      console.error('Failed to load stored device', e);
    }
  };

  // Hanya connect WebSockets dan Service ketika sudah login (punya activeDevice)
  useEffect(() => {
    if (activeDevice) {
      startForegroundService();
      initAudioRecord();
      connectWebSocket();
    } else {
      // Cleanup ketika logout
      if (wsRef.current) wsRef.current.close();
      notifee.stopForegroundService();
    }

    return () => {
      if (wsRef.current) wsRef.current.close();
      AudioRecord.stop();
      notifee.stopForegroundService();
    };
  }, [activeDevice]);

  const handleLogin = async () => {
    if (!pptCodeInput) {
      Alert.alert('Perhatian', 'Masukkan PPT Code terlebih dahulu.');
      return;
    }

    setIsLoggingIn(true);
    try {
      const response = await fetch(API_URL);
      const data = await response.json();
      
      const found = data.find((d: any) => d.pptCode === pptCodeInput);
      if (found) {
        const deviceData = {
          id: found.deviceId,
          name: found.serialNumber || found.deviceId
        };
        setActiveDevice(deviceData);
        await AsyncStorage.setItem('activeDevice', JSON.stringify(deviceData));
      } else {
        Alert.alert('Gagal Login', 'PPT Code tidak valid atau sudah kadaluarsa (berubah setiap 5 menit).');
      }
    } catch (err) {
      Alert.alert('Error Koneksi', 'Gagal memuat data dari server N8N.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = () => {
    Alert.alert(
      'Konfirmasi',
      'Yakin ingin keluar dan memutuskan sesi PTT?',
      [
        { text: 'Batal', style: 'cancel' },
        { 
          text: 'Keluar', 
          style: 'destructive',
          onPress: async () => {
            setActiveDevice(null);
            setPptCodeInput('');
            setIsConnected(false);
            setCallStatus('Idle');
            await AsyncStorage.removeItem('activeDevice');
          }
        }
      ]
    );
  };

  const requestPermissions = async () => {
    if (Platform.OS === 'android') {
      try {
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
      } catch (err) {
        console.warn(err);
      }
    }
  };

  const startForegroundService = async () => {
    const channelId = await notifee.createChannel({
      id: 'ptt-service',
      name: 'Push To Talk Service',
      importance: AndroidImportance.HIGH,
    });

    notifee.displayNotification({
      title: 'Truck PTT Aktif',
      body: `Login sebagai: ${activeDevice?.name}`,
      android: {
        channelId,
        asForegroundService: true,
        ongoing: true,
        smallIcon: 'ic_launcher',
        foregroundServiceTypes: [
          AndroidForegroundServiceType.MICROPHONE,
          AndroidForegroundServiceType.MEDIA_PLAYBACK,
        ],
      },
    });
  };

  const initAudioRecord = () => {
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
    console.log('Connecting to ' + WEBSOCKET_URL);
    const ws = new WebSocket(WEBSOCKET_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('WS Connected');
      setIsConnected(true);
      if (activeDevice) {
        ws.send(JSON.stringify({ type: 'register', id: activeDevice.id }));
      }
    };

    ws.onmessage = e => {
      if (e.data instanceof Blob || typeof e.data === 'object') {
         // Binary stream masuk
      } else {
        try {
          const data = JSON.parse(e.data);
          handleSignaling(data, ws);
        } catch (err) {
          console.error(err);
        }
      }
    };

    ws.onclose = () => {
      console.log('WS Disconnected');
      setIsConnected(false);
      setCallStatus('Idle');
      callSessionRef.current.active = false;
      // Auto reconnect if still logged in
      if (activeDevice) {
        setTimeout(connectWebSocket, 3000);
      }
    };

    ws.onerror = (e) => {
      console.log('WS Error: ', e.message);
    };
  };

  const handleSignaling = async (data: any, ws: WebSocket) => {
    switch (data.type) {
      case 'incomingCall':
        ws.send(JSON.stringify({ type: 'acceptCall', callerId: data.callerId }));
        callSessionRef.current = { active: true, callerId: data.callerId };
        setCallStatus('Terhubung dengan Pusat');
        break;
      case 'callAccepted':
        callSessionRef.current = { active: true, callerId: data.targetId };
        setCallStatus('Terhubung');
        break;
      case 'callEnded':
        callSessionRef.current = { active: false, callerId: null };
        setCallStatus('Idle');
        break;
      case 'error':
        Alert.alert('Error', data.message);
        break;
      case 'voiceMessage':
        if (data.audioBase64) {
          try {
            const tempUri = FileSystem.documentDirectory + 'ptt_in.webm';
            await FileSystem.writeAsStringAsync(tempUri, data.audioBase64, {
              encoding: FileSystem.EncodingType.Base64,
            });
            const { sound } = await Audio.Sound.createAsync({ uri: tempUri });
            await sound.playAsync();
          } catch (e) {
            console.log('Failed to play voice message', e);
          }
        }
        break;
    }
  };

  const handlePressIn = () => {
    if (!callSessionRef.current.active) return;
    setIsRecording(true);
    AudioRecord.start();
  };

  const handlePressOut = async () => {
    if (!isRecording) return;
    setIsRecording(false);
    await AudioRecord.stop();
  };

  // --- RENDER LOGIN SCREEN ---
  if (!activeDevice) {
    return (
      <SafeAreaView style={styles.loginContainer}>
        <View style={styles.loginBox}>
          <Text style={styles.loginTitle}>Login Truk PTT</Text>
          <Text style={styles.loginSubtitle}>Masukkan PPT Code Anda (Berubah setiap 5 menit)</Text>
          
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
            disabled={isLoggingIn}
          >
            {isLoggingIn ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.loginBtnText}>Masuk & Hubungkan</Text>
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // --- RENDER MAIN PTT SCREEN ---
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Truck PTT</Text>
          <Text style={styles.deviceId}>Truk: {activeDevice.name}</Text>
        </View>
        <TouchableOpacity style={styles.logoutBtnSmall} onPress={handleLogout}>
          <Text style={styles.logoutBtnText}>Logout</Text>
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
          {callStatus}
        </Text>
      </View>

      <View style={styles.main}>
        <TouchableOpacity
          style={[
            styles.pttButton,
            isRecording ? styles.pttActive : styles.pttIdle,
            !callSessionRef.current.active && styles.pttDisabled,
          ]}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          activeOpacity={0.8}
          disabled={!callSessionRef.current.active}
        >
          <Text style={styles.pttText}>
            {isRecording ? 'MEREKAM...' : 'TAHAN UNTUK BICARA'}
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
