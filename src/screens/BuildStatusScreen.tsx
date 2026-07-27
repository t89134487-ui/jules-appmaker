import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  ScrollView,
  Alert,
  Platform,
} from 'react-native';
import { GitHubService, GitHubWorkflowRun, GitHubReleaseAsset } from '../services/github';

interface BuildStatusScreenProps {
  githubService: GitHubService;
  repoOwner: string;
  repoName: string;
  defaultBranch?: string;
  onBack: () => void;
}

export const BuildStatusScreen: React.FC<BuildStatusScreenProps> = ({
  githubService,
  repoOwner,
  repoName,
  defaultBranch,
  onBack,
}) => {
  const [runs, setRuns] = useState<GitHubWorkflowRun[]>([]);
  const [apkAsset, setApkAsset] = useState<GitHubReleaseAsset | null>(null);
  const [currentCommitSha, setCurrentCommitSha] = useState<string | null>(null);
  const [polling, setPolling] = useState(true);
  const [loading, setLoading] = useState(false);

  const fetchStatus = async () => {
    let targetCommitSha = null;
    let actionRuns = [];

    try {
      // 1. Get Action workflow runs
      actionRuns = await githubService.getWorkflowRuns(repoOwner, repoName);
      setRuns(actionRuns);
      if (actionRuns && actionRuns.length > 0 && actionRuns[0].head_sha) {
        targetCommitSha = actionRuns[0].head_sha;
      }
    } catch (e) {
      console.warn('Failed to query workflow runs', e);
    }

    try {
      // 2. If no workflow run yet, fallback to latest commit of default branch
      if (!targetCommitSha) {
        const branchName = defaultBranch || 'main';
        targetCommitSha = await githubService.getLatestCommitSha(repoOwner, repoName, branchName);
      }

      setCurrentCommitSha(targetCommitSha);

      if (targetCommitSha) {
        // 3. Try to locate released APK asset specifically for this target commit
        const shortSha = targetCommitSha.substring(0, 7);
        const apk = await githubService.getApkAssetForCommit(repoOwner, repoName, shortSha);
        setApkAsset(apk);
      }
    } catch (e) {
      console.warn('Failed to query commit/release status', e);
      setApkAsset(null);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const handleDownload = async () => {
    if (!apkAsset) return;
    try {
      const supported = await Linking.canOpenURL(apkAsset.browser_download_url);
      if (supported) {
        await Linking.openURL(apkAsset.browser_download_url);
      } else {
        Alert.alert('Error', `Cannot open download URL: ${apkAsset.browser_download_url}`);
      }
    } catch (e: any) {
      Alert.alert('Download Failed', e.message);
    }
  };

  const getRunStatusColor = (status: string, conclusion: string | null) => {
    if (status === 'completed') {
      return conclusion === 'success' ? '#10b981' : '#ef4444';
    }
    return '#f59e0b'; // queued or in_progress
  };

  const latestRun = runs[0];

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.backText}>← Workspace</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Build CI Pipeline</Text>
        <TouchableOpacity style={styles.refreshHeaderBtn} onPress={fetchStatus}>
          <Text style={styles.refreshHeaderText}>🔄 Refresh</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>🛠️ GitHub Actions CI Status</Text>

          {latestRun ? (
            <View style={styles.runDetail}>
              <View style={styles.statusRow}>
                <View
                  style={[
                    styles.statusDot,
                    { backgroundColor: getRunStatusColor(latestRun.status, latestRun.conclusion) },
                  ]}
                />
                <Text style={styles.runStatus}>
                  {latestRun.status.toUpperCase()}
                  {latestRun.conclusion ? ` (${latestRun.conclusion.toUpperCase()})` : ''}
                </Text>
              </View>
              <Text style={styles.runTime}>Triggered: {new Date(latestRun.created_at).toLocaleString()}</Text>
              {latestRun.head_sha ? (
                <Text style={styles.runCommit}>Commit: {latestRun.head_sha.substring(0, 7)}</Text>
              ) : null}
              <TouchableOpacity
                onPress={() => Linking.openURL(latestRun.html_url)}
                style={styles.detailsBtn}
              >
                <Text style={styles.detailsBtnText}>View GitHub Actions Logs ↗</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.noRuns}>
              <ActivityIndicator color="#6200ee" size="small" />
              <Text style={styles.noRunsText}>Waiting for Jules to setup and trigger CI pipeline...</Text>
            </View>
          )}
        </View>

        {/* APK Download section */}
        <View style={styles.apkSection}>
          {apkAsset ? (
            <View style={styles.apkCardReady}>
              <Text style={styles.apkEmoji}>📦</Text>
              <Text style={styles.apkTitle}>Android APK is Ready!</Text>
              <Text style={styles.apkDesc}>
                Jules successfully built and published a test-key signed production APK for one-click download.
              </Text>
              <TouchableOpacity style={styles.downloadBtn} onPress={handleDownload}>
                <Text style={styles.downloadBtnText}>Install / Download APK</Text>
              </TouchableOpacity>
              <Text style={styles.apkMeta}>{apkAsset.name}</Text>
              {currentCommitSha ? (
                <Text style={styles.commitText}>Commit: {currentCommitSha.substring(0, 7)}</Text>
              ) : null}
            </View>
          ) : (
            <View style={styles.apkCardPending}>
              <ActivityIndicator color="#a0a0ab" size="large" />
              <Text style={styles.apkPendingTitle}>Building APK...</Text>
              <Text style={styles.apkPendingDesc}>
                The CI build typically takes 3 to 5 minutes. As soon as the APK is compiled and released, it will appear right here for one-click install!
              </Text>
              {currentCommitSha ? (
                <Text style={styles.commitTextPending}>Target Commit: {currentCommitSha.substring(0, 7)}</Text>
              ) : null}
            </View>
          )}
        </View>
      </ScrollView>
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
    flex: 1,
    textAlign: 'center',
  },
  refreshHeaderBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: '#1c1c1f',
    borderWidth: 1,
    borderColor: '#2e2e33',
    borderRadius: 6,
  },
  refreshHeaderText: {
    color: '#3b82f6',
    fontSize: 12,
    fontWeight: 'bold',
  },
  scroll: {
    padding: 24,
    flexGrow: 1,
  },
  card: {
    backgroundColor: '#1c1c1f',
    borderRadius: 12,
    padding: 20,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#2e2e33',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 16,
  },
  runDetail: {
    backgroundColor: '#121214',
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2e2e33',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  runStatus: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  runTime: {
    color: '#71717a',
    fontSize: 12,
    marginBottom: 16,
  },
  detailsBtn: {
    alignSelf: 'flex-start',
  },
  detailsBtnText: {
    color: '#6200ee',
    fontWeight: 'bold',
    fontSize: 13,
  },
  noRuns: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  noRunsText: {
    color: '#a0a0ab',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 12,
  },
  apkSection: {
    flex: 1,
    justifyContent: 'center',
  },
  apkCardReady: {
    backgroundColor: '#1c1c1f',
    borderWidth: 2,
    borderColor: '#10b981',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#10b981',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 5,
  },
  apkEmoji: {
    fontSize: 48,
    marginBottom: 12,
  },
  apkTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  apkDesc: {
    color: '#a0a0ab',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  downloadBtn: {
    backgroundColor: '#10b981',
    borderRadius: 8,
    height: 52,
    paddingHorizontal: 32,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    marginBottom: 12,
  },
  downloadBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  apkMeta: {
    color: '#71717a',
    fontSize: 12,
  },
  apkCardPending: {
    backgroundColor: '#1c1c1f',
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2e2e33',
  },
  apkPendingTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 16,
    marginBottom: 8,
  },
  apkPendingDesc: {
    color: '#a0a0ab',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  commitText: {
    color: '#10b981',
    fontSize: 12,
    marginTop: 8,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  commitTextPending: {
    color: '#a0a0ab',
    fontSize: 12,
    marginTop: 16,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  runCommit: {
    color: '#a0a0ab',
    fontSize: 12,
    marginBottom: 16,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
});
