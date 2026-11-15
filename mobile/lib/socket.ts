// lib/socket.ts
import { io } from 'socket.io-client';
import { getAuthToken } from '@/lib/api';
import { SOCKET_URL } from '@/lib/config';

/**
 * One shared connection. The server refuses it without a valid login token,
 * which is sent in the handshake (read fresh on every connect/reconnect, so a
 * new login uses the new token). Connecting and disconnecting is owned by
 * AuthProvider (lib/auth.tsx); screens use the hooks in lib/realtime.ts.
 */
export const socket = io(SOCKET_URL, {
  autoConnect: false,
  transports: ['websocket', 'polling'],
  auth: (cb) => cb({ token: getAuthToken() }),
});

socket.on('connect_error', (error) => {
  // "UNAUTHORIZED": the token was rejected. The REST 401 handler signs out.
  console.warn('Socket connection refused:', error.message);
});
