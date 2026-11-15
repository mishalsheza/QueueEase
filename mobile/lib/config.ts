// lib/config.ts: where the backend is. One place for the REST and socket URLs.
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { resolveApiBase } from '@/lib/apiBase';

/**
 * Backend base URL, e.g. "http://192.168.1.20:5001". Set EXPO_PUBLIC_API_URL
 * in mobile/.env (see .env.example); Expo bakes it in when the bundle is
 * built, so restart Expo after changing it. Without it, development falls back
 * to localhost (web) or the dev machine's address (phone/emulator).
 */
export const API_BASE_URL = resolveApiBase({
  // Must be written out literally: Expo only inlines process.env.EXPO_PUBLIC_*.
  envUrl: process.env.EXPO_PUBLIC_API_URL,
  isDev: __DEV__,
  platform: Platform.OS,
  hostUri: Constants.expoConfig?.hostUri,
});

export const API_URL = `${API_BASE_URL}/api`;
export const SOCKET_URL = API_BASE_URL;
