// app/_layout.tsx
import { useEffect } from 'react';
import { Stack, router, usePathname } from 'expo-router';
import { View, Text } from 'react-native';
import { AuthProvider, useAuth } from '@/lib/auth';
import type { Role } from '@/lib/api';

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootNavigator />
    </AuthProvider>
  );
}

// Where each state lands, and which URLs it may stay on.
const HOME = { signedOut: '/', user: '/dashboard', admin: '/admin/dashboard' } as const;
const ALLOWED: Record<'signedOut' | Role, (path: string) => boolean> = {
  signedOut: (p) => p === '/' || p === '/auth/login' || p === '/auth/signup',
  user: (p) => ['/dashboard', '/join-queue', '/alerts', '/profile'].includes(p),
  admin: (p) => p === '/admin/dashboard' || p === '/admin/users',
};

/**
 * Route guards, in two layers:
 *
 * 1. Stack.Protected only registers the screens for the current state, so a
 *    screen outside it can't be rendered, even by typing its URL.
 * 2. When the session or URL changes and the current path isn't allowed for
 *    this state (after login/logout, or a typed/deep-linked URL), we replace
 *    it with the state's home screen. Without this, expo-router falls back to
 *    the first remaining group without choosing a tab, so the URL can say
 *    /alerts while the Dashboard tab is shown.
 *
 * These guards only hide screens. The backend still checks the role on every
 * request (403 for the wrong role).
 */
function RootNavigator() {
  const { status, user } = useAuth();
  const pathname = usePathname();

  const area: 'signedOut' | Role | null =
    status === 'signedOut' ? 'signedOut' : status === 'signedIn' && user ? user.role : null;

  useEffect(() => {
    if (!area) return; // still loading
    if (!ALLOWED[area](pathname)) {
      router.replace(HOME[area]);
    }
  }, [area, pathname]);

  if (!area) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <Text>Loading QueueEase...</Text>
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={area === 'signedOut'}>
        <Stack.Screen name="index" />
        <Stack.Screen name="auth/login" />
        <Stack.Screen name="auth/signup" />
      </Stack.Protected>

      <Stack.Protected guard={area === 'user'}>
        <Stack.Screen name="(tabs)" />
      </Stack.Protected>

      <Stack.Protected guard={area === 'admin'}>
        <Stack.Screen name="admin" />
      </Stack.Protected>
    </Stack>
  );
}
