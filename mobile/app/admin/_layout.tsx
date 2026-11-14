// app/admin/_layout.tsx
import { Stack } from 'expo-router';

// Only reachable when signed in as an admin (guarded in app/_layout.tsx).
// Keeps the dashboard underneath /admin/users when that URL is opened
// directly, so Back returns to the dashboard.
export const unstable_settings = {
  initialRouteName: 'dashboard',
};

export default function AdminLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="dashboard" />
      <Stack.Screen name="users" />
    </Stack>
  );
}
