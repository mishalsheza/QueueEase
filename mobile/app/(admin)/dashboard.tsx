// app/(admin)/dashboard.tsx
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  Modal,
  TextInput,
  Alert,
  Dimensions,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

const { width } = Dimensions.get('window');

type QueueType = {
  id: string;
  name: string;
  section: 'A' | 'B' | 'C' | 'D';
  status: 'active' | 'paused' | 'closed';
  currentToken: string;
  nextToken: string;
  waiting: number;
  served: number;
  cancelled: number;
  avgWaitTime: number;
  createdAt: string;
};

export default function AdminDashboard() {
  const [queues, setQueues] = useState<QueueType[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newQueue, setNewQueue] = useState<{
    name: string;
    section: QueueType['section'];
  }>({
    name: '',
    section: 'A',
  });

  // Initialize with sample data
  useEffect(() => {
    setQueues([
      {
        id: '1',
        name: 'Dental Care',
        section: 'A',
        status: 'active',
        currentToken: 'D-08',
        nextToken: 'D-09',
        waiting: 12,
        served: 45,
        cancelled: 2,
        avgWaitTime: 14,
        createdAt: '2024-01-21',
      },
      {
        id: '2',
        name: 'Pharmacy',
        section: 'B',
        status: 'active',
        currentToken: 'P-22',
        nextToken: 'P-23',
        waiting: 5,
        served: 82,
        cancelled: 1,
        avgWaitTime: 8,
        createdAt: '2024-01-21',
      },
      {
        id: '3',
        name: 'General Checkup',
        section: 'C',
        status: 'paused',
        currentToken: 'G-15',
        nextToken: 'G-16',
        waiting: 22,
        served: 67,
        cancelled: 3,
        avgWaitTime: 12,
        createdAt: '2024-01-21',
      },
    ]);
  }, []);

  // Calculate totals
  const totalWaiters = queues.reduce((sum, q) => sum + q.waiting, 0);
  const totalServed = queues.reduce((sum, q) => sum + q.served, 0);
  const totalCancelled = queues.reduce((sum, q) => sum + q.cancelled, 0);
  const totalActiveQueues = queues.filter(q => q.status === 'active').length;

  const handleCreateQueue = () => {
    if (!newQueue.name.trim()) {
      Alert.alert('Error', 'Please enter queue name');
      return;
    }

    const newQueueItem: QueueType = {
      id: Date.now().toString(),
      name: newQueue.name,
      section: newQueue.section,
      status: 'active',
      currentToken: `${newQueue.section}-01`,
      nextToken: `${newQueue.section}-02`,
      waiting: 0,
      served: 0,
      cancelled: 0,
      avgWaitTime: 0,
      createdAt: new Date().toISOString().split('T')[0],
    };

    setQueues([newQueueItem, ...queues]); // Add to top
    setNewQueue({ name: '', section: 'A' });
    setShowCreateModal(false);
    Alert.alert('Success', `Queue "${newQueue.name}" created!`);
  };

  const handleCallNext = (queueId: string) => {
    setQueues(queues.map(queue => {
      if (queue.id === queueId && queue.status === 'active') {
        const currentNum = parseInt(queue.currentToken.split('-')[1]);
        const nextNum = parseInt(queue.nextToken.split('-')[1]);
        return {
          ...queue,
          currentToken: queue.nextToken,
          nextToken: `${queue.currentToken.split('-')[0]}-${nextNum + 1}`,
          waiting: Math.max(0, queue.waiting - 1),
          served: queue.served + 1,
        };
      }
      return queue;
    }));
  };

  const handleToggleStatus = (queueId: string) => {
    setQueues(queues.map(queue => {
      if (queue.id === queueId) {
        const newStatus = queue.status === 'active' ? 'paused' : 'active';
        return { ...queue, status: newStatus };
      }
      return queue;
    }));
  };

  const handleAddWaiter = (queueId: string) => {
    setQueues(queues.map(queue => {
      if (queue.id === queueId) {
        return { ...queue, waiting: queue.waiting + 1 };
      }
      return queue;
    }));
  };

  const handleLogout = () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Logout', onPress: () => router.replace('/auth/login?type=admin') }
      ]
    );
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
            <Text style={styles.brandName}>QueueEase Admin</Text>
            <Text style={styles.clinicName}>Main Street Clinic</Text>
          </View>
          <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
            <Ionicons name="log-out-outline" size={24} color="white" />
          </TouchableOpacity>
        </View>
      </LinearGradient>

      {/* Stats Overview */}
      <View style={styles.statsSection}>
        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <Ionicons name="people" size={24} color="#667eea" />
            <Text style={styles.statNumber}>{totalWaiters}</Text>
            <Text style={styles.statLabel}>Total Waiters</Text>
          </View>
          <View style={styles.statCard}>
            <Ionicons name="checkmark-circle" size={24} color="#4CAF50" />
            <Text style={styles.statNumber}>{totalServed}</Text>
            <Text style={styles.statLabel}>Served Today</Text>
          </View>
          <View style={styles.statCard}>
            <Ionicons name="close-circle" size={24} color="#FF5252" />
            <Text style={styles.statNumber}>{totalCancelled}</Text>
            <Text style={styles.statLabel}>Cancelled</Text>
          </View>
          <View style={styles.statCard}>
            <Ionicons name="list" size={24} color="#FF9800" />
            <Text style={styles.statNumber}>{totalActiveQueues}</Text>
            <Text style={styles.statLabel}>Active Queues</Text>
          </View>
        </View>
      </View>

      {/* Create New Queue Button */}
      <TouchableOpacity
        style={styles.createQueueButton}
        onPress={() => setShowCreateModal(true)}
      >
        <Ionicons name="add-circle" size={24} color="white" />
        <Text style={styles.createQueueButtonText}>Create New Queue</Text>
      </TouchableOpacity>

      {/* Active Queues */}
      <View style={styles.queuesSection}>
        <Text style={styles.sectionTitle}>Active Queues</Text>
        
        {queues.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="list-outline" size={48} color="#ccc" />
            <Text style={styles.emptyText}>No active queues</Text>
            <Text style={styles.emptySubtext}>Create your first queue to get started</Text>
          </View>
        ) : (
          queues.map((queue) => (
            <View key={queue.id} style={styles.queueCard}>
              <View style={styles.queueHeader}>
                <View>
                  <Text style={styles.queueName}>{queue.name}</Text>
                  <View style={styles.queueInfoRow}>
                    <View style={styles.sectionBadge}>
                      <Text style={styles.sectionText}>Section {queue.section}</Text>
                    </View>
                    <View style={[
                      styles.statusBadge,
                      queue.status === 'active' ? styles.activeBadge : styles.pausedBadge
                    ]}>
                      <Text style={styles.statusText}>
                        {queue.status === 'active' ? 'ACTIVE' : 'PAUSED'}
                      </Text>
                    </View>
                  </View>
                </View>
                <TouchableOpacity
                  style={styles.addWaiterButton}
                  onPress={() => handleAddWaiter(queue.id)}
                >
                  <Ionicons name="person-add" size={16} color="#667eea" />
                </TouchableOpacity>
              </View>

              {/* Queue Stats */}
              <View style={styles.queueStats}>
                <View style={styles.statRow}>
                  <View style={styles.statItem}>
                    <Ionicons name="time" size={14} color="#666" />
                    <Text style={styles.statItemText}>Avg Wait: {queue.avgWaitTime} min</Text>
                  </View>
                  <View style={styles.statItem}>
                    <Ionicons name="checkmark" size={14} color="#666" />
                    <Text style={styles.statItemText}>Served: {queue.served}</Text>
                  </View>
                  <View style={styles.statItem}>
                    <Ionicons name="close" size={14} color="#666" />
                    <Text style={styles.statItemText}>Cancelled: {queue.cancelled}</Text>
                  </View>
                </View>
              </View>

              {/* Current Status */}
              <View style={styles.currentStatus}>
                <View style={styles.tokenDisplay}>
                  <Text style={styles.tokenLabel}>NOW SERVING</Text>
                  <Text style={styles.currentToken}>{queue.currentToken}</Text>
                </View>
                <View style={styles.tokenDisplay}>
                  <Text style={styles.tokenLabel}>WAITING</Text>
                  <Text style={styles.waitingCount}>{queue.waiting} people</Text>
                </View>
                <View style={styles.tokenDisplay}>
                  <Text style={styles.tokenLabel}>NEXT</Text>
                  <Text style={styles.nextToken}>{queue.nextToken}</Text>
                </View>
              </View>

              {/* Queue Actions */}
              <View style={styles.queueActions}>
                <TouchableOpacity
                  style={[
                    styles.actionButton,
                    queue.status === 'active' ? styles.pauseButton : styles.resumeButton
                  ]}
                  onPress={() => handleToggleStatus(queue.id)}
                >
                  <Ionicons
                    name={queue.status === 'active' ? 'pause' : 'play'}
                    size={16}
                    color="white"
                  />
                  <Text style={styles.actionButtonText}>
                    {queue.status === 'active' ? 'PAUSE' : 'RESUME'}
                  </Text>
                </TouchableOpacity>
                
                <TouchableOpacity
                  style={[styles.actionButton, styles.callButton]}
                  onPress={() => handleCallNext(queue.id)}
                  disabled={queue.status !== 'active'}
                >
                  <Ionicons name="megaphone" size={16} color="white" />
                  <Text style={styles.actionButtonText}>CALL NEXT</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
      </View>

      {/* Create Queue Modal */}
      <Modal
        visible={showCreateModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowCreateModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Create New Queue</Text>
              <TouchableOpacity onPress={() => setShowCreateModal(false)}>
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Queue Name *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g., Dental Care, Pharmacy"
                  value={newQueue.name}
                  onChangeText={(text) => setNewQueue({...newQueue, name: text})}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Section</Text>
                <View style={styles.sectionButtons}>
                  {['A', 'B', 'C', 'D'].map((section) => (
                    <TouchableOpacity
                      key={section}
                      style={[
                        styles.sectionButton,
                        newQueue.section === section && styles.sectionButtonActive
                      ]}
                      onPress={() => setNewQueue({...newQueue, section: section as any})}
                    >
                      <Text style={[
                        styles.sectionButtonText,
                        newQueue.section === section && styles.sectionButtonTextActive
                      ]}>
                        {section}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <TouchableOpacity
                style={styles.createButton}
                onPress={handleCreateQueue}
              >
                <Ionicons name="add-circle" size={20} color="white" />
                <Text style={styles.createButtonText}>CREATE QUEUE</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  statsSection: {
    padding: 20,
    paddingTop: 15,
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
    padding: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  statNumber: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 8,
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
  },
  createQueueButton: {
    backgroundColor: '#667eea',
    marginHorizontal: 20,
    padding: 16,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  createQueueButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  queuesSection: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 15,
  },
  emptyState: {
    alignItems: 'center',
    padding: 40,
    backgroundColor: 'white',
    borderRadius: 15,
  },
  emptyText: {
    fontSize: 18,
    color: '#666',
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#999',
    marginTop: 4,
  },
  queueCard: {
    backgroundColor: 'white',
    borderRadius: 15,
    padding: 15,
    marginBottom: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  queueHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 15,
  },
  queueName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
  },
  queueInfoRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  sectionBadge: {
    backgroundColor: '#f0f4ff',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  sectionText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#667eea',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  activeBadge: {
    backgroundColor: '#e7f7ef',
  },
  pausedBadge: {
    backgroundColor: '#fff5e6',
  },
  statusText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#333',
  },
  addWaiterButton: {
    padding: 8,
    backgroundColor: '#f0f4ff',
    borderRadius: 20,
  },
  queueStats: {
    backgroundColor: '#f8f9fa',
    borderRadius: 10,
    padding: 12,
    marginBottom: 15,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statItemText: {
    fontSize: 12,
    color: '#666',
  },
  currentStatus: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#f8f9fa',
    borderRadius: 10,
    padding: 15,
    marginBottom: 15,
  },
  tokenDisplay: {
    alignItems: 'center',
    flex: 1,
  },
  tokenLabel: {
    fontSize: 10,
    color: '#666',
    marginBottom: 4,
  },
  currentToken: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  waitingCount: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FF9800',
  },
  nextToken: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  queueActions: {
    flexDirection: 'row',
    gap: 10,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 8,
    gap: 8,
  },
  pauseButton: {
    backgroundColor: '#FF9800',
  },
  resumeButton: {
    backgroundColor: '#4CAF50',
  },
  callButton: {
    backgroundColor: '#2196F3',
  },
  actionButtonText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: 'white',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '60%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  modalBody: {
    paddingBottom: 20,
  },
  inputGroup: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    color: '#333',
  },
  sectionButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  sectionButton: {
    flex: 1,
    paddingVertical: 12,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    alignItems: 'center',
  },
  sectionButtonActive: {
    backgroundColor: '#667eea',
  },
  sectionButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  sectionButtonTextActive: {
    color: 'white',
  },
  createButton: {
    backgroundColor: '#667eea',
    padding: 16,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 10,
  },
  createButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});