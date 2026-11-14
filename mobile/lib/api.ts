// lib/api.ts
import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const getApiUrl = () => {
  if (!__DEV__) {
    return 'https://your-production-api.com/api';
  }

  // 🌐 Web
  if (Platform.OS === 'web') {
    return 'http://localhost:5001/api';
  }

  // 📱 Mobile platforms (Simulator, Emulator, or Physical Device)
  // Using machine IP for reliable cross-platform connectivity
  return 'http://10.51.4.119:5001/api';
};

export const API_URL = getApiUrl();
console.log('🚀 API URL:', API_URL);

export const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

// Set (or clear, with null) the auth token for all requests
export const setAuthToken = (token: string | null) => {
  if (token) {
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common['Authorization'];
  }
};

export type Role = 'user' | 'admin';

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
};

export type Session = {
  token: string;
  user: SessionUser;
};

// Storage keys. 'token' and 'userRole' are the keys earlier versions used.
const KEYS = { token: 'token', role: 'userRole', user: 'userProfile' } as const;

const storage = {
  get: async (key: string): Promise<string | null> =>
    Platform.OS === 'web' ? localStorage.getItem(key) : SecureStore.getItemAsync(key),
  set: async (key: string, value: string): Promise<void> => {
    if (Platform.OS === 'web') localStorage.setItem(key, value);
    else await SecureStore.setItemAsync(key, value);
  },
  remove: async (key: string): Promise<void> => {
    if (Platform.OS === 'web') localStorage.removeItem(key);
    else await SecureStore.deleteItemAsync(key);
  },
};

const isRole = (value: unknown): value is Role => value === 'user' || value === 'admin';

/** Saves the token together with the user (and role) it belongs to. */
export const saveSession = async ({ token, user }: Session): Promise<void> => {
  await storage.set(KEYS.token, token);
  await storage.set(KEYS.role, user.role);
  await storage.set(KEYS.user, JSON.stringify(user));
};

/**
 * Returns the saved token and the last user the server confirmed for it.
 * `user` is null if no valid user was saved (e.g. older app versions that
 * saved only the token).
 */
export const loadSession = async (): Promise<{ token: string | null; user: SessionUser | null }> => {
  const token = await storage.get(KEYS.token);
  let user: SessionUser | null = null;
  try {
    const parsed = JSON.parse((await storage.get(KEYS.user)) || 'null');
    if (parsed && isRole(parsed.role)) user = parsed;
  } catch {
    user = null;
  }
  return { token, user };
};

export const clearSession = async (): Promise<void> => {
  setAuthToken(null);
  await Promise.all(Object.values(KEYS).map((k) => storage.remove(k).catch(() => {})));
};

/** Maps GET /api/auth/me to a SessionUser. Throws if the role is unknown. */
export const toSessionUser = (meUser: any): SessionUser => {
  if (!meUser || !isRole(meUser.role)) {
    throw new Error('Server returned a user without a valid role');
  }
  return {
    id: String(meUser._id ?? meUser.id),
    name: meUser.name ?? '',
    email: meUser.email ?? '',
    role: meUser.role,
  };
};
