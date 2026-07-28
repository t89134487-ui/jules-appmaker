import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  SafeAreaView,
  StatusBar,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Modal,
  Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { WebView } from 'react-native-webview';
import { LoginScreen } from './src/screens/LoginScreen';
import { BuildStatusScreen } from './src/screens/BuildStatusScreen';
import { GitHubService } from './src/services/github';
import { JulesService } from './src/services/jules';
import { logger } from './src/services/logger';

export default function App() {
  const [restoring, setRestoring] = useState(true);

  // App tokens
  const [githubToken, setGithubToken] = useState<string>('');
  const [julesApiKey, setJulesApiKey] = useState<string>('');

  // Modals / Sessions state
  const [buildsModalVisible, setBuildsModalVisible] = useState(false);
  const [mergedSessionIds, setMergedSessionIds] = useState<string[]>([]);
  const [completedUnmergedSessions, setCompletedUnmergedSessions] = useState<any[]>([]);
  const [merging, setMerging] = useState(false);

  // Restore credentials and merged session list on boot
  useEffect(() => {
    const restoreCredentials = async () => {
      try {
        logger.info('Restoring persisted credentials from AsyncStorage...');
        const storedGh = await AsyncStorage.getItem('@github_token');
        const storedJules = await AsyncStorage.getItem('@jules_api_key');
        const storedMerged = await AsyncStorage.getItem('@merged_session_ids');

        if (storedGh) {
          setGithubToken(storedGh);
        }
        if (storedJules) {
          setJulesApiKey(storedJules);
        }
        if (storedMerged) {
          setMergedSessionIds(JSON.parse(storedMerged));
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

  const handleLoginSuccess = async (token: string, apiKey: string) => {
    try {
      logger.info('Saving GitHub token and Jules API Key to AsyncStorage...');
      await AsyncStorage.setItem('@github_token', token);
      await AsyncStorage.setItem('@jules_api_key', apiKey);
      setGithubToken(token);
      setJulesApiKey(apiKey);
    } catch (e: any) {
      logger.error(`Failed to save credentials: ${e.message}`);
    }
  };

  const handleLogout = async () => {
    try {
      logger.info('Logging out. Clearing keys from AsyncStorage...');
      await AsyncStorage.removeItem('@github_token');
      await AsyncStorage.removeItem('@jules_api_key');
      await AsyncStorage.removeItem('@merged_session_ids');
    } catch (e: any) {
      logger.error(`Logout AsyncStorage clear failed: ${e.message}`);
    }
    setGithubToken('');
    setJulesApiKey('');
    setMergedSessionIds([]);
    setCompletedUnmergedSessions([]);
    setBuildsModalVisible(false);
  };

  const markSessionAsMerged = async (sessionId: string) => {
    try {
      const updated = [...mergedSessionIds, sessionId];
      setMergedSessionIds(updated);
      await AsyncStorage.setItem('@merged_session_ids', JSON.stringify(updated));
    } catch (e) {
      console.warn('Failed to save merged session ID', e);
    }
  };

  const runRebaseMerge = async (repoOwner: string, repoName: string, defaultBranch: string) => {
    if (!githubService) return;
    try {
      logger.info(`runRebaseMerge: Checking branches for ${repoOwner}/${repoName}...`);
      const branches = await githubService.getBranches(repoOwner, repoName);

      for (const branch of branches) {
        const branchName = branch.name;
        if (branchName.startsWith('jules-') && branchName !== defaultBranch) {
          logger.info(`runRebaseMerge: Detected development branch "${branchName}". Creating PR...`);
          try {
            const openPrs = await githubService.getOpenPullRequests(repoOwner, repoName);
            let pr = openPrs.find((p: any) => p.head && p.head.ref === branchName);

            if (!pr) {
              pr = await githubService.createPullRequest(
                repoOwner,
                repoName,
                `Merge Jules development branch "${branchName}"`,
                branchName,
                defaultBranch
              );
            }

            const prNumber = pr.number;
            logger.info(`runRebaseMerge: Merging PR #${prNumber} via rebase...`);
            await githubService.mergePullRequest(repoOwner, repoName, prNumber, 'rebase');
            logger.info(`runRebaseMerge: PR #${prNumber} merged successfully via rebase!`);

            // Delete branch
            try {
              await githubService.deleteBranch(repoOwner, repoName, branchName);
              logger.info(`runRebaseMerge: Branch "${branchName}" deleted quietly.`);
            } catch (deleteErr: any) {
              logger.warn(`runRebaseMerge: Branch deletion skipped: ${deleteErr.message}`);
            }
          } catch (err: any) {
            logger.error(`runRebaseMerge failed for branch "${branchName}": ${err.message}`);
          }
        }
      }
    } catch (e: any) {
      logger.error(`runRebaseMerge failed to list branches: ${e.message}`);
    }
  };

  // Poll Jules sessions to discover completed, unmerged tasks
  useEffect(() => {
    if (!julesService || !githubService) return;

    const fetchSessions = async () => {
      try {
        const sessions = await julesService.getSessions();
        const completedUnmerged = sessions.filter(
          (sess) => sess.state?.toUpperCase() === 'COMPLETED' && !mergedSessionIds.includes(sess.id)
        );
        setCompletedUnmergedSessions(completedUnmerged);
      } catch (e: any) {
        logger.error(`Poller error: ${e.message}`);
      }
    };

    fetchSessions();
    const interval = setInterval(fetchSessions, 8000); // Poll every 8 seconds

    return () => clearInterval(interval);
  }, [julesService, githubService, mergedSessionIds]);

  const handleShowApkAndMerge = async () => {
    if (completedUnmergedSessions.length === 0) return;
    setMerging(true);

    try {
      for (const sess of completedUnmergedSessions) {
        const sourceCtx = (sess as any).sourceContext?.source || '';
        const cleaned = sourceCtx.replace(/^sources\//, '');
        if (cleaned.startsWith('github-')) {
          const parts = cleaned.substring(7).split('-');
          if (parts.length >= 2) {
            const repoOwner = parts[0];
            const repoName = parts.slice(1).join('-');
            const defaultBranch = 'main';

            logger.info(`Merging changes for completed session "${sess.id}" on repo "${repoOwner}/${repoName}"...`);

            // Execute the rebase merge
            await runRebaseMerge(repoOwner, repoName, defaultBranch);

            // Mark as merged
            await markSessionAsMerged(sess.id);
          }
        }
      }

      // Refresh list
      setCompletedUnmergedSessions([]);

      // Transition to APK downloads modal
      setBuildsModalVisible(true);
    } catch (e: any) {
      Alert.alert('Merge Failed', e.message);
    } finally {
      setMerging(false);
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

  const isLoggedIn = githubToken && julesApiKey;
  const showApkVisible = completedUnmergedSessions.length > 0;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#121214" />
      <View style={styles.container}>
        {isLoggedIn ? (
          <View style={styles.flex}>
            {/* Embedded native jules.google.com chat */}
            <WebView
              source={{ uri: 'https://jules.google.com' }}
              style={styles.webView}
              startInLoadingState={true}
              renderLoading={() => (
                <View style={styles.webViewLoading}>
                  <ActivityIndicator size="large" color="#6200ee" />
                  <Text style={styles.webViewLoadingText}>Loading Google Jules...</Text>
                </View>
              )}
            />

            {/* Floating Action Buttons */}
            <View style={styles.fabContainer}>
              {showApkVisible ? (
                <TouchableOpacity
                  style={styles.fabShowApk}
                  onPress={handleShowApkAndMerge}
                  disabled={merging}
                >
                  {merging ? (
                    <ActivityIndicator color="#fff" style={{ marginRight: 8 }} />
                  ) : null}
                  <Text style={styles.fabShowApkText}>
                    {merging ? 'Merging changes...' : '📦 Show APK'}
                  </Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={styles.fabBuilds}
                  onPress={() => setBuildsModalVisible(true)}
                >
                  <Text style={styles.fabBuildsText}>🛠️ Builds & Downloads</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity style={styles.fabLogout} onPress={handleLogout}>
                <Text style={styles.fabLogoutText}>Logout</Text>
              </TouchableOpacity>
            </View>

            {/* Modal for 1-Click APK Download and Build Tracking */}
            <Modal
              visible={buildsModalVisible}
              animationType="slide"
              transparent={false}
              onRequestClose={() => setBuildsModalVisible(false)}
            >
              <SafeAreaView style={styles.safeAreaModal}>
                {githubService && (
                  <BuildStatusScreen
                    githubService={githubService}
                    onBack={() => setBuildsModalVisible(false)}
                  />
                )}
              </SafeAreaView>
            </Modal>
          </View>
        ) : (
          <LoginScreen onSuccess={handleLoginSuccess} />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#121214',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
    paddingBottom: Platform.OS === 'android' ? 16 : 0,
  },
  safeAreaModal: {
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
  webView: {
    flex: 1,
    backgroundColor: '#121214',
  },
  webViewLoading: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#121214',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
  },
  webViewLoadingText: {
    color: '#a0a0ab',
    marginTop: 12,
    fontSize: 14,
  },
  fabContainer: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    left: 24,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    pointerEvents: 'box-none',
  },
  fabShowApk: {
    backgroundColor: '#10b981',
    borderRadius: 24,
    paddingVertical: 12,
    paddingHorizontal: 20,
    shadowColor: '#10b981',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 5,
    elevation: 6,
    flexDirection: 'row',
    alignItems: 'center',
  },
  fabShowApkText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  fabBuilds: {
    backgroundColor: '#6200ee',
    borderRadius: 24,
    paddingVertical: 12,
    paddingHorizontal: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 6,
    flexDirection: 'row',
    alignItems: 'center',
  },
  fabBuildsText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  fabLogout: {
    backgroundColor: '#2e2e33',
    borderColor: '#3e3e44',
    borderWidth: 1,
    borderRadius: 20,
    paddingVertical: 10,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 4,
  },
  fabLogoutText: {
    color: '#ef4444',
    fontWeight: 'bold',
    fontSize: 12,
  },
});
