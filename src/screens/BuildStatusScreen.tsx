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
  FlatList,
} from 'react-native';
import * as ClipboardExpo from 'expo-clipboard';
import { GitHubService, GitHubWorkflowRun, GitHubReleaseAsset, GitHubRepo } from '../services/github';

interface BuildStatusScreenProps {
  githubService: GitHubService;
  onBack: () => void;
}

export const BuildStatusScreen: React.FC<BuildStatusScreenProps> = ({
  githubService,
  onBack,
}) => {
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null);
  const [loadingRepos, setLoadingRepos] = useState(false);

  const [runs, setRuns] = useState<GitHubWorkflowRun[]>([]);
  const [apkAsset, setApkAsset] = useState<GitHubReleaseAsset | null>(null);
  const [currentCommitSha, setCurrentCommitSha] = useState<string | null>(null);
  const [loadingBuildInfo, setLoadingBuildInfo] = useState(false);

  // Fetch list of repositories on mount
  useEffect(() => {
    const fetchRepos = async () => {
      setLoadingRepos(true);
      try {
        const repoList = await githubService.getRepositories();
        setRepos(repoList);
        if (repoList.length > 0) {
          // Select the first repo by default
          setSelectedRepo(repoList[0]);
        }
      } catch (e: any) {
        Alert.alert('Error Fetching Repositories', e.message);
      } finally {
        setLoadingRepos(false);
      }
    };
    fetchRepos();
  }, []);

  // Fetch build status whenever selectedRepo changes
  const fetchBuildStatus = async (repo: GitHubRepo) => {
    setLoadingBuildInfo(true);
    let targetCommitSha = null;
    const repoOwner = repo.owner.login;
    const repoName = repo.name;
    const branchName = repo.default_branch || 'main';

    try {
      // 1. Get latest commit SHA
      targetCommitSha = await githubService.getLatestCommitSha(repoOwner, repoName, branchName);
      setCurrentCommitSha(targetCommitSha);
    } catch (e) {
      console.warn('Failed to query latest commit SHA', e);
    }

    let actionRuns = [];
    try {
      // 2. Get action runs
      actionRuns = await githubService.getWorkflowRuns(repoOwner, repoName);
      setRuns(actionRuns);

      if (!targetCommitSha && actionRuns && actionRuns.length > 0 && actionRuns[0].head_sha) {
        targetCommitSha = actionRuns[0].head_sha;
        setCurrentCommitSha(targetCommitSha);
      }
    } catch (e) {
      console.warn('Failed to query workflow runs', e);
      setRuns([]);
    }

    try {
      if (targetCommitSha) {
        // 3. Locate compiled APK release asset
        const shortSha = targetCommitSha.substring(0, 7);
        const apk = await githubService.getApkAssetForCommit(repoOwner, repoName, shortSha);
        setApkAsset(apk);
      } else {
        setApkAsset(null);
      }
    } catch (e) {
      console.warn('Failed to query release status', e);
      setApkAsset(null);
    } finally {
      setLoadingBuildInfo(false);
    }
  };

  useEffect(() => {
    if (selectedRepo) {
      fetchBuildStatus(selectedRepo);
    }
  }, [selectedRepo]);

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
  const isWorkflowRunPending =
    !!(currentCommitSha &&
    latestRun &&
    latestRun.head_sha !== currentCommitSha);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.backText}>← Workspace</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>1-Click APK Downloads</Text>
        <TouchableOpacity
          style={styles.refreshHeaderBtn}
          onPress={() => selectedRepo && fetchBuildStatus(selectedRepo)}
          disabled={!selectedRepo || loadingBuildInfo}
        >
          <Text style={styles.refreshHeaderText}>🔄 Refresh</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Repo Selector Row */}
        <View style={styles.selectorCard}>
          <Text style={styles.selectorLabel}>📂 Select Repository:</Text>
          {loadingRepos ? (
            <ActivityIndicator color="#6200ee" style={{ marginVertical: 8 }} />
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.reposHorizontalList}>
              {repos.map((repo) => {
                const isSelected = selectedRepo?.id === repo.id;
                return (
                  <TouchableOpacity
                    key={repo.id}
                    style={[styles.repoTab, isSelected && styles.repoTabActive]}
                    onPress={() => setSelectedRepo(repo)}
                  >
                    <Text style={[styles.repoTabText, isSelected && styles.repoTabTextActive]}>
                      {repo.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        </View>

        {selectedRepo && (
          <View style={styles.repoDetailsBanner}>
            <Text style={styles.repoOwnerText}>
              Owner: {selectedRepo.owner.login} | Branch: {selectedRepo.default_branch || 'main'}
            </Text>
          </View>
        )}

        {loadingBuildInfo ? (
          <View style={styles.centerLoading}>
            <ActivityIndicator size="large" color="#6200ee" />
            <Text style={styles.loadingText}>Fetching CI & APK Build information...</Text>
          </View>
        ) : selectedRepo ? (
          <View style={{ flex: 1 }}>
            {/* APK Download section */}
            <View style={styles.apkSection}>
              {apkAsset ? (
                <View style={styles.apkCardReady}>
                  <Text style={styles.apkEmoji}>📦</Text>
                  <Text style={styles.apkTitle}>Android APK is Ready!</Text>
                  <Text style={styles.apkDesc}>
                    Jules successfully built and published a signed standalone APK for one-click install.
                  </Text>
                  <TouchableOpacity style={styles.downloadBtn} onPress={handleDownload}>
                    <Text style={styles.downloadBtnText}>Install / Download APK</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.copyLinkBtn}
                    onPress={async () => {
                      await ClipboardExpo.setStringAsync(apkAsset.browser_download_url);
                      Alert.alert('Copied!', 'APK Download URL copied to clipboard.');
                    }}
                  >
                    <Text style={styles.copyLinkBtnText}>📋 Copy APK Download Link</Text>
                  </TouchableOpacity>
                  <Text style={styles.apkMeta}>{apkAsset.name}</Text>
                  {currentCommitSha ? (
                    <Text style={styles.commitText}>Commit: {currentCommitSha.substring(0, 7)}</Text>
                  ) : null}
                </View>
              ) : (
                <View style={styles.apkCardPending}>
                  <ActivityIndicator color="#f59e0b" size="large" />
                  <Text style={styles.apkPendingTitle}>No Signed APK Found</Text>
                  <Text style={styles.apkPendingDesc}>
                    An APK build might be compiling or is pending code integration. The compilation typically takes 3 to 5 minutes once triggered by pushing changes.
                  </Text>
                  {currentCommitSha ? (
                    <Text style={styles.commitTextPending}>Target Commit: {currentCommitSha.substring(0, 7)}</Text>
                  ) : null}
                </View>
              )}
            </View>

            {/* GitHub Actions CI Status */}
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>🛠️ GitHub Actions CI Status</Text>

              {latestRun && !isWorkflowRunPending ? (
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
              ) : isWorkflowRunPending ? (
                <View style={styles.noRuns}>
                  <ActivityIndicator color="#f59e0b" size="small" />
                  <Text style={[styles.noRunsText, { color: '#f59e0b', fontWeight: 'bold' }]}>
                    Pipeline Build Pending...
                  </Text>
                  <Text style={styles.noRunsSubtext}>
                    Waiting for GitHub Actions to trigger the pipeline for the latest commit: {currentCommitSha?.substring(0, 7)}
                  </Text>
                </View>
              ) : (
                <View style={styles.noRuns}>
                  <Text style={styles.noRunsText}>No workflow run history found for this repository.</Text>
                </View>
              )}
            </View>
          </View>
        ) : (
          <View style={styles.centerLoading}>
            <Text style={styles.loadingText}>No repositories found to inspect.</Text>
          </View>
        )}
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
    padding: 20,
    flexGrow: 1,
  },
  selectorCard: {
    backgroundColor: '#1c1c1f',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2e2e33',
    marginBottom: 12,
  },
  selectorLabel: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  reposHorizontalList: {
    flexDirection: 'row',
  },
  repoTab: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: '#121214',
    borderWidth: 1,
    borderColor: '#2e2e33',
    marginRight: 8,
  },
  repoTabActive: {
    backgroundColor: '#6200ee',
    borderColor: '#6200ee',
  },
  repoTabText: {
    color: '#a0a0ab',
    fontSize: 13,
    fontWeight: 'bold',
  },
  repoTabTextActive: {
    color: '#fff',
  },
  repoDetailsBanner: {
    alignItems: 'center',
    marginBottom: 20,
  },
  repoOwnerText: {
    color: '#71717a',
    fontSize: 12,
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
    fontSize: 16,
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
    paddingVertical: 12,
  },
  noRunsText: {
    color: '#a0a0ab',
    fontSize: 13,
    textAlign: 'center',
  },
  noRunsSubtext: {
    color: '#71717a',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
    paddingHorizontal: 12,
  },
  apkSection: {
    marginBottom: 20,
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
  copyLinkBtn: {
    borderWidth: 1,
    borderColor: '#2e2e33',
    backgroundColor: '#121214',
    borderRadius: 8,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    marginBottom: 16,
    marginTop: 6,
  },
  copyLinkBtnText: {
    color: '#fff',
    fontSize: 14,
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
    paddingHorizontal: 12,
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
  centerLoading: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
  },
  loadingText: {
    color: '#a0a0ab',
    fontSize: 14,
    marginTop: 12,
  },
});
