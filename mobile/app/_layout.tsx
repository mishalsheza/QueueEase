// app/_layout.tsx
import { Stack, router, useSegments } from "expo-router";
import { useEffect, useState } from "react";
import { loadToken, loadUserRole, setAuthToken } from "@/lib/api";
import { View, Text } from "react-native";

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const segments = useSegments();

  useEffect(() => {
    const initAuth = async () => {
      try {
        const token = await loadToken();
        const role = await loadUserRole();
        
        if (token) {
          setAuthToken(token);
          
          // Auto-navigate if at root and authenticated
          const inAuthGroup = segments[0] === '(tabs)' || segments[0] === 'admin';
          
          if (!inAuthGroup) {
            if (role === 'admin') {
              router.replace('/admin/dashboard');
            } else {
              router.replace('/(tabs)/dashboard');
            }
          }
        }
      } catch (error) {
        console.error('Auth initialization error:', error);
      } finally {
        setReady(true);
      }
    };

    initAuth();
  }, []); // Only run once on mount

  if (!ready) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <Text>Loading QueueEase...</Text>
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="admin" />
      <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
    </Stack>
  );
}