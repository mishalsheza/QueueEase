// app/test-api.tsx
import { View, Text, Button } from 'react-native';
import { api } from '@/lib/api';
import { useEffect, useState } from 'react';

export default function TestApiScreen() {
  const [status, setStatus] = useState<string>('Testing...');
  
  const testConnection = async () => {
    try {
      console.log('Testing connection to:', api.defaults.baseURL);
      const response = await api.get('/test');
      console.log('Response:', response.data);
      setStatus(`✅ Connected! ${JSON.stringify(response.data)}`);
    } catch (error: any) {
      console.error('Connection failed:', error);
      setStatus(`❌ Failed: ${error.message}`);
    }
  };

  useEffect(() => {
    testConnection();
  }, []);

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
      <Text style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 20 }}>
        API Connection Test
      </Text>
      <Text style={{ marginBottom: 20, textAlign: 'center' }}>
        {status}
      </Text>
      <Button title="Test Again" onPress={testConnection} />
    </View>
  );
}