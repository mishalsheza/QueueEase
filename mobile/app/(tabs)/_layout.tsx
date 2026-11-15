// app/(tabs)/_layout.tsx
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { showAlert } from '@/lib/notify';
import { useSocketEvent, type TicketCalled } from '@/lib/realtime';

/**
 * "You're being called": the server sends ticket:called only to the user
 * call-next picked (all their devices). Mounted here so it works on every
 * user tab. The dashboard refreshes itself from the queue update.
 */
function CalledNotifier() {
  useSocketEvent<TicketCalled>('ticket:called', (e) => {
    showAlert("It's your turn!", `Token ${e.token}: please go to the counter at ${e.queueName}.`);
  });
  return null;
}

export default function TabLayout() {
  return (
    <>
    <CalledNotifier />
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#667eea',
        tabBarInactiveTintColor: '#999',
        tabBarStyle: {
          backgroundColor: 'white',
          borderTopWidth: 1,
          borderTopColor: '#f0f0f0',
          height: 60,
          paddingBottom: 8,
          paddingTop: 8,
        },
      }}>
      <Tabs.Screen
        name="dashboard"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="speedometer" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="join-queue"
        options={{
          title: 'Join Queue',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="add-circle-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="alerts"
        options={{
          title: 'Alerts',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="notifications-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
    </>
  );
}