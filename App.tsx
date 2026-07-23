import React, { useState } from 'react';
import { StyleSheet, View, SafeAreaView, StatusBar, Text, TouchableOpacity } from 'react-native';
import { LoginScreen } from './src/screens/LoginScreen';
import { ApiKeyScreen } from './src/screens/ApiKeyScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { ChatScreen } from './src/screens/ChatScreen';
import { BuildStatusScreen } from './src/screens/BuildStatusScreen';
import { GitHubService, GitHubRepo } from './src/services/github';
import { JulesService } from './src/services/jules';

type Screen = 'LOGIN' | 'API_KEY' | 'DASHBOARD' | 'CHAT' | 'BUILD_STATUS';

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<Screen>('LOGIN');

  // App tokens & selected states
  const [githubToken, setGithubToken] = useState<string>('');
  const [julesApiKey, setJulesApiKey] = useState<string>('');
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // Initialize Services
  const githubService = githubToken ? new GitHubService(githubToken) : null;
  const julesService = julesApiKey ? new JulesService(julesApiKey) : null;

  const handleLoginSuccess = (token: string) => {
    setGithubToken(token);
    setCurrentScreen('API_KEY');
  };

  const handleApiKeySuccess = (key: string) => {
    setJulesApiKey(key);
    setCurrentScreen('DASHBOARD');
  };

  const handleSelectRepo = (repo: GitHubRepo) => {
    setSelectedRepo(repo);
    setCurrentScreen('CHAT');
  };

  const handleLogout = () => {
    setGithubToken('');
    setJulesApiKey('');
    setSelectedRepo(null);
    setActiveSessionId(null);
    setCurrentScreen('LOGIN');
  };

  const renderScreen = () => {
    switch (currentScreen) {
      case 'LOGIN':
        return <LoginScreen onSuccess={handleLoginSuccess} />;
      case 'API_KEY':
        return (
          <ApiKeyScreen
            onSuccess={handleApiKeySuccess}
            onBack={() => setCurrentScreen('LOGIN')}
          />
        );
      case 'DASHBOARD':
        if (!githubService) return null;
        return (
          <DashboardScreen
            githubService={githubService}
            onSelectRepo={handleSelectRepo}
            onLogout={handleLogout}
          />
        );
      case 'CHAT':
        if (!julesService || !selectedRepo) return null;
        return (
          <View style={styles.flex}>
            <ChatScreen
              julesService={julesService}
              selectedRepo={selectedRepo}
              onSessionStarted={(id) => setActiveSessionId(id)}
              onBack={() => setCurrentScreen('DASHBOARD')}
            />
            {activeSessionId && (
              <TouchableOpacity
                style={styles.floatingBuildBtn}
                onPress={() => setCurrentScreen('BUILD_STATUS')}
              >
                <Text style={styles.floatingBuildText}>🚀 View APK Build Progress</Text>
              </TouchableOpacity>
            )}
          </View>
        );
      case 'BUILD_STATUS':
        if (!githubService || !selectedRepo) return null;
        return (
          <BuildStatusScreen
            githubService={githubService}
            repoOwner={selectedRepo.owner.login}
            repoName={selectedRepo.name}
            onBack={() => setCurrentScreen('CHAT')}
          />
        );
      default:
        return null;
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#121214" />
      <View style={styles.container}>{renderScreen()}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#121214',
  },
  container: {
    flex: 1,
    backgroundColor: '#121214',
  },
  flex: {
    flex: 1,
  },
  floatingBuildBtn: {
    backgroundColor: '#10b981',
    paddingVertical: 14,
    alignItems: 'center',
    borderTopWidth: 1,
    borderColor: '#059669',
  },
  floatingBuildText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 15,
  },
});
