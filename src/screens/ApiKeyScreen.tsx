import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';

interface ApiKeyScreenProps {
  onSuccess: (apiKey: string) => void;
  onBack: () => void;
}

export const ApiKeyScreen: React.FC<ApiKeyScreenProps> = ({ onSuccess, onBack }) => {
  const [key, setKey] = useState('');

  const handleSave = () => {
    if (!key.trim()) {
      Alert.alert('Error', 'Please enter your Jules API Key');
      return;
    }
    onSuccess(key.trim());
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Text style={styles.logo}>🔐 Jules API Key</Text>
          <Text style={styles.subtitle}>
            Enter your Jules API Key to authorize the app generation process.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Your API Key</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter Jules API key..."
            placeholderTextColor="#888"
            secureTextEntry
            value={key}
            onChangeText={setKey}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={styles.hint}>
            Your key remains local in your session space. You can obtain your API key from jules.google.com/settings.
          </Text>

          <TouchableOpacity style={styles.button} onPress={handleSave}>
            <Text style={styles.buttonText}>Continue to Dashboard</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.backButton} onPress={onBack}>
            <Text style={styles.backButtonText}>← Back to Login</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121214',
  },
  scroll: {
    padding: 24,
    justifyContent: 'center',
    flexGrow: 1,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logo: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 16,
    color: '#a0a0ab',
    textAlign: 'center',
    lineHeight: 24,
  },
  card: {
    backgroundColor: '#1c1c1f',
    borderRadius: 12,
    padding: 24,
    borderWidth: 1,
    borderColor: '#2e2e33',
  },
  label: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: '#121214',
    borderWidth: 1,
    borderColor: '#3a3a40',
    borderRadius: 8,
    color: '#fff',
    height: 48,
    paddingHorizontal: 16,
    fontSize: 15,
    marginBottom: 12,
  },
  hint: {
    fontSize: 12,
    color: '#71717a',
    lineHeight: 18,
    marginBottom: 24,
  },
  button: {
    backgroundColor: '#6200ee',
    borderRadius: 8,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  backButton: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  backButtonText: {
    color: '#a0a0ab',
    fontSize: 14,
  },
});
