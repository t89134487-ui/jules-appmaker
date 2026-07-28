import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Linking,
} from 'react-native';
import { WebView } from 'react-native-webview';
import * as ClipboardExpo from 'expo-clipboard';
import { JulesService, JulesSession } from '../services/jules';
import { GitHubRepo, GitHubService } from '../services/github';
import { logger } from '../services/logger';

interface ChatScreenProps {
  julesService: JulesService;
  gitHubService?: GitHubService | null; // Pass GitHub service for dynamic merge execution
  selectedRepo: GitHubRepo;
  initialSessionId?: string | null;
  hasExistingSessions?: boolean;
  onSessionStarted: (sessionId: string) => void;
  onSessionStateFetched?: (state: string) => void;
  onViewBuildProgress?: () => void;
  onBack: () => void;
}

export const ChatScreen: React.FC<ChatScreenProps> = ({
  julesService,
  gitHubService,
  selectedRepo,
  initialSessionId,
  hasExistingSessions,
  onSessionStarted,
  onSessionStateFetched,
  onViewBuildProgress,
  onBack,
}) => {
  const [session, setSession] = useState<JulesSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [initialPrompt, setInitialPrompt] = useState('');
  const [mergedBranches, setMergedBranches] = useState<Record<string, boolean>>({});

  interface LocalMergeStatus {
    id: string;
    text: string;
    createTime: string;
  }
  const [localMergeStatuses, setLocalMergeStatuses] = useState<LocalMergeStatus[]>([]);
  const [hasAttemptedMerge, setHasAttemptedMerge] = useState(false);
  const [buildTargetCommitSha, setBuildTargetCommitSha] = useState<string | null>(null);
  const [buildApkAsset, setBuildApkAsset] = useState<any | null>(null);

  const addMergeStatus = (status: string) => {
    setLocalMergeStatuses((prev) => [
      ...prev,
      {
        id: `local-merge-${Math.random()}-${Date.now()}`,
        text: status,
        createTime: new Date().toISOString(),
      },
    ]);
  };

  const fetchSessionState = async (id: string) => {
    try {
      const sess = await julesService.getSession(id);
      setSession(sess);
      if (onSessionStateFetched) {
        onSessionStateFetched(sess.state);
      }

      // Perform direct quiet merge if Jules has completed the task
      if (sess.state?.toUpperCase() === 'COMPLETED' && gitHubService && !hasAttemptedMerge) {
        setHasAttemptedMerge(true);
        try {
          logger.info('ChatScreen: Fetching repo branches to perform direct quiet merge...');
          addMergeStatus('Checking repository branches to integrate code...');
          const branches = await gitHubService.getBranches(selectedRepo.owner.login, selectedRepo.name);

          let matchedAnyBranch = false;
          for (const branch of branches) {
            const branchName = branch.name;

            // Look for any branch starting with 'jules-' that is not the default branch
            if (branchName.startsWith('jules-') && branchName !== selectedRepo.default_branch) {
              matchedAnyBranch = true;
              if (!mergedBranches[branchName]) {
                logger.info(`ChatScreen: Detected completed session branch "${branchName}". Triggering PR creation & rebase merge...`);
                addMergeStatus(`Integrating development branch "${branchName}" via rebase...`);

                // Immediately mark as merged locally to prevent concurrent/duplicate API requests
                setMergedBranches((prev) => ({ ...prev, [branchName]: true }));

                try {
                  // Fetch open PRs to see if one already exists
                  const openPrs = await gitHubService.getOpenPullRequests(selectedRepo.owner.login, selectedRepo.name);
                  let pr = openPrs.find((p: any) => p.head && p.head.ref === branchName);

                  if (!pr) {
                    logger.info(`ChatScreen: No open PR found for branch "${branchName}". Creating new PR...`);
                    addMergeStatus(`Creating integration Pull Request for "${branchName}"...`);
                    pr = await gitHubService.createPullRequest(
                      selectedRepo.owner.login,
                      selectedRepo.name,
                      `Merge Jules development branch "${branchName}"`,
                      branchName,
                      selectedRepo.default_branch
                    );
                  }

                  const prNumber = pr.number;
                  logger.info(`ChatScreen: Merging PR #${prNumber} via rebase...`);
                  addMergeStatus(`Performing fast-forward rebase merge for PR #${prNumber}...`);

                  const mergeResult = await gitHubService.mergePullRequest(
                    selectedRepo.owner.login,
                    selectedRepo.name,
                    prNumber,
                    'rebase'
                  );
                  logger.info(`ChatScreen: PR #${prNumber} merged successfully via rebase: ${JSON.stringify(mergeResult)}`);
                  addMergeStatus(`Rebase merge complete! Cleaning up development branch "${branchName}"...`);

                  // Delete the branch quietly to clean up references
                  try {
                    await gitHubService.deleteBranch(
                      selectedRepo.owner.login,
                      selectedRepo.name,
                      branchName
                    );
                    logger.info(`ChatScreen: Branch "${branchName}" deleted successfully quietly.`);
                    addMergeStatus(`Integrated "${branchName}" successfully via rebase and cleaned up branch.`);
                  } catch (deleteErr: any) {
                    logger.warn(`ChatScreen: Quiet branch deletion failed for "${branchName}": ${deleteErr.message}`);
                    addMergeStatus(`Integrated "${branchName}" successfully via rebase (cleanup skipped).`);
                  }

                  // After successful rebase merge, fetch the latest commit of the default branch to poll the build
                  try {
                    const latestSha = await gitHubService.getLatestCommitSha(
                      selectedRepo.owner.login,
                      selectedRepo.name,
                      selectedRepo.default_branch
                    );
                    logger.info(`ChatScreen: Set build target commit SHA to default branch head: ${latestSha}`);
                    setBuildTargetCommitSha(latestSha);
                  } catch (shaErr: any) {
                    logger.warn(`ChatScreen: Failed to retrieve default branch latest SHA: ${shaErr.message}`);
                  }
                } catch (mergeErr: any) {
                  logger.error(`ChatScreen: Rebase merge failed for branch "${branchName}": ${mergeErr.message}`);
                  addMergeStatus(`Failed to integrate branch: ${mergeErr.message}`);
                }
              }
            }
          }
          if (!matchedAnyBranch) {
            addMergeStatus('Code changes are already integrated into the default branch.');
          }
        } catch (e: any) {
          logger.warn(`ChatScreen: Failed to list/merge branches: ${e.message}`);
          addMergeStatus(`Branch integration lookup failed: ${e.message}`);
        }
      }
    } catch (e: any) {
      console.warn('Failed to poll session state', e);
    }
  };

  // Load existing session if specified on entry
  useEffect(() => {
    if (initialSessionId) {
      logger.info(`Resuming existing session thread: ${initialSessionId}`);
      setLoading(true);
      setLocalMergeStatuses([]);
      setHasAttemptedMerge(false);
      setBuildTargetCommitSha(null);
      setBuildApkAsset(null);
      fetchSessionState(initialSessionId)
        .then(() => {
          onSessionStarted(initialSessionId);
        })
        .finally(() => {
          setLoading(false);
        });
    } else {
      setSession(null);
      setLocalMergeStatuses([]);
      setHasAttemptedMerge(false);
      setBuildTargetCommitSha(null);
      setBuildApkAsset(null);
    }
  }, [initialSessionId]);

  // Poll active sessions (speed up to 5 seconds when running, 20 seconds when idle)
  useEffect(() => {
    if (!session) return;
    const isActivelyRunning = session.state !== 'COMPLETED' && session.state !== 'FAILED';
    const intervalMs = isActivelyRunning ? 5000 : 20000;

    const interval = setInterval(() => {
      fetchSessionState(session.id);
    }, intervalMs);

    return () => clearInterval(interval);
  }, [session?.id, session?.state]);

  const handleStartSession = async () => {
    if (!initialPrompt.trim()) {
      Alert.alert('Error', 'Please describe the app you want to build');
      return;
    }

    logger.info(`Starting session for repo: ${selectedRepo.owner.login}/${selectedRepo.name}`);
    setLoading(true);
    try {
      // Append core CI generation prompt instructions autonomously ONLY if the repo has no existing sessions!
      const augmentedPrompt = hasExistingSessions
        ? initialPrompt.trim()
        : `${initialPrompt.trim()}

      ## MANDATORY REQUIREMENTS
      - You have complete freedom to choose the best framework, language, or toolchain (such as Kotlin/Jetpack Compose, Flutter, React Native, etc.) to build this Android application.
      - Regardless of the framework you choose, you must create a complete GitHub Actions CI pipeline in \`.github/workflows/build-main-apk.yml\` to compile and package the app into a fully signed standalone Release APK.
      - Make sure the CI workflow builds and uploads this final APK as a Release Asset in a new GitHub release tag (e.g. upload to a release) so the user can easily install/download it.
      - Generate all necessary code scaffolding and project structure from scratch. Ensure a clean directory structure.
      - Once you complete writing the code, please make sure to merge your changes directly into the starting default branch (e.g. '${selectedRepo.default_branch}') so they are integrated instantly without leaving open Pull Requests.`;

      logger.info('Calling julesService.createSession()...');
      const newSession = await julesService.createSession({
        prompt: augmentedPrompt,
        repoOwner: selectedRepo.owner.login,
        repoName: selectedRepo.name,
        branch: selectedRepo.default_branch,
        requirePlanApproval: false,
      });

      logger.info(`Session created successfully. ID: ${newSession.id}. State: ${newSession.state}`);
      setLocalMergeStatuses([]);
      setHasAttemptedMerge(false);
      setBuildTargetCommitSha(null);
      setBuildApkAsset(null);
      setSession(newSession);
      onSessionStarted(newSession.id);
      logger.info('Fetching initial session state...');
      await fetchSessionState(newSession.id);
    } catch (e: any) {
      logger.error(`Failed to start Jules session: ${e.message}`);

      if (e.message.includes('404')) {
        Alert.alert(
          '🔌 Repository Not Connected',
          `Jules returned a 404 error ("Requested entity was not found") for this repository. \n\nThis means Jules does not have permission to access your repository yet.\n\nPlease go to jules.google.com/settings/api and connect "${selectedRepo.owner.login}/${selectedRepo.name}" as a source repository before starting.`,
          [{ text: 'OK' }]
        );
      } else {
        Alert.alert('Failed to Start Jules Session', e.message);
      }
    } finally {
      setLoading(false);
    }
  };

  // Poll for APK build completion in the background when buildTargetCommitSha is active
  useEffect(() => {
    if (!buildTargetCommitSha || buildApkAsset || !gitHubService) return;

    logger.info(`ChatScreen: Starting background poll for APK build of commit: ${buildTargetCommitSha}`);

    const checkApk = async () => {
      try {
        const shortSha = buildTargetCommitSha.substring(0, 7);
        const apk = await gitHubService.getApkAssetForCommit(
          selectedRepo.owner.login,
          selectedRepo.name,
          shortSha
        );
        if (apk) {
          logger.info(`ChatScreen: APK ready! Set buildApkAsset: ${apk.name}`);
          setBuildApkAsset(apk);
        }
      } catch (e: any) {
        logger.warn(`ChatScreen: Error while polling APK build: ${e.message}`);
      }
    };

    checkApk();
    const interval = setInterval(checkApk, 10000); // Check every 10 seconds
    return () => clearInterval(interval);
  }, [buildTargetCommitSha, buildApkAsset, selectedRepo.owner.login, selectedRepo.name]);

  const renderStatusBanner = () => {
    const latestStatusMsg = localMergeStatuses.length > 0
      ? localMergeStatuses[localMergeStatuses.length - 1].text
      : 'Integrating development branch via rebase...';

    if (buildApkAsset) {
      return (
        <View style={styles.bannerReady}>
          <View style={styles.bannerHeader}>
            <Text style={styles.bannerTitleReady}>📦 APK Build Success!</Text>
            <Text style={styles.bannerMetaReady}>
              Commit: {buildTargetCommitSha?.substring(0, 7)}
            </Text>
          </View>
          <Text style={styles.bannerDescReady}>
            Your signed Android APK is compiled and ready for download.
          </Text>
          <View style={styles.bannerButtonsRow}>
            <TouchableOpacity
              style={styles.bannerBtnDownload}
              onPress={async () => {
                try {
                  const supported = await Linking.canOpenURL(buildApkAsset.browser_download_url);
                  if (supported) {
                    await Linking.openURL(buildApkAsset.browser_download_url);
                  } else {
                    Alert.alert('Error', `Cannot open download URL: ${buildApkAsset.browser_download_url}`);
                  }
                } catch (e: any) {
                  Alert.alert('Download Failed', e.message);
                }
              }}
            >
              <Text style={styles.bannerBtnDownloadText}>Install / Download APK</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.bannerBtnCopy}
              onPress={async () => {
                await ClipboardExpo.setStringAsync(buildApkAsset.browser_download_url);
                Alert.alert('Copied!', 'APK Download URL copied to clipboard.');
              }}
            >
              <Text style={styles.bannerBtnCopyText}>📋 Copy Link</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    if (buildTargetCommitSha) {
      return (
        <View style={styles.bannerCompiling}>
          <View style={styles.bannerHeader}>
            <Text style={styles.bannerTitleCompiling}>⚙️ Pipeline: Compiling APK...</Text>
            <ActivityIndicator size="small" color="#f59e0b" style={{ marginLeft: 8 }} />
          </View>
          <Text style={styles.bannerDescCompiling}>
            Rebase merge complete! Standalone APK is compiling (typically 3-5 mins).
          </Text>
          {onViewBuildProgress && (
            <TouchableOpacity style={styles.bannerBtnProgress} onPress={onViewBuildProgress}>
              <Text style={styles.bannerBtnProgressText}>🚀 View APK Build Progress</Text>
            </TouchableOpacity>
          )}
        </View>
      );
    }

    return (
      <View style={styles.bannerIntegrating}>
        <View style={styles.bannerHeader}>
          <Text style={styles.bannerTitleIntegrating}>⚙️ Integrating Code...</Text>
          <ActivityIndicator size="small" color="#3b82f6" style={{ marginLeft: 8 }} />
        </View>
        <Text style={styles.bannerDescIntegrating}>{latestStatusMsg}</Text>
      </View>
    );
  };

  const getStatusColor = (state: string) => {
    switch (state) {
      case 'QUEUED':
        return '#f59e0b';
      case 'PLANNING':
      case 'IN_PROGRESS':
        return '#3b82f6';
      case 'AWAITING_PLAN_APPROVAL':
        return '#ec4899';
      case 'COMPLETED':
        return '#10b981';
      case 'FAILED':
        return '#ef4444';
      default:
        return '#9ca3af';
    }
  };

  // If no session active, show launch panel
  if (!session) {
    return (
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack}>
            <Text style={styles.backText}>← Repos</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{selectedRepo.name}</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView
          contentContainerStyle={styles.centerContainer}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.scaffoldTitle}>🚀 Launch Autonomous Dev</Text>
          <Text style={styles.scaffoldDesc}>
            Tell Jules what app you want to build. Jules will design the code, create the app boilerplate, and build a test-signed APK with GitHub Actions CI.
          </Text>

          <TextInput
            style={styles.scaffoldInput}
            placeholder="e.g. Build a gorgeous calculator app with dark mode, scientific functions, and clear animations."
            placeholderTextColor="#888"
            multiline
            numberOfLines={5}
            value={initialPrompt}
            onChangeText={setInitialPrompt}
          />

          <TouchableOpacity style={styles.launchBtn} onPress={handleStartSession} disabled={loading}>
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.launchBtnText}>Create App with Jules</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={{ width: 60 }}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.headerMeta}>
          <Text style={styles.headerTitle} numberOfLines={1}>{selectedRepo.name}</Text>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: getStatusColor(session.state) }]} />
            <Text style={styles.statusLabel}>{session.state}</Text>
          </View>
        </View>
        <View style={{ width: 60 }} />
      </View>

      {/* Embedded Jules Chat Webview */}
      <View style={styles.webViewContainer}>
        <WebView
          source={{ uri: session.url }}
          style={styles.webView}
          startInLoadingState={true}
          renderLoading={() => (
            <View style={styles.webViewLoading}>
              <ActivityIndicator size="large" color="#6200ee" />
              <Text style={styles.webViewLoadingText}>Loading Jules session...</Text>
            </View>
          )}
        />
      </View>

      {/* Status Banner */}
      {hasAttemptedMerge && renderStatusBanner()}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121214',
  },
  header: {
    height: 64,
    borderBottomWidth: 1,
    borderColor: '#1e1e24',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 12 : 0,
  },
  backText: {
    color: '#a0a0ab',
    fontSize: 16,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  headerMeta: {
    alignItems: 'center',
    flex: 1,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  statusLabel: {
    color: '#a0a0ab',
    fontSize: 12,
    fontWeight: 'bold',
  },
  centerContainer: {
    padding: 24,
    justifyContent: 'center',
    flexGrow: 1,
  },
  scaffoldTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 12,
  },
  scaffoldDesc: {
    fontSize: 14,
    color: '#a0a0ab',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  scaffoldInput: {
    backgroundColor: '#1c1c1f',
    borderColor: '#2e2e33',
    borderWidth: 1,
    borderRadius: 8,
    color: '#fff',
    padding: 16,
    fontSize: 15,
    minHeight: 120,
    textAlignVertical: 'top',
    marginBottom: 24,
  },
  launchBtn: {
    backgroundColor: '#6200ee',
    borderRadius: 8,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  launchBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  webViewContainer: {
    flex: 1,
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
  bannerReady: {
    backgroundColor: '#142a1f',
    borderTopWidth: 2,
    borderColor: '#10b981',
    padding: 16,
    paddingBottom: Platform.OS === 'android' ? 24 : 16,
  },
  bannerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  bannerTitleReady: {
    color: '#10b981',
    fontWeight: 'bold',
    fontSize: 15,
  },
  bannerMetaReady: {
    color: '#71717a',
    fontSize: 11,
  },
  bannerDescReady: {
    color: '#a0a0ab',
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 12,
  },
  bannerButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  bannerBtnDownload: {
    backgroundColor: '#10b981',
    borderRadius: 6,
    height: 38,
    flex: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  bannerBtnDownloadText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 13,
  },
  bannerBtnCopy: {
    borderWidth: 1,
    borderColor: '#2e2e33',
    backgroundColor: '#121214',
    borderRadius: 6,
    height: 38,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerBtnCopyText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  bannerCompiling: {
    backgroundColor: '#272015',
    borderTopWidth: 2,
    borderColor: '#f59e0b',
    padding: 16,
    paddingBottom: Platform.OS === 'android' ? 24 : 16,
  },
  bannerTitleCompiling: {
    color: '#f59e0b',
    fontWeight: 'bold',
    fontSize: 15,
    flexDirection: 'row',
    alignItems: 'center',
  },
  bannerDescCompiling: {
    color: '#a0a0ab',
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 10,
  },
  bannerBtnProgress: {
    backgroundColor: '#f59e0b',
    borderRadius: 6,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerBtnProgressText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 13,
  },
  bannerIntegrating: {
    backgroundColor: '#151d2a',
    borderTopWidth: 2,
    borderColor: '#3b82f6',
    padding: 16,
    paddingBottom: Platform.OS === 'android' ? 24 : 16,
  },
  bannerTitleIntegrating: {
    color: '#3b82f6',
    fontWeight: 'bold',
    fontSize: 15,
    flexDirection: 'row',
    alignItems: 'center',
  },
  bannerDescIntegrating: {
    color: '#a0a0ab',
    fontSize: 12,
    lineHeight: 16,
  },
});
