// app/auth/signup.tsx - CORRECTED VERSION
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
} from 'react-native';
import { useState } from 'react';
import { router } from 'expo-router';
import { api, setAuthToken, saveToken } from '@/lib/api';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons as Icon } from '@expo/vector-icons';

export default function SignupScreen() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  
  const isPasswordMatch = password === confirmPassword || !confirmPassword;

const handleSignup = async () => {
  if (!name || !email || !password || !confirmPassword) {
    Alert.alert('Error', 'Please fill in all fields');
    return;
  }

  if (password !== confirmPassword) {
    Alert.alert('Error', 'Passwords do not match');
    return;
  }

  if (password.length < 6) {
    Alert.alert('Error', 'Password must be at least 6 characters');
    return;
  }

  setLoading(true);
  console.log('🔄 Starting signup process...');

  try {
    // Signup always creates a regular user; admins are created server-side.
    const userData = { name, email, password };
    
    console.log('📤 Signup payload:', userData);
    console.log('🌐 API URL:', api.defaults.baseURL);

    const res = await api.post('/auth/register', userData);
    
    console.log('✅ Signup response received:', res.data);
    const { token } = res.data;

    // Save token and set in headers
    await saveToken(token);
    setAuthToken(token);
    
    router.replace('/(tabs)/dashboard');
  } catch (err: any) {
    console.error('❌ Signup error details:', {
      message: err.message,
      response: err.response?.data,
      status: err.response?.status,
      config: err.config
    });
    
    const backendError = err.response?.data;
    let errorMessage = 'Could not create account';
    
    if (backendError?.message) {
      errorMessage = backendError.message;
      if (backendError.errors) {
        errorMessage += '\n' + backendError.errors.map((e: any) => 
          `${e.field}: ${e.message}`
        ).join('\n');
      }
    }
    
    Alert.alert('Signup Failed', errorMessage);
  } finally {
    setLoading(false);
  }
};
  const goToLogin = () => {
    router.push('/auth/login');
  };

  const goBack = () => {
    router.back();
  };

  return (
    <LinearGradient colors={['#667eea', '#764ba2']} style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.header}>
            <TouchableOpacity onPress={goBack} style={styles.backButton}>
              <Icon name="arrow-back" size={24} color="white" />
            </TouchableOpacity>
            <Text style={styles.title}>Create Account</Text>
            <View style={{ width: 40 }} />
          </View>

          <View style={styles.illustrationContainer}>
            <View style={styles.illustration}>
              <Icon name="person-add" size={80} color="white" />
            </View>
            <Text style={styles.welcomeText}>Join QueueEase Today</Text>
          </View>

          <View style={styles.formContainer}>
            <View style={styles.inputContainer}>
              <Icon name="person" size={20} color="#666" style={styles.inputIcon} />
              <TextInput
                placeholder="Full Name"
                value={name}
                onChangeText={setName}
                style={styles.input}
                placeholderTextColor="#999"
              />
            </View>

            <View style={styles.inputContainer}>
              <Icon name="email" size={20} color="#666" style={styles.inputIcon} />
              <TextInput
                placeholder="Email Address"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                style={styles.input}
                placeholderTextColor="#999"
              />
            </View>

            <View style={styles.inputContainer}>
              <Icon name="lock" size={20} color="#666" style={styles.inputIcon} />
              <TextInput
                placeholder="Password (min. 6 characters)"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                style={[styles.input, styles.passwordInput]}
                placeholderTextColor="#999"
              />
              <TouchableOpacity
                onPress={() => setShowPassword(!showPassword)}
                style={styles.eyeIcon}
              >
                <Icon
                  name={showPassword ? 'visibility-off' : 'visibility'}
                  size={20}
                  color="#666"
                />
              </TouchableOpacity>
            </View>

            <View style={[styles.inputContainer, !isPasswordMatch && styles.inputError]}>
              <Icon 
                name="lock" 
                size={20} 
                color={isPasswordMatch ? "#666" : "#FF5252"} 
                style={styles.inputIcon} 
              />
              <TextInput
                placeholder="Confirm Password"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry={!showConfirmPassword}
                style={[styles.input, styles.passwordInput]}
                placeholderTextColor="#999"
              />
              <TouchableOpacity
                onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                style={styles.eyeIcon}
              >
                <Icon
                  name={showConfirmPassword ? 'visibility-off' : 'visibility'}
                  size={20}
                  color={isPasswordMatch ? "#666" : "#FF5252"}
                />
              </TouchableOpacity>
            </View>
            {!isPasswordMatch && (
              <Text style={styles.errorText}>Passwords do not match</Text>
            )}

            <TouchableOpacity
              style={[styles.signupButton, loading && styles.signupButtonDisabled]}
              onPress={handleSignup}
              disabled={loading}
            >
              <Text style={styles.signupButtonText}>
                {loading ? 'Creating Account...' : 'Create Account'}
              </Text>
              {!loading && (
                <Icon name="check-circle" size={20} color="white" />
              )}
            </TouchableOpacity>

            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>Already have an account?</Text>
              <View style={styles.dividerLine} />
            </View>

            <TouchableOpacity style={styles.loginButton} onPress={goToLogin}>
              <Text style={styles.loginButtonText}>
                Login to Existing Account
              </Text>
              <Icon name="login" size={20} color="#4CAF50" />
            </TouchableOpacity>

            <Text style={styles.termsText}>
              By signing up, you agree to our{' '}
              <Text style={styles.termsLink}>Terms & Conditions</Text>
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 20,
  },
  backButton: {
    padding: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: 'white',
    textAlign: 'center',
    flex: 1,
  },
  illustrationContainer: {
    alignItems: 'center',
    marginVertical: 20,
  },
  illustration: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  welcomeText: {
    fontSize: 16,
    color: 'white',
    opacity: 0.9,
  },
  formContainer: {
    backgroundColor: 'white',
    marginHorizontal: 20,
    borderRadius: 20,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    marginBottom: 16,
    paddingHorizontal: 16,
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    paddingVertical: 16,
    fontSize: 16,
    color: '#333',
  },
  passwordInput: {
    paddingRight: 40,
  },
  eyeIcon: {
    position: 'absolute',
    right: 16,
  },
  signupButton: {
    backgroundColor: '#4CAF50',
    borderRadius: 12,
    paddingVertical: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    marginBottom: 24,
  },
  signupButtonDisabled: {
    backgroundColor: '#cccccc',
  },
  signupButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: '600',
    marginRight: 8,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#e0e0e0',
  },
  dividerText: {
    marginHorizontal: 16,
    color: '#999',
    fontSize: 14,
  },
  loginButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderWidth: 2,
    borderColor: '#4CAF50',
    borderRadius: 12,
    marginBottom: 20,
  },
  loginButtonText: {
    color: '#4CAF50',
    fontSize: 16,
    fontWeight: '600',
    marginRight: 8,
  },
  termsText: {
    textAlign: 'center',
    color: '#666',
    fontSize: 12,
    lineHeight: 18,
  },
  termsLink: {
    color: '#4CAF50',
    fontWeight: '500',
  },
  inputError: {
    borderColor: '#FF5252',
    borderWidth: 1,
  },
  errorText: {
    color: '#FF5252',
    fontSize: 12,
    marginTop: -10,
    marginBottom: 10,
    marginLeft: 4,
  },
});