// app/admin/dashboard.tsx - Kiosk-style Admin Dashboard
import React, { useState, useEffect, useCallback } from 'react';
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
  Platform,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { api, logout } from '@/lib/api';
import { socket } from '@/lib/socket';

const { width } = Dimensions.get('window');

// Updated Queue type to match your screenshot
type QueueType = {
  _id: string;
  name: string;
  type: 'Dental Care' | 'Pharmacy' | 'General Checkup' | 'Voting' | 'Finance Help Desk';
  section: 'A' | 'B' | 'C' | 'D';
  status: 'running' | 'paused' | 'closed';
  currentToken: string;
  nextToken: string;
  waiting: number;
  avgProcessTime: number;
  servedToday: number;
  cancelledToday: number;
  users: { user: string; joinedAt: string }[];
  nowServing?: {
    user: string;
    token: string;
    startedAt: string;
  };
};

// User in queue type
type UserInQueue = {
  id: string;
  name: string;
  token: string;
  queueId: string;
  joinedAt: Date;
  status: 'waiting' | 'served' | 'cancelled';
  position: number;
};

export default function AdminDashboard() {
  const [queues, setQueues] = useState<QueueType[]>([]);
  const [users, setUsers] = useState<UserInQueue[]>([]);
  const [completedTickets, setCompletedTickets] = useState<any[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newQueue, setNewQueue] = useState({
    name: '',
    type: 'Dental Care' as const,
    section: 'A' as const,
  });

  const [isConnected, setIsConnected] = useState(socket.connected);

  // Data fetching initialization
  useFocusEffect(
    useCallback(() => {
      fetchQueues();
      fetchCompleted();
    }, [])
  );

  useEffect(() => {
    socket.connect();

    const onConnect = () => setIsConnected(true);
    const onDisconnect = () => setIsConnected(false);
    const onQueueUpdate = () => {
      console.log('🔄 Dashboard: Queue update received via socket');
      fetchQueues();
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('queueUpdated', () => {
      console.log('🔄 Dashboard: Queue update received via socket');
      fetchQueues();
      fetchCompleted();
    });

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('queueUpdated', onQueueUpdate);
    };
  }, []);

  const fetchQueues = async () => {
    try {
      const res = await api.get('/queues');
      setQueues(res.data);
    } catch (err) {
      console.error('Error fetching queues:', err);
    }
  };

  const fetchCompleted = async () => {
    try {
      const res = await api.get('/queues/admin/completed-report');
      setCompletedTickets(res.data);
    } catch (err) {
      console.error('Error fetching completed tickets:', err);
    }
  };

  const handleCreateQueue = async () => {
    if (!newQueue.name.trim()) {
      Alert.alert('Error', 'Please enter queue name');
      return;
    }

    try {
      const res = await api.post('/queues', { 
        name: newQueue.name,
        type: newQueue.type,
        section: newQueue.section
      });
      
      setQueues([...queues, res.data]);
      setNewQueue({ name: '', type: 'Dental Care', section: 'A' });
      setShowCreateModal(false);
      Alert.alert('Success', `Queue "${newQueue.name}" created successfully!`);
    } catch (err) {
      console.error('Error creating queue:', err);
      Alert.alert('Error', 'Failed to create queue');
    }
  };

  // Derived metrics
  const totalWaiters = queues.reduce((sum, q: any) => sum + (q.users?.length || 0), 0);
  const totalServedToday = queues.reduce((sum, q: any) => sum + (q.servedToday || 0), 0);
  const avgProcessTime = queues.length > 0 
    ? queues.reduce((sum, q: any) => sum + (q.avgProcessTime || 0), 0) / queues.length 
    : 0;

  const sectionDistribution = {
    A: queues.filter((q: any) => q.section === 'A').reduce((sum, q: any) => sum + (q.users?.length || 0), 0),
    B: queues.filter((q: any) => q.section === 'B').reduce((sum, q: any) => sum + (q.users?.length || 0), 0),
    C: queues.filter((q: any) => q.section === 'C').reduce((sum, q: any) => sum + (q.users?.length || 0), 0),
    D: queues.filter((q: any) => q.section === 'D').reduce((sum, q: any) => sum + (q.users?.length || 0), 0),
  };

  const handleCallNext = async (queueId: string) => {
    try {
      await api.post(`/queues/${queueId}/call-next`);
      fetchQueues();
    } catch (err: any) {
      console.error('Error calling next:', err);
      Alert.alert('Error', err.response?.data?.message || 'Failed to call next person.');
    }
  };

  const handleServe = async (queueId: string) => {
    try {
      await api.post(`/queues/${queueId}/serve`);
      fetchQueues();
      Alert.alert('Success', 'Customer marked as completed.');
    } catch (err: any) {
      console.error('Error serving:', err);
      Alert.alert('Error', err.response?.data?.message || 'Failed to serve customer.');
    }
  };

  const handleToggleStatus = (queueId: string) => {
    setQueues(queues.map(queue => {
      if (queue._id === queueId) {
        return { 
          ...queue, 
          status: queue.status === 'running' ? 'paused' : 'running' 
        };
      }
      return queue;
    }));
  };



  const performDelete = async (queueId: string) => {
    console.log(`Confirmed delete for: ${queueId}`);
    try {
      await api.delete(`/queues/${queueId}`);
      Alert.alert('Success', 'Queue deleted successfully');
      fetchQueues();
    } catch (err: any) {
      console.error('Error deleting queue:', err);
      const errMsg = err.response?.data?.message || err.message || 'Failed to delete queue';
      const status = err.response?.status;
      Alert.alert('Delete Failed', `Status: ${status}\nMessage: ${errMsg}`);
    }
  };

  const handleDeleteQueue = (queueId: string, queueName: string) => {
    console.log(`Requesting to delete queue: ${queueId} (${queueName})`);
    
    if (Platform.OS === 'web') {
      const confirmed = window.confirm(`Are you sure you want to delete "${queueName}"?`);
      if (confirmed) {
        performDelete(queueId);
      }
    } else {
      Alert.alert(
        'Delete Queue',
        `Are you sure you want to delete "${queueName}"?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => performDelete(queueId)
          }
        ]
      );
    }
  };

  const handleViewUsers = () => {
    router.push('/admin/users');
  };

  const handleLogout = () => {
    const performLogout = async () => {
      await logout();
      router.replace('/auth/login?type=admin');
    };

    if (Platform.OS === 'web') {
      if (window.confirm('Are you sure you want to logout?')) {
        performLogout();
      }
    } else {
      Alert.alert(
        'Logout',
        'Are you sure you want to logout?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Logout', style: 'destructive', onPress: performLogout }
        ]
      );
    }
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
            <View style={styles.brandRow}>
              <Text style={styles.brandName}>QueueEase</Text>
              <View style={[styles.connectionDot, isConnected ? styles.connected : styles.disconnected]} />
            </View>
            <Text style={styles.clinicName}>Managing: Main Street Clinic</Text>
          </View>
          <View style={styles.headerRight}>
            <TouchableOpacity 
              style={styles.headerCreateButton}
              onPress={() => setShowCreateModal(true)}
            >
              <Ionicons name="add-circle" size={24} color="white" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
              <Ionicons name="log-out-outline" size={24} color="white" />
            </TouchableOpacity>
          </View>
        </View>
      </LinearGradient>

      {/* Branch Overview */}
      <View style={styles.overviewSection}>
        <Text style={styles.sectionTitle}>Branch Overview</Text>
        <View style={styles.metricsGrid}>
          <View style={styles.metricCard}>
            <Text style={styles.metricValue}>{totalWaiters}</Text>
            <View style={styles.metricTrend}>
              <Ionicons name="arrow-up" size={16} color="#4CAF50" />
              <Text style={styles.trendText}>Live status</Text>
            </View>
            <Text style={styles.metricLabel}>Waiters</Text>
            <View style={styles.targetInfo}>
              <Text style={styles.targetText}>Total Active</Text>
            </View>
          </View>

          <View style={styles.metricCard}>
            <Text style={styles.metricValue}>{totalServedToday}</Text>
            <View style={styles.metricTrend}>
              <Ionicons name="stats-chart" size={16} color="#667eea" />
              <Text style={styles.trendText}>Completed today</Text>
            </View>
            <Text style={styles.metricLabel}>Served Today</Text>
            <View style={styles.avgProcess}>
              <Text style={styles.avgProcessText}>Avg. Process</Text>
              <Text style={styles.avgProcessTime}>{avgProcessTime.toFixed(0)} min</Text>
            </View>
            <Text style={styles.normalRange}>Real-time metrics</Text>
          </View>
        </View>
      </View>

      {/* Active Counters */}
      <View style={styles.countersSection}>
        <Text style={styles.sectionTitle}>Active Counters</Text>
        {queues.map((queue) => (
          <View key={queue._id} style={styles.counterCard}>
            <View style={styles.counterHeader}>
              <View>
                <Text style={styles.counterName}>{queue.name}</Text>
                <View style={styles.statusRow}>
                  <View style={[
                    styles.statusIndicator,
                    queue.status === 'running' ? styles.running : styles.paused
                  ]} />
                  <Text style={styles.statusText}>
                    {queue.status === 'running' ? 'Running' : 'Paused'}
                  </Text>
                </View>
              </View>
              <View style={styles.headerRightInfo}>
                <Text style={styles.waitingCount}>{(queue as any).users?.length || 0} people waiting</Text>
                <TouchableOpacity 
                  onPress={() => handleDeleteQueue(queue._id, queue.name)}
                  style={styles.deleteButton}
                >
                  <Ionicons name="trash-outline" size={20} color="#FF5252" />
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.tokenSection}>
              <View style={styles.tokenInfo}>
                <Text style={styles.tokenLabel}>SERVING</Text>
                <Text style={styles.tokenValue}>{queue.nowServing?.token || '--'}</Text>
              </View>
              <View style={styles.tokenInfo}>
                <Text style={styles.tokenLabel}>NEXT</Text>
                <Text style={styles.tokenValue}>{(queue.users && queue.users.length > 0) ? `${queue.name.charAt(0).toUpperCase()}-${queue.servedToday + 1 + (queue.nowServing ? 1 : 0)}` : '--'}</Text>
              </View>
            </View>

            <View style={styles.counterActions}>
              <TouchableOpacity
                style={[
                  styles.actionButton,
                  queue.status === 'running' ? styles.pauseAction : styles.resumeAction
                ]}
                onPress={() => handleToggleStatus(queue._id)}
              >
                <Ionicons
                  name={queue.status === 'running' ? 'pause' : 'play'}
                  size={16}
                  color="white"
                />
                <Text style={styles.actionButtonText}>
                  {queue.status === 'running' ? 'PAUSE' : 'RESUME'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionButton, styles.callAction]}
                onPress={() => handleCallNext(queue._id)}
              >
                <Ionicons name="megaphone" size={16} color="white" />
                <Text style={styles.actionButtonText}>CALL NEXT</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionButton, styles.serveAction]}
                onPress={() => handleServe(queue._id)}
                disabled={!queue.nowServing}
              >
                <Ionicons name="checkmark-circle" size={16} color="white" />
                <Text style={styles.actionButtonText}>SERVE</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </View>

      {/* Distribution */}
      <View style={styles.distributionSection}>
        <Text style={styles.sectionTitle}>Distribution</Text>
        <View style={styles.distributionGrid}>
          {['A', 'B', 'C', 'D'].map((section) => (
            <View key={section} style={styles.distributionCard}>
              <Text style={styles.distributionSectionLabel}>Section {section}</Text>
              <Text style={styles.distributionCount}>
                {sectionDistribution[section as keyof typeof sectionDistribution]}
              </Text>
            </View>
          ))}
        </View>
      </View>

      {/* Completed Tickets Section */}
      <View style={styles.completedSection}>
        <Text style={styles.sectionTitle}>Recently Completed</Text>
        {completedTickets.length > 0 ? (
          completedTickets.map((ticket) => (
            <View key={ticket._id} style={styles.completedCard}>
              <View style={styles.completedLeft}>
                <Text style={styles.completedToken}>{ticket.token}</Text>
                <View style={styles.completedInfo}>
                  <Text style={styles.completedQueue}>{ticket.queueName}</Text>
                  <Text style={styles.completedUser}>{ticket.user?.name || 'Unknown User'}</Text>
                </View>
              </View>
              <View style={styles.completedRight}>
                <Text style={styles.completedTime}>
                  {ticket.completedAt && new Date(ticket.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
                <Ionicons name="checkmark-done-circle" size={20} color="#4CAF50" />
              </View>
            </View>
          ))
        ) : (
          <View style={styles.emptyCompleted}>
            <Text style={styles.emptyCompletedText}>No tickets completed yet today.</Text>
          </View>
        )}
      </View>

      {/* Management Buttons */}
      <View style={styles.managementSection}>
        <TouchableOpacity 
          style={[styles.managementButton, styles.viewUsersButton]}
          onPress={handleViewUsers}
        >
          <Ionicons name="people" size={20} color="white" />
          <Text style={styles.managementButtonText}>VIEW ALL USERS</Text>
        </TouchableOpacity>
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
                <Text style={styles.inputLabel}>Queue Type</Text>
                <View style={styles.typeButtons}>
                  {['Dental Care', 'Pharmacy', 'General Checkup', 'Voting', 'Finance Help Desk'].map((type) => (
                    <TouchableOpacity
                      key={type}
                      style={[
                        styles.typeButton,
                        newQueue.type === type && styles.typeButtonActive
                      ]}
                      onPress={() => setNewQueue({...newQueue, type: type as any})}
                    >
                      <Text style={[
                        styles.typeButtonText,
                        newQueue.type === type && styles.typeButtonTextActive
                      ]}>
                        {type}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
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
    alignItems: 'center',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 15,
  },
  headerCreateButton: {
    padding: 8,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  connectionDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 4,
  },
  connected: {
    backgroundColor: '#4CAF50',
    shadowColor: '#4CAF50',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
  },
  disconnected: {
    backgroundColor: '#FF5252',
  },
  brandName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 4,
  },
  clinicName: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.9)',
  },
  logoutButton: {
    padding: 8,
  },
  overviewSection: {
    padding: 20,
    paddingTop: 15,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 20,
  },
  metricsGrid: {
    flexDirection: 'row',
    gap: 15,
  },
  metricCard: {
    flex: 1,
    backgroundColor: 'white',
    borderRadius: 15,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  metricValue: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
  },
  metricTrend: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  trendText: {
    fontSize: 12,
    color: '#666',
    marginLeft: 4,
  },
  metricLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 12,
  },
  targetInfo: {
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    paddingTop: 12,
  },
  targetText: {
    fontSize: 12,
    color: '#999',
  },
  avgProcess: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  avgProcessText: {
    fontSize: 12,
    color: '#666',
  },
  avgProcessTime: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#333',
  },
  normalRange: {
    fontSize: 12,
    color: '#4CAF50',
    fontStyle: 'italic',
  },
  countersSection: {
    padding: 20,
    paddingTop: 0,
  },
  counterCard: {
    backgroundColor: 'white',
    borderRadius: 15,
    padding: 20,
    marginBottom: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  counterHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  counterName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 4,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  running: {
    backgroundColor: '#4CAF50',
  },
  paused: {
    backgroundColor: '#FF9800',
  },
  statusText: {
    fontSize: 12,
    color: '#666',
  },
  waitingCount: {
    fontSize: 14,
    color: '#666',
  },
  tokenSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#f8f9fa',
    borderRadius: 10,
    padding: 15,
    marginBottom: 20,
  },
  tokenInfo: {
    alignItems: 'center',
  },
  tokenLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
  tokenValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  counterActions: {
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
  pauseAction: {
    backgroundColor: '#FF9800',
  },
  resumeAction: {
    backgroundColor: '#4CAF50',
  },
  callAction: {
    backgroundColor: '#2196F3',
  },
  serveAction: {
    backgroundColor: '#4CAF50',
  },
  actionButtonText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  distributionSection: {
    padding: 20,
    paddingTop: 0,
  },
  distributionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 15,
  },
  distributionCard: {
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
  distributionSectionLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  distributionCount: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#333',
  },
  managementSection: {
    padding: 20,
    paddingTop: 0,
    paddingBottom: 40,
    flexDirection: 'row',
    gap: 10,
  },
  completedSection: {
    padding: 20,
    paddingTop: 0,
    paddingBottom: 20,
  },
  completedCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'white',
    padding: 15,
    borderRadius: 12,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
  },
  completedLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 15,
  },
  completedToken: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#667eea',
    width: 60,
  },
  completedInfo: {
    gap: 2,
  },
  completedQueue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  completedUser: {
    fontSize: 12,
    color: '#999',
  },
  completedRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  completedTime: {
    fontSize: 12,
    color: '#666',
  },
  headerRightInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  deleteButton: {
    padding: 4,
  },
  emptyCompleted: {
    padding: 20,
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    borderStyle: 'dashed',
    borderWidth: 1,
    borderColor: '#ccc',
  },
  emptyCompletedText: {
    color: '#999',
    fontSize: 14,
  },
  managementButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 15,
    borderRadius: 10,
    gap: 10,
  },
  viewUsersButton: {
    backgroundColor: '#FF9800',
  },
  managementButtonText: {
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
    maxHeight: '80%',
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
  typeButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  typeButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#f5f5f5',
  },
  typeButtonActive: {
    backgroundColor: '#667eea',
  },
  typeButtonText: {
    fontSize: 12,
    color: '#666',
  },
  typeButtonTextActive: {
    color: 'white',
    fontWeight: '600',
  },
  sectionButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  sectionButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sectionButtonActive: {
    backgroundColor: '#667eea',
  },
  sectionButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
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