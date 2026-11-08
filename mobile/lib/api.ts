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

// Set auth token for all requests
export const setAuthToken = (token: string) => {
  if (token) {
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common['Authorization'];
  }
};

// Storage helpers with web fallback
export const saveToken = async (token: string) => {
  if (Platform.OS === 'web') {
    localStorage.setItem('token', token);
  } else {
    await SecureStore.setItemAsync('token', token);
  }
};

export const loadToken = async (): Promise<string | null> => {
  if (Platform.OS === 'web') {
    return localStorage.getItem('token');
  } else {
    return await SecureStore.getItemAsync('token');
  }
};


export const saveUserRole = async (role: string) => {
  if (Platform.OS === 'web') {
    localStorage.setItem('userRole', role);
  } else {
    await SecureStore.setItemAsync('userRole', role);
  }
};

export const loadUserRole = async (): Promise<string | null> => {
  if (Platform.OS === 'web') {
    return localStorage.getItem('userRole');
  } else {
    return await SecureStore.getItemAsync('userRole');
  }
};

export const logout = async () => {
  try {
    if (Platform.OS === 'web') {
      localStorage.removeItem('token');
      localStorage.removeItem('userRole');
    } else {
      await SecureStore.deleteItemAsync('token');
      await SecureStore.deleteItemAsync('userRole');
    }
    delete api.defaults.headers.common.Authorization;
  } catch (error) {
    console.error('Error logging out:', error);
  }
};
