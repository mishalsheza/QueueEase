// lib/socket.ts
import { io } from 'socket.io-client';
import { Platform } from 'react-native';

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

const SOCKET_URL = getSocketUrl();
console.log('Socket URL:', SOCKET_URL); // Debug log

export const socket = io(SOCKET_URL, {
  autoConnect: false,
  transports: ['websocket', 'polling'], // Add fallback
});

// Socket event handlers
socket.on('connect', () => {
  console.log('✅ Socket connected:', socket.id);
});

socket.on('disconnect', (reason) => {
  console.log('❌ Socket disconnected:', reason);
});

socket.on('connect_error', (error) => {
  console.error('❌ Socket connection error:', error.message);
});

socket.on('error', (error) => {
  console.error('❌ Socket error:', error);
});
