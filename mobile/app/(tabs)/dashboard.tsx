// app/(tabs)/dashboard.tsx
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  Dimensions,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons, MaterialIcons, FontAwesome5 } from '@expo/vector-icons';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { showAlert } from '@/lib/notify';
import { socket } from '@/lib/socket';

const { width } = Dimensions.get('window');

export default function HomeScreen() {
  const { signOut } = useAuth();
  const [activeTickets, setActiveTickets] = useState<any[]>([]);
  const [availableQueues, setAvailableQueues] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [joiningId, setJoiningId] = useState<string | null>(null);

  const fetchQueueData = async () => {
    setLoading(true);
    try {
      // 1. Fetch user's status (returns array of active tickets)
      const statusRes = await api.get('/queues/my-status');
      setActiveTickets(statusRes.data || []);

      // 2. Fetch all available queues
      const queuesRes = await api.get('/queues');
      setAvailableQueues(queuesRes.data);
    } catch (err) {
      console.error('Error fetching data:', err);
    } finally {
      setLoading(false);
    }
  };

  const joinQueue = async (queueId: string, qName: string) => {
    // Check if user is already in this specific queue
    const isAlreadyInQueue = activeTickets.some(t => t.queueId === queueId);
    if (isAlreadyInQueue) {
      showAlert("Already in this queue", `You already have an active ticket for ${qName}.`);
      return;
    }

    setJoiningId(queueId);
    try {
      await api.post(`/queues/${queueId}/join`);
      showAlert("Success", `Joined ${qName}!`);
      fetchQueueData(); // Refresh the dashboard to show the new ticket
    } catch (err: any) {
      console.error('Error joining queue:', err);
      showAlert("Error", err.response?.data?.message || "Failed to join queue");
    } finally {
      setJoiningId(null);
    }
  };

  useFocusEffect(
    useCallback(() => {
      fetchQueueData();
      
      // Connect specifically when screen is focused
      if (!socket.connected) {
        socket.connect();
      }
    }, [])
  );

  useEffect(() => {
    const onQueueUpdate = () => {
      console.log('🔄 Dashboard: Queue update received via socket');
      fetchQueueData();
    };

    socket.on('connect', () => {
      console.log('✅ Connected to socket server');
    });

    socket.on('queueUpdated', onQueueUpdate);

    return () => {
      socket.off('queueUpdated', onQueueUpdate);
    };
  }, []);

  const refreshQueue = () => {
    fetchQueueData();
  };

  const cancelTicket = (queueId: string, qName: string) => {
    console.log(`Requesting to cancel ticket for: ${queueId}`);
    
    const performCancel = async () => {
      console.log(`Confirmed cancel for: ${queueId}`);
      try {
        await api.post(`/queues/${queueId}/leave`);
        fetchQueueData();
        showAlert("Success", `You have left ${qName}.`);
      } catch (err) {
        console.error('Error leaving queue:', err);
        showAlert("Error", "Failed to cancel ticket.");
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm(`Are you sure you want to cancel your ticket for ${qName}?`)) {
        performCancel();
      }
    } else {
      showAlert(
        "Cancel Ticket",
        `Are you sure you want to cancel your ticket for ${qName}?`,
        [
          { text: "No", style: "cancel" },
          { text: "Yes, Cancel", style: "destructive", onPress: performCancel }
        ]
      );
    }
  };

  // signOut clears the session; the route guards then show the landing screen.
  const handleLogout = () => {
    showAlert("Logout", "Are you sure you want to logout?", [
      { text: "Cancel", style: "cancel" },
      { text: "Logout", style: "destructive", onPress: () => { signOut(); } },
    ]);
  };

  // Derive active and history tickets
  const currentTickets = activeTickets.filter(t => t.status === 'waiting' || t.status === 'serving');
  // Only show served tickets in history, hide cancelled ones as per user request
  const historyTickets = activeTickets.filter(t => t.status === 'served');

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <StatusBar barStyle="light-content" backgroundColor="#667eea" />
      
      {/* Hero Header */}
      <LinearGradient
        colors={['#667eea', '#764ba2']}
        style={styles.header}
      >
        <View style={styles.headerContent}>
          <Text style={styles.appTitle}>QueueEase</Text>
          <Text style={styles.appSubtitle}>
            Effortless Queue Management for Clinics, Colleges, Banks & More
          </Text>
          
          <View style={styles.loginButtons}>
            <TouchableOpacity 
              style={styles.userLoginButton}
              onPress={() => router.push('/(tabs)/profile')}
            >
              <Ionicons name="person" size={20} color="white" />
              <Text style={styles.loginButtonText}>Profile</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.logoutButton}
              onPress={handleLogout}
            >
              <Ionicons name="log-out-outline" size={20} color="white" />
              <Text style={styles.loginButtonText}>Logout</Text>
            </TouchableOpacity>

          </View>
        </View>
      </LinearGradient>

      {/* Active Tickets Section */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Your Active Queues</Text>
      </View>

      {currentTickets.length > 0 ? (
        currentTickets.map((ticket) => (
          <View key={ticket.queueId} style={styles.ticketCard}>
            <View style={styles.cardHeader}>
              <MaterialIcons name="assignment" size={24} color="#667eea" />
              <Text style={styles.cardTitle}>{ticket.queueName}</Text>
            </View>
            
            <View style={styles.ticketContent}>
              <View style={styles.tokenSection}>
                <Text style={styles.tokenLabel}>TOKEN</Text>
                <View style={styles.tokenDisplay}>
                  <Text style={styles.tokenText}>{ticket.token}</Text>
                </View>
              </View>
              
              <View style={styles.infoSection}>
                <View style={styles.infoColumn}>
                  <Text style={styles.infoLabel}>Position</Text>
                  <View style={[
                    styles.positionBadge,
                    ticket.status === 'serving' && { backgroundColor: '#e8f5e9' }
                  ]}>
                    <Text style={[
                      styles.positionText,
                      ticket.status === 'serving' && { color: '#2e7d32' }
                    ]}>
                      {ticket.status === 'serving' ? 'Proceed to Counter' : 
                       `${ticket.position}th in Line`}
                    </Text>
                  </View>
                </View>
                
                <View style={styles.divider} />
                
                <View style={styles.infoColumn}>
                  <Text style={styles.infoLabel}>Wait Time</Text>
                  <View style={styles.waitTimeBadge}>
                    <Text style={styles.waitTimeText}>~{ticket.estimatedWaitTime} min</Text>
                  </View>
                </View>
              </View>
              
              <View style={[
                styles.activeStatus,
                ticket.status === 'serving' && { backgroundColor: '#4CAF50' }
              ]}>
                <View style={styles.activeDot} />
                <Text style={styles.activeText}>{ticket.status ? ticket.status.toUpperCase() : 'ACTIVE'}</Text>
              </View>
              
              <View style={styles.servingSection}>
                <View style={styles.servingHeader}>
                  <Text style={styles.servingLabel}>NOW SERVING</Text>
                </View>
                <View style={styles.servingContent}>
                  <View style={styles.servingTokenContainer}>
                    <Text style={styles.servingToken}>Token {ticket.currentlyServing}</Text>
                  </View>
                  <View style={styles.counterContainer}>
                    <Text style={styles.counterLabel}>Counter</Text>
                    <Text style={styles.counterNumber}>{ticket.counter}</Text>
                  </View>
                </View>
              </View>
              
              <View style={styles.actionButtons}>
                <TouchableOpacity 
                  style={styles.refreshButton} 
                  onPress={refreshQueue}
                >
                  <Ionicons name="refresh" size={20} color="#667eea" />
                  <Text style={styles.refreshButtonText}>Refresh</Text>
                </TouchableOpacity>
                
                <TouchableOpacity 
                  style={styles.cancelButton} 
                  onPress={() => cancelTicket(ticket.queueId, ticket.queueName)}
                >
                  <MaterialIcons name="cancel" size={20} color="white" />
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ))
      ) : (
        <View style={styles.ticketCard}>
          <View style={styles.noTicketContainer}>
            <Ionicons name="time-outline" size={50} color="#ccc" />
            <Text style={styles.noTicketText}>No active queue ticket</Text>
          </View>
        </View>
      )}

      {/* History / Done Section */}
      {historyTickets.length > 0 && (
        <View>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>History</Text>
          </View>
          {historyTickets.map((ticket) => (
            <View key={ticket.queueId + ticket.token} style={[styles.ticketCard, styles.historyCard]}>
              <View style={styles.historyRow}>
                <View>
                  <Text style={styles.historyTitle}>{ticket.queueName}</Text>
                  <Text style={styles.historyToken}>Token: {ticket.token}</Text>
                </View>
                <View style={[
                  styles.statusBadge, 
                  ticket.status === 'served' ? styles.servedBadge : styles.cancelledBadge
                ]}>
                  <Text style={[
                      styles.statusText,
                      ticket.status === 'served' ? styles.servedText : styles.cancelledText
                  ]}>
                    {ticket.status === 'served' ? 'COMPLETED' : 'CANCELLED'}
                  </Text>
                </View>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Available Queues for Joining */}
      <View style={styles.joinableContainer}>
        <Text style={styles.joinHeading}>Join Another Service</Text>
        <View style={styles.availableSection}>
          {availableQueues.length > 0 ? (
            availableQueues.map((queue) => {
              const isInThisQueue = activeTickets.some(t => t.queueId === queue._id && (t.status === 'waiting' || t.status === 'serving'));
              return (
                <View key={queue._id} style={styles.queueCard}>
                  <View style={styles.queueInfo}>
                    <Text style={styles.queueName}>{queue.name}</Text>
                    <Text style={styles.queueStats}>
                      {queue.users?.length || 0} waiting
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[
                      styles.joinInlineButton,
                      isInThisQueue && styles.joinedInlineButton, // Changed style
                      joiningId === queue._id && styles.joinInlineButtonDisabled
                    ]}
                    onPress={() => {
                      if (!isInThisQueue) {
                        joinQueue(queue._id, queue.name);
                      }
                    }}
                    disabled={joiningId === queue._id || isInThisQueue}
                  >
                    <Text style={styles.joinInlineButtonText}>
                      {joiningId === queue._id ? '...' : isInThisQueue ? 'Joined' : 'Join'}
                    </Text>
                  </TouchableOpacity>
                </View>
              );
            })
          ) : (
            <Text style={styles.noQueuesText}>No active queues available.</Text>
          )}
        </View>
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
    paddingTop: 50,
    paddingBottom: 30,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
  },
  headerContent: {
    alignItems: 'center',
  },
  appTitle: {
    fontSize: 36,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 8,
  },
  appSubtitle: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.9)',
    textAlign: 'center',
    marginBottom: 25,
    lineHeight: 20,
  },
  loginButtons: {
    flexDirection: 'row',
    gap: 15,
  },
  userLoginButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 25,
    gap: 8,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 15,
    paddingVertical: 12,
    borderRadius: 25,
    gap: 8,
  },
  loginButtonText: {
    color: 'white',
    fontWeight: '600',
  },
  sectionHeader: {
    marginTop: 20,
    paddingHorizontal: 20,
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  ticketCard: {
    backgroundColor: 'white',
    borderRadius: 15,
    marginHorizontal: 20,
    marginTop: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 5,
  },
  historyCard: {
    padding: 15,
    borderLeftWidth: 5,
    borderLeftColor: '#ccc', // default
  },
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  historyTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  historyToken: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  servedBadge: {
    backgroundColor: '#E8F5E9',
  },
  cancelledBadge: {
    backgroundColor: '#FFEBEE',
  },
  statusText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  servedText: {
    color: '#2E7D32',
  },
  cancelledText: {
    color: '#C62828',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    paddingBottom: 10,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginLeft: 10,
    color: '#333',
  },
  ticketContent: {
    alignItems: 'center',
  },
  ticketNameText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 10,
    textAlign: 'center',
  },
  tokenSection: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 25,
  },
  tokenLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 5,
    fontWeight: '500',
  },
  tokenDisplay: {
    backgroundColor: '#667eea',
    paddingHorizontal: 30,
    paddingVertical: 12,
    borderRadius: 8,
    minWidth: 120,
    alignItems: 'center',
  },
  tokenText: {
    fontSize: 28,
    fontWeight: 'bold',
    color: 'white',
  },
  infoSection: {
    flexDirection: 'row',
    width: '100%',
    justifyContent: 'space-between',
    marginBottom: 25,
    paddingHorizontal: 10,
  },
  infoColumn: {
    flex: 1,
    alignItems: 'center',
  },
  divider: {
    width: 1,
    backgroundColor: '#ddd',
    height: '100%',
  },
  infoLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 8,
    fontWeight: '500',
  },
  positionBadge: {
    backgroundColor: '#f0f4ff',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    minWidth: 120,
    alignItems: 'center',
  },
  positionText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#667eea',
  },
  waitTimeBadge: {
    backgroundColor: '#f0f4ff',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    minWidth: 120,
    alignItems: 'center',
  },
  waitTimeText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#667eea',
  },
  activeStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    marginBottom: 25,
  },
  activeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#4CAF50',
    marginRight: 8,
  },
  activeText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#2E7D32',
  },
  servingSection: {
    width: '100%',
    backgroundColor: '#f8f9fa',
    borderRadius: 10,
    padding: 15,
    marginBottom: 25,
  },
  servingHeader: {
    alignItems: 'center',
    marginBottom: 15,
  },
  servingLabel: {
    fontSize: 12,
    color: '#666',
    fontWeight: '500',
  },
  servingContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  servingTokenContainer: {
    flex: 2,
    alignItems: 'center',
  },
  servingToken: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  counterContainer: {
    flex: 1,
    alignItems: 'center',
    borderLeftWidth: 1,
    borderLeftColor: '#ddd',
    paddingLeft: 15,
  },
  counterLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 5,
  },
  counterNumber: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#667eea',
  },
  actionButtons: {
    flexDirection: 'row',
    width: '100%',
    gap: 15,
  },
  refreshButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f0f4ff',
    paddingVertical: 15,
    borderRadius: 10,
    gap: 10,
  },
  refreshButtonText: {
    color: '#667eea',
    fontWeight: '600',
    fontSize: 16,
  },
  cancelButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FF5252',
    paddingVertical: 15,
    borderRadius: 10,
    gap: 10,
  },
  cancelButtonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 16,
  },
  noTicketContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  noTicketText: {
    fontSize: 16,
    color: '#999',
    marginTop: 10,
    marginBottom: 20,
  },
  getTicketButton: {
    backgroundColor: '#667eea',
    paddingHorizontal: 30,
    paddingVertical: 12,
    borderRadius: 25,
  },
  getTicketButtonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 16,
  },
  // Reusing these styles for the internal join list
  availableSection: {
    width: '100%',
    marginTop: 10,
  },

  queueCard: {
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    width: '100%',
  },
  queueInfo: {
    flex: 1,
  },
  queueName: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#333',
  },
  queueStats: {
    fontSize: 11,
    color: '#666',
  },
  joinInlineButton: {
    backgroundColor: '#667eea',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    marginLeft: 8,
  },
  joinedInlineButton: {
    backgroundColor: '#4CAF50', // Green to indicate joined
    opacity: 0.7,
  },
  joinInlineButtonDisabled: {
    backgroundColor: '#ccc',
  },
  joinInlineButtonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 12,
  },
  noQueuesText: {
    textAlign: 'center',
    color: '#999',
    fontSize: 14,
    marginTop: 10,
  },
  joinableContainer: {
    marginHorizontal: 20,
    marginTop: 25,
    marginBottom: 40,
    backgroundColor: 'white',
    borderRadius: 15,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 3,
  },
  joinHeading: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 15,
  },
});