import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import { CONFIG } from '../config';

WebBrowser.maybeCompleteAuthSession();

interface LoginScreenProps {
  onSuccess: (githubToken: string) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onSuccess }) => {
  const [patToken, setPatToken] = useState('');
  const [loading, setLoading] = useState(false);

  // Construct GitHub OAuth details
  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: CONFIG.GITHUB_CLIENT_ID,
      scopes: ['repo', 'workflow', 'read:user'],
      redirectUri: AuthSession.makeRedirectUri({
        scheme: 'julesapp',
        path: 'oauth',
      }),
    },
    {
      authorizationEndpoint: 'https://github.com/login/oauth/authorize',
      tokenEndpoint: 'https://github.com/login/oauth/access_token',
    }
  );

  React.useEffect(() => {
    if (response?.type === 'success' && response.authentication?.accessToken) {
      onSuccess(response.authentication.accessToken);
    }
  }, [response]);

  const handleOAuthLogin = async () => {
    if (CONFIG.GITHUB_CLIENT_ID === 'YOUR_GITHUB_CLIENT_ID_PLACEHOLDER') {
      Alert.alert(
        'OAuth Placeholder Detect',
        'OAuth Client ID is set to placeholder values. Please use the Personal Access Token (PAT) login below to test or enter your GitHub credentials in src/config.ts.'
      );
      return;
    }
    setLoading(true);
    try {
      await promptAsync();
    } catch (e: any) {
      Alert.alert('Login Failed', e.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePatLogin = () => {
    if (!patToken.trim()) {
      Alert.alert('Error', 'Please enter a valid Personal Access Token');
      return;
    }
    onSuccess(patToken.trim());
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Text style={styles.logo}>🤖 App Generator</Text>
          <Text style={styles.subtitle}>Build fully functional Android apps autonomously using Google Jules</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Method 1: Sign in with GitHub</Text>
          <Text style={styles.desc}>
            Quickly authenticate using your GitHub account. Ensure your OAuth App is configured.
          </Text>

          <TouchableOpacity
            style={styles.oauthButton}
            onPress={handleOAuthLogin}
            disabled={loading || !request}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.oauthButtonText}>🐱 Continue with GitHub OAuth</Text>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Method 2: Use Personal Access Token (PAT)</Text>
          <Text style={styles.desc}>
            Paste a GitHub PAT with 'repo' and 'workflow' scopes enabled. Perfect for local development or testing!
          </Text>

          <TextInput
            style={styles.input}
            placeholder="ghp_xxxxxxxxxxxx"
            placeholderTextColor="#888"
            secureTextEntry
            value={patToken}
            onChangeText={setPatToken}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <TouchableOpacity style={styles.patButton} onPress={handlePatLogin}>
            <Text style={styles.patButtonText}>Continue with Token</Text>
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
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#2e2e33',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  desc: {
    fontSize: 14,
    color: '#a0a0ab',
    lineHeight: 20,
    marginBottom: 16,
  },
  oauthButton: {
    backgroundColor: '#24292e',
    borderRadius: 8,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#444',
  },
  oauthButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
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
    marginBottom: 16,
  },
  patButton: {
    backgroundColor: '#6200ee',
    borderRadius: 8,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  patButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
