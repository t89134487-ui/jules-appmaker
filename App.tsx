import React, { useState, useEffect } from 'react';
import { StyleSheet, View, SafeAreaView, StatusBar, Text, TouchableOpacity, ActivityIndicator, Platform, BackHandler } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LoginScreen } from './src/screens/LoginScreen';
import { ApiKeyScreen } from './src/screens/ApiKeyScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { ChatScreen } from './src/screens/ChatScreen';
import { BuildStatusScreen } from './src/screens/BuildStatusScreen';
import { IntegrationScreen } from './src/screens/IntegrationScreen';
import { GitHubService, GitHubRepo } from './src/services/github';
import { JulesService, JulesSource, JulesActivity } from './src/services/jules';
import { logger } from './src/services/logger';

type Screen = 'LOGIN' | 'API_KEY' | 'DASHBOARD' | 'CHAT' | 'BUILD_STATUS' | 'INTEGRATION';

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<Screen>('LOGIN');
  const [restoring, setRestoring] = useState(true);

  // App tokens & selected states
  const [githubToken, setGithubToken] = useState<string>('');
  const [julesApiKey, setJulesApiKey] = useState<string>('');
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [hasExistingSessions, setHasExistingSessions] = useState<boolean>(false);
  const [pendingMessageToSend, setPendingMessageToSend] = useState<string | null>(null);

  // In-memory runtime cache for DashboardScreen & ChatScreen
  const [cachedRepos, setCachedRepos] = useState<GitHubRepo[]>([]);
  const [cachedSessions, setCachedSessions] = useState<any[]>([]);
  const [cachedSources, setCachedSources] = useState<JulesSource[]>([]);
  const [cachedActivities, setCachedActivities] = useState<Record<string, JulesActivity[]>>({});

  // Listen to Android hardware back press to navigate back inside the app
  useEffect(() => {
    const handleBackPress = () => {
      if (currentScreen === 'API_KEY') {
        setCurrentScreen('LOGIN');
        return true;
      }
      if (currentScreen === 'CHAT') {
        setCurrentScreen('DASHBOARD');
        return true;
      }
      if (currentScreen === 'INTEGRATION') {
        setCurrentScreen('CHAT');
        return true;
      }
      if (currentScreen === 'BUILD_STATUS') {
        setCurrentScreen('CHAT');
        return true;
      }
      return false;
    };

    const subscription = BackHandler.addEventListener('hardwareBackPress', handleBackPress);
    return () => subscription.remove();
  }, [currentScreen]);

  // Restore credentials on boot
  useEffect(() => {
    const restoreCredentials = async () => {
      try {
        logger.info('Restoring persisted credentials from AsyncStorage...');
        const storedGh = await AsyncStorage.getItem('@github_token');
        const storedJules = await AsyncStorage.getItem('@jules_api_key');

        if (storedGh) {
          logger.info('Found persisted GitHub token.');
          setGithubToken(storedGh);
          if (storedJules) {
            logger.info('Found persisted Jules API key. Routing to Dashboard.');
            setJulesApiKey(storedJules);
            setCurrentScreen('DASHBOARD');
          } else {
            logger.info('Jules API key missing. Routing to ApiKeyScreen.');
            setCurrentScreen('API_KEY');
          }
        } else {
          logger.info('No credentials found. Routing to LoginScreen.');
        }
      } catch (e: any) {
        logger.error(`Failed to restore credentials: ${e.message}`);
      } finally {
        setRestoring(false);
      }
    };

    restoreCredentials();
  }, []);

  // Initialize Services
  const githubService = githubToken ? new GitHubService(githubToken) : null;
  const julesService = julesApiKey ? new JulesService(julesApiKey) : null;

  const handleLoginSuccess = async (token: string) => {
    try {
      logger.info('Saving GitHub token to AsyncStorage...');
      await AsyncStorage.setItem('@github_token', token);
      setGithubToken(token);
      setCurrentScreen('API_KEY');
    } catch (e: any) {
      logger.error(`Failed to save GitHub token: ${e.message}`);
    }
  };

  const handleApiKeySuccess = async (key: string) => {
    try {
      logger.info('Saving Jules API key to AsyncStorage...');
      await AsyncStorage.setItem('@jules_api_key', key);
      setJulesApiKey(key);
      setCurrentScreen('DASHBOARD');
    } catch (e: any) {
      logger.error(`Failed to save Jules API key: ${e.message}`);
    }
  };

  const handleSelectRepo = (repo: GitHubRepo, sessionId?: string, existing?: boolean) => {
    setSelectedRepo(repo);
    if (sessionId) {
      setActiveSessionId(sessionId);
    } else {
      setActiveSessionId(null);
    }
    setHasExistingSessions(!!existing);
    setCurrentScreen('CHAT');
  };

  const handleLogout = async () => {
    try {
      logger.info('Logging out. Clearing keys from AsyncStorage...');
      await AsyncStorage.removeItem('@github_token');
      await AsyncStorage.removeItem('@jules_api_key');
    } catch (e: any) {
      logger.error(`Logout AsyncStorage clear failed: ${e.message}`);
    }
    setGithubToken('');
    setJulesApiKey('');
    setSelectedRepo(null);
    setActiveSessionId(null);
    setCurrentScreen('LOGIN');
  };

  // Keep track of active session state to know if builds have started
  const [activeSessionState, setActiveSessionState] = useState<string | null>(null);

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
            julesService={julesService}
            repos={cachedRepos}
            setRepos={setCachedRepos}
            allSessions={cachedSessions}
            setAllSessions={setCachedSessions}
            connectedSources={cachedSources}
            setConnectedSources={setCachedSources}
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
              gitHubService={githubService}
              selectedRepo={selectedRepo}
              initialSessionId={activeSessionId}
              hasExistingSessions={hasExistingSessions}
              initialMessage={pendingMessageToSend}
              onClearInitialMessage={() => setPendingMessageToSend(null)}
              activities={activeSessionId ? (cachedActivities[activeSessionId] || []) : []}
              setActivities={(acts) => {
                if (activeSessionId) {
                  setCachedActivities((prev) => ({ ...prev, [activeSessionId]: acts }));
                }
              }}
              onSessionStarted={(id) => setActiveSessionId(id)}
              onSessionStateFetched={(state) => setActiveSessionState(state)}
              onViewBuildProgress={() => setCurrentScreen('BUILD_STATUS')}
              onStartIntegration={() => setCurrentScreen('INTEGRATION')}
              onBack={() => setCurrentScreen('DASHBOARD')}
            />
          </View>
        );
      case 'INTEGRATION':
        if (!githubService || !selectedRepo) return null;
        return (
          <IntegrationScreen
            githubService={githubService}
            selectedRepo={selectedRepo}
            onMergeComplete={(commitSha) => {
              setCurrentScreen('BUILD_STATUS');
            }}
            onFixMergeConflict={(msg) => {
              setPendingMessageToSend(msg);
              setCurrentScreen('CHAT');
            }}
            onBack={() => setCurrentScreen('CHAT')}
          />
        );
      case 'BUILD_STATUS':
        if (!githubService || !selectedRepo) return null;
        return (
          <BuildStatusScreen
            githubService={githubService}
            repoOwner={selectedRepo.owner.login}
            repoName={selectedRepo.name}
            defaultBranch={selectedRepo.default_branch}
            onBack={() => setCurrentScreen('CHAT')}
          />
        );
      default:
        return null;
    }
  };

  if (restoring) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="light-content" backgroundColor="#121214" />
        <View style={styles.restoreLoading}>
          <ActivityIndicator size="large" color="#6200ee" />
          <Text style={styles.restoreText}>Restoring session keys...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#121214" />
      <View style={styles.container}>
        {renderScreen()}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#121214',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
    paddingBottom: Platform.OS === 'android' ? 16 : 0, // Clears the Android flick-to-home gesture navigation bar
  },
  container: {
    flex: 1,
    backgroundColor: '#121214',
  },
  restoreLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#121214',
  },
  restoreText: {
    color: '#a0a0ab',
    marginTop: 16,
    fontSize: 15,
  },
  flex: {
    flex: 1,
  },
});
