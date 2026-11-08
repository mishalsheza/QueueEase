// app/(admin)/profile.tsx
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  Dimensions,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

const { width } = Dimensions.get('window');

type PastQueueType = {
  id: string;
  name: string;
  date: string;
  totalServed: number;
  totalCancelled: number;
  avgWaitTime: number;
  peakWaiters: number;
  status: 'completed' | 'cancelled';
};

type AdminStatsType = {
  totalQueuesCreated: number;
  totalUsersServed: number;
  avgQueueDuration: number;
  totalCancellations: number;
  efficiencyRating: number;
};

export default function AdminProfileScreen() {
  const [pastQueues, setPastQueues] = useState<PastQueueType[]>([]);
  const [adminStats, setAdminStats] = useState<AdminStatsType>({
    totalQueuesCreated: 24,
    totalUsersServed: 842,
    avgQueueDuration: 18.5,
    totalCancellations: 47,
    efficiencyRating: 4.2,
  });

  useEffect(() => {
    // Mock past queues data
    setPastQueues([
      {
        id: '1',
        name: 'Dental Care - Jan 20',
        date: '2024-01-20',
        totalServed: 52,
        totalCancelled: 3,
        avgWaitTime: 16,
        peakWaiters: 18,
        status: 'completed',
      },
      {
        id: '2',
        name: 'Pharmacy - Jan 20',
        date: '2024-01-20',
        totalServed: 78,
        totalCancelled: 2,
        avgWaitTime: 9,
        peakWaiters: 12,
        status: 'completed',
      },
      {
        id: '3',
        name: 'Voting Queue - Jan 19',
        date: '2024-01-19',
        totalServed: 124,
        totalCancelled: 8,
        avgWaitTime: 25,
        peakWaiters: 32,
        status: 'completed',
      },
      {
        id: '4',
        name: 'Finance Help Desk - Jan 18',
        date: '2024-01-18',
        totalServed: 45,
        totalCancelled: 5,
        avgWaitTime: 22,
        peakWaiters: 15,
        status: 'completed',
      },
      {
        id: '5',
        name: 'General Checkup - Jan 17',
        date: '2024-01-17',
        totalServed: 63,
        totalCancelled: 4,
        avgWaitTime: 14,
        peakWaiters: 20,
        status: 'completed',
      },
    ]);
  }, []);

  const handleLogout = () => {
    router.replace('/auth/login?type=admin');
  };

  const getStatusColor = (status: string): string => {
    return status === 'completed' ? '#4CAF50' : '#F44336';
  };

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <StatusBar barStyle="light-content" backgroundColor="#667eea" />
      
      {/* Header */}
      <LinearGradient
        colors={['#667eea', '#764ba2']}
        style={styles.header}
      >
        <View style={styles.headerTop}>
          <View>
            <Text style={styles.brandName}>Admin Profile</Text>
            <Text style={styles.clinicName}>Main Street Clinic</Text>
          </View>
          <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
            <Ionicons name="log-out-outline" size={24} color="white" />
          </TouchableOpacity>
        </View>

        {/* Admin Info */}
        <View style={styles.adminInfo}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>AD</Text>
          </View>
          <View style={styles.adminDetails}>
            <Text style={styles.adminName}>Admin User</Text>
            <Text style={styles.adminEmail}>admin@queueease.com</Text>
            <Text style={styles.adminRole}>Queue Administrator</Text>
          </View>
        </View>
      </LinearGradient>

      {/* Admin Stats */}
      <View style={styles.statsSection}>
        <Text style={styles.sectionTitle}>Admin Statistics</Text>
        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <Ionicons name="list" size={24} color="#667eea" />
            <Text style={styles.statNumber}>{adminStats.totalQueuesCreated}</Text>
            <Text style={styles.statLabel}>Queues Created</Text>
          </View>
          <View style={styles.statCard}>
            <Ionicons name="people" size={24} color="#4CAF50" />
            <Text style={styles.statNumber}>{adminStats.totalUsersServed}</Text>
            <Text style={styles.statLabel}>Users Served</Text>
          </View>
          <View style={styles.statCard}>
            <Ionicons name="time" size={24} color="#FF9800" />
            <Text style={styles.statNumber}>{adminStats.avgQueueDuration}m</Text>
            <Text style={styles.statLabel}>Avg Duration</Text>
          </View>
          <View style={styles.statCard}>
            <Ionicons name="star" size={24} color="#FFC107" />
            <Text style={styles.statNumber}>{adminStats.efficiencyRating}/5</Text>
            <Text style={styles.statLabel}>Efficiency</Text>
          </View>
        </View>
      </View>

      {/* Past Queues */}
      <View style={styles.pastQueuesSection}>
        <Text style={styles.sectionTitle}>Past Queues</Text>
        
        {pastQueues.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="time-outline" size={48} color="#ccc" />
            <Text style={styles.emptyText}>No past queues</Text>
          </View>
        ) : (
          pastQueues.map((queue) => (
            <View key={queue.id} style={styles.queueCard}>
              <View style={styles.queueHeader}>
                <View>
                  <Text style={styles.queueName}>{queue.name}</Text>
                  <Text style={styles.queueDate}>{queue.date}</Text>
                </View>
                <View style={[
                  styles.statusBadge,
                  { backgroundColor: getStatusColor(queue.status) + '20' }
                ]}>
                  <Text style={[styles.statusText, { color: getStatusColor(queue.status) }]}>
                    {queue.status.toUpperCase()}
                  </Text>
                </View>
              </View>

              <View style={styles.queueStats}>
                <View style={styles.statRow}>
                  <View style={styles.statItem}>
                    <Ionicons name="checkmark-circle" size={14} color="#4CAF50" />
                    <Text style={styles.statItemLabel}>Served</Text>
                    <Text style={styles.statItemValue}>{queue.totalServed}</Text>
                  </View>
                  <View style={styles.statItem}>
                    <Ionicons name="close-circle" size={14} color="#F44336" />
                    <Text style={styles.statItemLabel}>Cancelled</Text>
                    <Text style={styles.statItemValue}>{queue.totalCancelled}</Text>
                  </View>
                  <View style={styles.statItem}>
                    <Ionicons name="time" size={14} color="#FF9800" />
                    <Text style={styles.statItemLabel}>Avg Wait</Text>
                    <Text style={styles.statItemValue}>{queue.avgWaitTime}m</Text>
                  </View>
                </View>
                <View style={styles.peakInfo}>
                  <Ionicons name="trending-up" size={14} color="#666" />
                  <Text style={styles.peakText}>
                    Peak: {queue.peakWaiters} waiters
                  </Text>
                </View>
              </View>
            </View>
          ))
        )}
      </View>

      {/* Actions */}
      <View style={styles.actionsSection}>
        <TouchableOpacity style={[styles.actionButton, styles.exportButton]}>
          <Ionicons name="download" size={20} color="white" />
          <Text style={styles.actionButtonText}>EXPORT ALL DATA</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionButton, styles.settingsButton]}>
          <Ionicons name="settings" size={20} color="white" />
          <Text style={styles.actionButtonText}>SETTINGS</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    padding: 20,
    paddingTop: 50,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  brandName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 4,
  },
  clinicName: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.9)',
  },
  logoutButton: {
    padding: 8,
  },
  adminInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 15,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#667eea',
  },
  adminDetails: {
    flex: 1,
  },
  adminName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 2,
  },
  adminEmail: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.9)',
    marginBottom: 2,
  },
  adminRole: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.7)',
  },
  statsSection: {
    padding: 20,
    paddingTop: 15,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 15,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 15,
  },
  statCard: {
    width: (width - 55) / 2,
    backgroundColor: 'white',
    borderRadius: 15,
    padding: 15,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  statNumber: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 8,
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 11,
    color: '#666',
    textAlign: 'center',
  },
  pastQueuesSection: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  emptyState: {
    alignItems: 'center',
    padding: 40,
    backgroundColor: 'white',
    borderRadius: 15,
  },
  emptyText: {
    fontSize: 16,
    color: '#666',
    marginTop: 16,
  },
  queueCard: {
    backgroundColor: 'white',
    borderRadius: 15,
    padding: 15,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  queueHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 15,
  },
  queueName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 4,
  },
  queueDate: {
    fontSize: 12,
    color: '#666',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '600',
  },
  queueStats: {
    backgroundColor: '#f8f9fa',
    borderRadius: 10,
    padding: 12,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  statItem: {
    alignItems: 'center',
    flex: 1,
  },
  statItemLabel: {
    fontSize: 10,
    color: '#666',
    marginTop: 2,
    marginBottom: 2,
  },
  statItemValue: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#333',
  },
  peakInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  peakText: {
    fontSize: 11,
    color: '#666',
  },
  actionsSection: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    gap: 10,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 15,
    borderRadius: 10,
    gap: 10,
  },
  exportButton: {
    backgroundColor: '#4CAF50',
  },
  settingsButton: {
    backgroundColor: '#667eea',
  },
  actionButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
});