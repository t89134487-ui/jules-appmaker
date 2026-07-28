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

interface LoginScreenProps {
  onSuccess: (githubToken: string, julesApiKey: string) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onSuccess }) => {
  const [patToken, setPatToken] = useState('');
  const [apiKey, setApiKey] = useState('');

  const handleLogin = () => {
    if (!patToken.trim()) {
      Alert.alert('Error', 'Please enter your GitHub Personal Access Token (PAT)');
      return;
    }
    if (!apiKey.trim()) {
      Alert.alert('Error', 'Please enter your Google Jules API Key');
      return;
    }
    onSuccess(patToken.trim(), apiKey.trim());
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.logo}>🤖 App Generator</Text>
          <Text style={styles.subtitle}>
            Build standalone Android apps autonomously using Google Jules
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Set Up Credentials</Text>
          <Text style={styles.desc}>
            Enter your keys to connect Google Jules with your GitHub repositories. Keys are securely stored locally on your device.
          </Text>

          {/* GitHub Token Input */}
          <Text style={styles.label}>1. GitHub Personal Access Token (PAT)</Text>
          <TextInput
            style={styles.input}
            placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxx"
            placeholderTextColor="#888"
            secureTextEntry
            value={patToken}
            onChangeText={setPatToken}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={styles.hint}>
            Requires 'repo' and 'workflow' scopes enabled.
          </Text>

          {/* Jules API Key Input */}
          <Text style={styles.label}>2. Google Jules API Key</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter your Google Jules API Key..."
            placeholderTextColor="#888"
            secureTextEntry
            value={apiKey}
            onChangeText={setApiKey}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={styles.hint}>
            Obtain from jules.google.com/settings/api.
          </Text>

          {/* Submit Button */}
          <TouchableOpacity style={styles.button} onPress={handleLogin}>
            <Text style={styles.buttonText}>Save & Continue</Text>
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
    marginBottom: 32,
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
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  desc: {
    fontSize: 14,
    color: '#a0a0ab',
    lineHeight: 20,
    marginBottom: 24,
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
    marginBottom: 6,
  },
  hint: {
    fontSize: 11,
    color: '#71717a',
    marginBottom: 20,
    lineHeight: 16,
  },
  button: {
    backgroundColor: '#6200ee',
    borderRadius: 8,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
