// app/(tabs)/join-queue.tsx
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/lib/api';
import { router } from 'expo-router';

type QueueItem = {
  _id: string;
  name: string;
  type?: string;
  users: any[];
  status?: string;
};

export default function JoinQueueScreen() {
  const [queues, setQueues] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchQueues();
  }, []);

  const fetchQueues = async () => {
    setLoading(true);
    try {
      const res = await api.get('/queues');
      setQueues(res.data);
    } catch (err) {
      console.error('Error fetching queues:', err);
      Alert.alert('Error', 'Could not load active queues.');
    } finally {
      setLoading(false);
    }
  };

  const handleJoinQueue = async (queueId: string, queueName: string) => {
    try {
      setLoading(true);
      const res = await api.post(`/queues/${queueId}/join`);
      console.log('Joined queue:', res.data);
      Alert.alert(
        'Success',
        `Successfully joined ${queueName}!`,
        [{ text: 'Great', onPress: () => router.push('/(tabs)/dashboard') }]
      );
    } catch (err: any) {
      console.error('Error joining queue:', err);
      const message = err.response?.data?.message || 'Failed to join queue.';
      Alert.alert('Error', message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <StatusBar barStyle="light-content" backgroundColor="#667eea" />
      <View style={styles.header}>
        <Text style={styles.title}>Join a Queue</Text>
        <Text style={styles.subtitle}>
          Select a provider to get your virtual ticket
        </Text>
      </View>

      {loading && queues.length === 0 ? (
        <View style={styles.loaderContainer}>
          <ActivityIndicator size="large" color="#667eea" />
        </View>
      ) : (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Active Queues</Text>
          {queues.length > 0 ? (
            queues.map((queue) => (
              <View key={queue._id} style={styles.queueCard}>
                <View style={styles.queueInfo}>
                  <Text style={styles.queueName}>{queue.name}</Text>
                  <Text style={styles.queueType}>{queue.type || 'General Service'}</Text>
                  <View style={styles.queueStats}>
                    <Text style={styles.queueStat}>{queue.users.length} waiting</Text>
                    <Text style={styles.queueStat}>~{queue.users.length * 5} min wait</Text>
                  </View>
                </View>
                <TouchableOpacity 
                  style={[styles.joinButton, loading && styles.joinButtonDisabled]}
                  onPress={() => handleJoinQueue(queue._id, queue.name)}
                  disabled={loading}
                >
                  <Text style={styles.joinButtonText}>
                    {loading ? '...' : 'Join'}
                  </Text>
                </TouchableOpacity>
              </View>
            ))
          ) : (
            <View style={styles.emptyState}>
              <Ionicons name="information-circle-outline" size={48} color="#ccc" />
              <Text style={styles.emptyText}>No active queues found.</Text>
            </View>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: '#667eea',
    padding: 20,
    paddingTop: 50,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.9)',
  },
  section: {
    padding: 20,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 15,
  },
  queueCard: {
    backgroundColor: 'white',
    borderRadius: 15,
    padding: 15,
    marginBottom: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  queueInfo: {
    flex: 1,
  },
  queueName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  queueType: {
    fontSize: 12,
    color: '#666',
    marginBottom: 8,
  },
  queueStats: {
    flexDirection: 'row',
    gap: 15,
  },
  queueStat: {
    fontSize: 12,
    color: '#999',
  },
  joinButton: {
    backgroundColor: '#667eea',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    minWidth: 80,
    alignItems: 'center',
  },
  joinButtonDisabled: {
    backgroundColor: '#ccc',
  },
  joinButtonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 14,
  },
  loaderContainer: {
    marginTop: 50,
    alignItems: 'center',
  },
  emptyState: {
    alignItems: 'center',
    marginTop: 50,
  },
  emptyText: {
    marginTop: 10,
    color: '#999',
    fontSize: 16,
  },
});