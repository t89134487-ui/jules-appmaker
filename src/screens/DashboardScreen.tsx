import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Modal,
  Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ClipboardExpo from 'expo-clipboard';
import { GitHubRepo, GitHubService } from '../services/github';
import { JulesService, JulesSource } from '../services/jules';
import { logger } from '../services/logger';

interface DashboardScreenProps {
  githubService: GitHubService;
  julesService: JulesService | null;
  onSelectRepo: (repo: GitHubRepo, sessionId?: string) => void;
  onLogout: () => void;
}

import { ConsoleOverlay } from '../components/ConsoleOverlay';

export const DashboardScreen: React.FC<DashboardScreenProps> = ({
  githubService,
  julesService,
  onSelectRepo,
  onLogout,
}) => {
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [connectedSources, setConnectedSources] = useState<JulesSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [logsVisible, setLogsVisible] = useState(false);

  // New repo fields
  const [newRepoName, setNewRepoName] = useState('');
  const [newRepoPrivate, setNewRepoPrivate] = useState(false);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [guideModalVisible, setGuideModalVisible] = useState(false);
  const [justCreatedRepo, setJustCreatedRepo] = useState<GitHubRepo | null>(null);

  // Thread list modal fields
  const [allSessions, setAllSessions] = useState<any[]>([]);
  const [repoSessions, setRepoSessions] = useState<any[]>([]);
  const [threadsModalVisible, setThreadsModalVisible] = useState(false);
  const [threadLoading, setThreadLoading] = useState(false);
  const [targetRepoForThreads, setTargetRepoForThreads] = useState<GitHubRepo | null>(null);

  // New Repository Selector fields
  const [repoSelectorVisible, setRepoSelectorVisible] = useState(false);
  const [repoSearchQuery, setRepoSearchQuery] = useState('');

  const fetchRepos = async () => {
    setLoading(true);
    try {
      logger.info('Fetching GitHub repositories...');
      const data = await githubService.getRepositories();
      setRepos(data);

      if (julesService) {
        logger.info('Fetching Jules connected sources...');
        const sources = await julesService.getSources();
        setConnectedSources(sources);
        logger.info(`Found ${sources.length} connected Jules sources.`);

        logger.info('Fetching Jules active sessions/threads...');
        const sessions = await julesService.getSessions();
        setAllSessions(sessions);
        logger.info(`Found ${sessions.length} sessions/threads in total.`);
      }
    } catch (e: any) {
      logger.error(`Error fetching resources: ${e.message}`);
      Alert.alert('Error Fetching Data', e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRepos();
  }, []);

  const handleCreateRepo = async () => {
    if (!newRepoName.trim()) {
      Alert.alert('Error', 'Please enter a repository name');
      return;
    }

    setCreating(true);
    try {
      const created = await githubService.createRepository(newRepoName.trim(), newRepoPrivate);
      setJustCreatedRepo(created);
      setCreateModalVisible(false);
      setNewRepoName('');
      setNewRepoPrivate(false);

      // Fetch latest repos
      await fetchRepos();

      // Show instruction guide on how to hook Jules App integration to this new repository
      setGuideModalVisible(true);
    } catch (e: any) {
      Alert.alert('Repository Creation Failed', e.message);
    } finally {
      setCreating(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    await ClipboardExpo.setStringAsync(text);
    Alert.alert('Copied!', 'Text copied to clipboard.');
  };

  // Helper to check if repository is connected as a Jules source
  const isRepoConnectedToJules = (repo: GitHubRepo): boolean => {
    // Jules source id format is usually: github-owner-repo
    const targetSourceId = `github-${repo.owner.login}-${repo.name}`.toLowerCase();
    return connectedSources.some((src) => {
      const srcId = src.id.toLowerCase();
      return (
        srcId === targetSourceId ||
        (src.githubRepo?.owner.toLowerCase() === repo.owner.login.toLowerCase() &&
          src.githubRepo?.repo.toLowerCase() === repo.name.toLowerCase())
      );
    });
  };

  const handleSelectRepository = (repo: GitHubRepo) => {
    if (!isRepoConnectedToJules(repo)) {
      // If repository isn't linked to Jules, show instructions modal first to avoid 404
      setJustCreatedRepo(repo);
      setGuideModalVisible(true);
    } else {
      // Get the exact connected source identifier for this repo
      const targetSourceId = `github-${repo.owner.login}-${repo.name}`.toLowerCase();

      // Filter sessions/threads that match this specific repository source.
      // In Jules API, session objects contain their connected source URI inside properties.
      // But since some fields may vary, we filter sessions matching the repo name/owner.
      const matchedThreads = allSessions.filter((sess) => {
        const sourceCtx = sess.sourceContext?.source || '';
        const lowerSource = sourceCtx.toLowerCase();

        return (
          lowerSource.includes(repo.name.toLowerCase()) &&
          lowerSource.includes(repo.owner.login.toLowerCase())
        );
      });

      setRepoSessions(matchedThreads);
      setTargetRepoForThreads(repo);
      setThreadsModalVisible(true);
    }
  };

  const getRepoForSession = (sess: any): GitHubRepo | null => {
    const sourceCtx = sess.sourceContext?.source || '';
    const cleaned = sourceCtx.replace(/^sources\//, '');
    if (cleaned.startsWith('github-')) {
      const parts = cleaned.substring(7).split('-');
      if (parts.length >= 2) {
        const owner = parts[0].toLowerCase();
        const repo = parts.slice(1).join('-').toLowerCase();

        const match = repos.find(
          (r) => r.owner.login.toLowerCase() === owner && r.name.toLowerCase() === repo
        );
        if (match) return match;
      }
    }

    const matchFallback = repos.find((r) => {
      const lowerSource = sourceCtx.toLowerCase();
      return (
        lowerSource.includes(r.name.toLowerCase()) &&
        lowerSource.includes(r.owner.login.toLowerCase())
      );
    });
    return matchFallback || null;
  };

  const getOrCreateRepoForSession = (sess: any): GitHubRepo => {
    const matched = getRepoForSession(sess);
    if (matched) return matched;

    const sourceCtx = sess.sourceContext?.source || '';
    const cleaned = sourceCtx.replace(/^sources\//, '');
    let owner = 'unknown';
    let repoName = 'unknown-repo';
    if (cleaned.startsWith('github-')) {
      const parts = cleaned.substring(7).split('-');
      if (parts.length >= 2) {
        owner = parts[0];
        repoName = parts.slice(1).join('-');
      }
    }

    return {
      id: Math.random(),
      name: repoName,
      full_name: `${owner}/${repoName}`,
      owner: {
        login: owner,
        avatar_url: '',
      },
      html_url: `https://github.com/${owner}/${repoName}`,
      description: 'Repo associated with this Jules session',
      default_branch: 'main',
    };
  };

  const sortedSessions = [...allSessions].sort((a, b) => {
    const timeA = new Date(a.updateTime || a.createTime).getTime();
    const timeB = new Date(b.updateTime || b.createTime).getTime();
    return timeB - timeA;
  });

  const filteredSessions = sortedSessions.filter((sess) => {
    const query = searchQuery.toLowerCase();
    const title = (sess.title || '').toLowerCase();
    const prompt = (sess.prompt || '').toLowerCase();
    const repo = getRepoForSession(sess);
    const repoName = repo ? repo.name.toLowerCase() : '';
    const repoOwner = repo ? repo.owner.login.toLowerCase() : '';

    return (
      title.includes(query) ||
      prompt.includes(query) ||
      repoName.includes(query) ||
      repoOwner.includes(query)
    );
  });

  const filteredReposForSelection = repos.filter((r) =>
    r.name.toLowerCase().includes(repoSearchQuery.toLowerCase())
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1, marginRight: 8 }}>
          <Text style={styles.title}>Jules Chats</Text>
          <Text style={styles.subtitle}>Select a thread to resume coding or start new</Text>
        </View>
        <View style={styles.headerBtns}>
          <TouchableOpacity style={styles.logsBtn} onPress={() => setLogsVisible(true)}>
            <Text style={styles.logsBtnText}>🪲 Logs</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.logoutBtn} onPress={onLogout}>
            <Text style={styles.logoutText}>Logout</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Actions & Search */}
      <View style={styles.actionRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search chats..."
          placeholderTextColor="#888"
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCapitalize="none"
        />
        <TouchableOpacity style={styles.createBtn} onPress={() => { setRepoSearchQuery(''); setRepoSelectorVisible(true); }}>
          <Text style={styles.createBtnText}>💬 New Chat</Text>
        </TouchableOpacity>
      </View>

      {/* List of Chats */}
      {loading && allSessions.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#6200ee" />
          <Text style={styles.loadingText}>Loading chats...</Text>
        </View>
      ) : (
        <FlatList
          data={filteredSessions}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const repo = getOrCreateRepoForSession(item);
            return (
              <TouchableOpacity
                style={styles.chatCardMain}
                onPress={() => onSelectRepo(repo, item.id)}
              >
                <View style={styles.chatHeaderMain}>
                  <Text style={styles.chatTitleMain} numberOfLines={1}>
                    {item.title || `Session ${item.id}`}
                  </Text>
                  <View style={[styles.statusBadgeMain, { backgroundColor: getStatusColor(item.state) }]}>
                    <Text style={styles.statusBadgeTextMain}>{item.state}</Text>
                  </View>
                </View>

                <Text style={styles.chatRepoName}>
                  📂 {repo.owner.login}/{repo.name}
                </Text>

                <Text style={styles.chatPromptMain} numberOfLines={2}>
                  {item.prompt}
                </Text>

                <Text style={styles.chatMetaMain}>
                  Last active: {new Date(item.updateTime || item.createTime).toLocaleString()}
                </Text>
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No Jules chats found.</Text>
              <Text style={styles.emptySubtext}>Click "New Chat" above to start your first project!</Text>
            </View>
          }
        />
      )}

      {/* MODAL: Select Repository for New Chat */}
      <Modal
        visible={repoSelectorVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setRepoSelectorVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContentLarge}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>📂 Select Repository</Text>
              <TouchableOpacity
                style={styles.closeModalTextBtn}
                onPress={() => setRepoSelectorVisible(false)}
              >
                <Text style={styles.closeModalText}>✕ Close</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.modalDesc}>
              Select a GitHub repository to start a clean session with Jules.
            </Text>

            <View style={styles.modalActionRow}>
              <TextInput
                style={styles.modalSearchInput}
                placeholder="Search repos..."
                placeholderTextColor="#888"
                value={repoSearchQuery}
                onChangeText={setRepoSearchQuery}
                autoCapitalize="none"
              />
              <TouchableOpacity
                style={styles.modalCreateRepoBtn}
                onPress={() => {
                  setRepoSelectorVisible(false);
                  setCreateModalVisible(true);
                }}
              >
                <Text style={styles.modalCreateRepoText}>+ New Repo</Text>
              </TouchableOpacity>
            </View>

            <FlatList
              data={filteredReposForSelection}
              keyExtractor={(item) => item.id.toString()}
              style={{ maxHeight: 300 }}
              renderItem={({ item }) => {
                const isConnected = isRepoConnectedToJules(item);
                return (
                  <TouchableOpacity
                    style={styles.repoSelectionCard}
                    onPress={() => {
                      setRepoSelectorVisible(false);
                      if (!isConnected) {
                        setJustCreatedRepo(item);
                        setGuideModalVisible(true);
                      } else {
                        onSelectRepo(item); // Clean session
                      }
                    }}
                  >
                    <View style={styles.repoSelectionHeader}>
                      <Text style={styles.repoSelectionName}>{item.name}</Text>
                      <Text style={[styles.connectionBadge, isConnected ? styles.connectedText : styles.disconnectedText]}>
                        {isConnected ? '🔌 Linked' : '⚠️ Unlinked'}
                      </Text>
                    </View>
                    <Text style={styles.repoSelectionBranch}>Branch: {item.default_branch}</Text>
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <View style={styles.emptyContainerSmall}>
                  <Text style={styles.emptyTextSmall}>No repositories found.</Text>
                  <TouchableOpacity
                    onPress={() => {
                      setRepoSelectorVisible(false);
                      setCreateModalVisible(true);
                    }}
                  >
                    <Text style={styles.createTextBtn}>Create a new one now!</Text>
                  </TouchableOpacity>
                </View>
              }
            />
          </View>
        </View>
      </Modal>

      {/* MODAL: Create Repo */}
      <Modal
        visible={createModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setCreateModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Create New Repository</Text>
            <Text style={styles.modalDesc}>
              A new, clean repository will be created directly on your GitHub account.
            </Text>

            <TextInput
              style={styles.modalInput}
              placeholder="my-jules-android-app"
              placeholderTextColor="#888"
              value={newRepoName}
              onChangeText={setNewRepoName}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Private Repository</Text>
              <TouchableOpacity
                style={[styles.checkbox, newRepoPrivate && styles.checkboxActive]}
                onPress={() => setNewRepoPrivate(!newRepoPrivate)}
              >
                {newRepoPrivate ? <Text style={styles.checkboxCheck}>✓</Text> : null}
              </TouchableOpacity>
            </View>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setCreateModalVisible(false)}
                disabled={creating}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.confirmBtn}
                onPress={handleCreateRepo}
                disabled={creating}
              >
                {creating ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.confirmBtnText}>Create Repo</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* MODAL: Thread Selector Modal (Resume Thread or New App) */}
      <Modal
        visible={threadsModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setThreadsModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContentLarge}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>🧵 Choose Thread</Text>
              <TouchableOpacity
                style={styles.closeModalTextBtn}
                onPress={() => setThreadsModalVisible(false)}
              >
                <Text style={styles.closeModalText}>✕ Close</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.guideStep}>
              Selected Repo: <Text style={styles.bold}>{targetRepoForThreads?.name}</Text>
            </Text>

            <TouchableOpacity
              style={styles.newThreadBtn}
              onPress={() => {
                setThreadsModalVisible(false);
                if (targetRepoForThreads) {
                  onSelectRepo(targetRepoForThreads); // Start clean session
                }
              }}
            >
              <Text style={styles.newThreadBtnText}>🚀 Start New Session (Fresh Chat)</Text>
            </TouchableOpacity>

            <Text style={styles.sectionLabel}>Resume Active Session Threads ({repoSessions.length}):</Text>

            <FlatList
              data={repoSessions}
              keyExtractor={(item) => item.id}
              style={styles.threadsFlatList}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.threadCard}
                  onPress={() => {
                    setThreadsModalVisible(false);
                    if (targetRepoForThreads) {
                      onSelectRepo(targetRepoForThreads, item.id); // Resume session
                    }
                  }}
                >
                  <View style={styles.threadHeader}>
                    <Text style={styles.threadTitle} numberOfLines={1}>
                      {item.title || `Session ${item.id}`}
                    </Text>
                    <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.state) }]}>
                      <Text style={styles.statusBadgeText}>{item.state}</Text>
                    </View>
                  </View>
                  <Text style={styles.threadPrompt} numberOfLines={2}>
                    {item.prompt}
                  </Text>
                  <Text style={styles.threadMeta}>
                    Last updated: {new Date(item.updateTime || item.createTime).toLocaleString()}
                  </Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <View style={styles.emptyThreads}>
                  <Text style={styles.emptyThreadsText}>No existing sessions found for this repo.</Text>
                  <Text style={styles.emptyThreadsSub}>Click "Start New Session" above to launch!</Text>
                </View>
              }
            />
          </View>
        </View>
      </Modal>

      {/* MODAL: Debug Console logs overlay */}
      <ConsoleOverlay visible={logsVisible} onClose={() => setLogsVisible(false)} />

      {/* MODAL: Guide Instruction for Jules connection */}
      <Modal
        visible={guideModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setGuideModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContentLarge}>
            <Text style={styles.modalTitle}>🔌 Connect Repo to Jules</Text>
            <Text style={styles.guideStep}>
              Excellent! Your repo <Text style={styles.bold}>{justCreatedRepo?.name}</Text> has been created on GitHub.
            </Text>
            <Text style={styles.guideStep}>
              In order for Google Jules to build your app, you must make sure that Jules has authorization to access this repository.
            </Text>

            <View style={styles.infoCard}>
              <Text style={styles.infoCardTitle}>How to connect:</Text>
              <Text style={styles.infoStep}>1. Visit <Text style={styles.bold}>jules.google.com</Text> and go to your Settings/Sources page.</Text>
              <Text style={styles.infoStep}>2. Ensure that the GitHub integration is active for this repository.</Text>
              <Text style={styles.infoStep}>3. Once connected, Jules can proceed seamlessly!</Text>
            </View>

            <TouchableOpacity
              style={styles.copyBtn}
              onPress={() => copyToClipboard(justCreatedRepo?.html_url || '')}
            >
              <Text style={styles.copyBtnText}>📋 Copy Repository URL</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.doneBtn}
              onPress={() => {
                setGuideModalVisible(false);
                if (justCreatedRepo) {
                  onSelectRepo(justCreatedRepo);
                }
              }}
            >
              <Text style={styles.doneBtnText}>All Done! Start Coding with Jules</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
      return '#71717a';
  }
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121214',
    paddingTop: 48,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  subtitle: {
    fontSize: 14,
    color: '#a0a0ab',
    marginTop: 4,
  },
  headerBtns: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logsBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: '#1e1e24',
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#3a3a40',
  },
  logsBtnText: {
    color: '#3b82f6',
    fontSize: 13,
    fontWeight: 'bold',
  },
  logoutBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: '#2e2e33',
  },
  logoutText: {
    color: '#ef4444',
    fontSize: 13,
    fontWeight: 'bold',
  },
  actionRow: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    marginBottom: 16,
  },
  searchInput: {
    flex: 1,
    backgroundColor: '#1c1c1f',
    borderRadius: 8,
    color: '#fff',
    height: 44,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#2e2e33',
    marginRight: 12,
  },
  createBtn: {
    backgroundColor: '#6200ee',
    borderRadius: 8,
    height: 44,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createBtnText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  list: {
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  repoCard: {
    backgroundColor: '#1c1c1f',
    borderRadius: 10,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#2e2e33',
  },
  repoHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  repoName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
  },
  repoPrivacy: {
    fontSize: 12,
    color: '#a0a0ab',
  },
  repoDesc: {
    fontSize: 14,
    color: '#71717a',
    lineHeight: 20,
    marginBottom: 8,
  },
  repoBranch: {
    fontSize: 12,
    color: '#6200ee',
    fontWeight: 'bold',
  },
  connectionBadge: {
    fontSize: 12,
    fontWeight: 'bold',
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 4,
  },
  connectedText: {
    color: '#10b981',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
  },
  disconnectedText: {
    color: '#f59e0b',
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
  },
  modalHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  closeModalTextBtn: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    backgroundColor: '#2e2e33',
    borderRadius: 6,
  },
  closeModalText: {
    color: '#a0a0ab',
    fontSize: 12,
    fontWeight: 'bold',
  },
  newThreadBtn: {
    backgroundColor: '#10b981',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 20,
  },
  newThreadBtnText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  sectionLabel: {
    color: '#fff',
    fontSize: 13,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  threadsFlatList: {
    maxHeight: 280,
  },
  threadCard: {
    backgroundColor: '#121214',
    borderWidth: 1,
    borderColor: '#2e2e33',
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
  },
  threadHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  threadTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
    flex: 1,
    marginRight: 8,
  },
  statusBadge: {
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 4,
  },
  statusBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
  },
  threadPrompt: {
    color: '#a0a0ab',
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 6,
  },
  threadMeta: {
    color: '#52525b',
    fontSize: 10,
  },
  emptyThreads: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  emptyThreadsText: {
    color: '#71717a',
    fontSize: 12,
  },
  emptyThreadsSub: {
    color: '#52525b',
    fontSize: 11,
    marginTop: 4,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: '#a0a0ab',
    marginTop: 12,
  },
  emptyContainer: {
    alignItems: 'center',
    marginTop: 80,
  },
  emptyText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  emptySubtext: {
    color: '#a0a0ab',
    marginTop: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalContent: {
    backgroundColor: '#1c1c1f',
    borderRadius: 12,
    padding: 24,
    width: '100%',
    borderWidth: 1,
    borderColor: '#2e2e33',
  },
  modalContentLarge: {
    backgroundColor: '#1c1c1f',
    borderRadius: 12,
    padding: 24,
    width: '100%',
    borderWidth: 1,
    borderColor: '#2e2e33',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 12,
  },
  modalDesc: {
    color: '#a0a0ab',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },
  modalInput: {
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
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  switchLabel: {
    color: '#fff',
    fontSize: 16,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#6200ee',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxActive: {
    backgroundColor: '#6200ee',
  },
  checkboxCheck: {
    color: '#fff',
    fontWeight: 'bold',
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  cancelBtn: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    marginRight: 12,
  },
  cancelBtnText: {
    color: '#a0a0ab',
    fontWeight: 'bold',
  },
  confirmBtn: {
    backgroundColor: '#6200ee',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 100,
  },
  confirmBtnText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  guideStep: {
    color: '#a0a0ab',
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 12,
  },
  bold: {
    color: '#fff',
    fontWeight: 'bold',
  },
  infoCard: {
    backgroundColor: '#121214',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#2e2e33',
  },
  infoCardTitle: {
    color: '#6200ee',
    fontWeight: 'bold',
    marginBottom: 10,
    fontSize: 14,
  },
  infoStep: {
    color: '#a0a0ab',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 8,
  },
  copyBtn: {
    borderWidth: 1,
    borderColor: '#2e2e33',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  copyBtnText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  doneBtn: {
    backgroundColor: '#6200ee',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  doneBtnText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 15,
  },
  chatCardMain: {
    backgroundColor: '#1c1c1f',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#2e2e33',
  },
  chatHeaderMain: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  chatTitleMain: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    flex: 1,
    marginRight: 8,
  },
  statusBadgeMain: {
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 4,
  },
  statusBadgeTextMain: {
    color: '#fff',
    fontSize: 11,
    fontWeight: 'bold',
  },
  chatRepoName: {
    color: '#6200ee',
    fontSize: 13,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  chatPromptMain: {
    color: '#a0a0ab',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 10,
  },
  chatMetaMain: {
    color: '#52525b',
    fontSize: 11,
  },
  modalActionRow: {
    flexDirection: 'row',
    marginBottom: 16,
    alignItems: 'center',
  },
  modalSearchInput: {
    flex: 1,
    backgroundColor: '#121214',
    borderWidth: 1,
    borderColor: '#3a3a40',
    borderRadius: 8,
    color: '#fff',
    height: 44,
    paddingHorizontal: 12,
    fontSize: 14,
    marginRight: 8,
  },
  modalCreateRepoBtn: {
    backgroundColor: '#6200ee',
    borderRadius: 8,
    height: 44,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCreateRepoText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  repoSelectionCard: {
    backgroundColor: '#121214',
    borderWidth: 1,
    borderColor: '#2e2e33',
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
  },
  repoSelectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  repoSelectionName: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
    flex: 1,
    marginRight: 8,
  },
  repoSelectionBranch: {
    color: '#71717a',
    fontSize: 11,
  },
  emptyContainerSmall: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  emptyTextSmall: {
    color: '#71717a',
    fontSize: 13,
  },
  createTextBtn: {
    color: '#6200ee',
    fontWeight: 'bold',
    fontSize: 13,
    marginTop: 6,
    textDecorationLine: 'underline',
  },
});
