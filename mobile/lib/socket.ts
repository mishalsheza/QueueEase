// lib/socket.ts
import { io } from 'socket.io-client';
import { Platform } from 'react-native';
import { getAuthToken } from '@/lib/api';

const getSocketUrl = () => {
  if (__DEV__) {
    if (Platform.OS === 'web') {
      return 'http://localhost:5001';
    }
    // Use the machine IP for all mobile platforms (Simulator, Emulator, or Physical Device)
    return 'http://10.51.4.119:5001';
  } else {
    return 'https://your-production-api.com'; // Production
  }
};

/**
 * One shared connection. The server refuses it without a valid login token,
 * which is sent in the handshake (read fresh on every connect/reconnect, so a
 * new login uses the new token). Connecting and disconnecting is owned by
 * AuthProvider (lib/auth.tsx); screens use the hooks in lib/realtime.ts.
 */
export const socket = io(getSocketUrl(), {
  autoConnect: false,
  transports: ['websocket', 'polling'],
  auth: (cb) => cb({ token: getAuthToken() }),
});

socket.on('connect_error', (error) => {
  // "UNAUTHORIZED": the token was rejected. The REST 401 handler signs out.
  console.warn('Socket connection refused:', error.message);
});
