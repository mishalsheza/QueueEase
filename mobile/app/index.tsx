// app/index.tsx - Landing/Home page
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

export default function HomeScreen() {
  return (
    <LinearGradient
      colors={['#667eea', '#764ba2']}
      style={styles.container}
    >
      <View style={styles.content}>
        <View style={styles.logoContainer}>
          <View style={styles.logo}>
            <Ionicons name="list" size={60} color="white" />
          </View>
          <Text style={styles.appName}>QueueEase</Text>
          <Text style={styles.tagline}>
            Smart Queue Management System
          </Text>
        </View>

        <View style={styles.optionsContainer}>
          <Text style={styles.chooseText}>Welcome</Text>

          {/* One login for everyone; the server decides user vs admin. */}
          <TouchableOpacity
            style={styles.optionButton}
            onPress={() => router.push('/auth/login')}
          >
            <View style={[styles.optionIcon, styles.userIcon]}>
              <Ionicons name="log-in-outline" size={30} color="#2196F3" />
            </View>
            <View style={styles.optionText}>
              <Text style={styles.optionTitle}>Log in</Text>
              <Text style={styles.optionDescription}>
                Users and admins sign in here
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={24} color="#666" />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.optionButton}
            onPress={() => router.push('/auth/signup')}
          >
            <View style={[styles.optionIcon, styles.signupIcon]}>
              <Ionicons name="person-add" size={30} color="#2E7D32" />
            </View>
            <View style={styles.optionText}>
              <Text style={styles.optionTitle}>Sign up</Text>
              <Text style={styles.optionDescription}>
                Create an account to join queues
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={24} color="#666" />
          </TouchableOpacity>
        </View>

        <View style={styles.footer} />
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingTop: 80,
    paddingHorizontal: 20,
    justifyContent: 'space-between',
  },
  logoContainer: {
    alignItems: 'center',
  },
  logo: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  appName: {
    fontSize: 42,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 8,
  },
  tagline: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.9)',
    textAlign: 'center',
  },
  optionsContainer: {
    backgroundColor: 'white',
    borderRadius: 20,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
  },
  chooseText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 20,
    textAlign: 'center',
  },
  optionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
    borderRadius: 15,
    padding: 20,
    marginBottom: 15,
  },
  optionIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 15,
  },
  userIcon: {
    backgroundColor: '#e3f2fd',
  },
  signupIcon: {
    backgroundColor: '#e8f5e9',
  },
  optionText: {
    flex: 1,
  },
  optionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 4,
  },
  optionDescription: {
    fontSize: 12,
    color: '#666',
  },
  footer: {
    paddingBottom: 40,
  },
});