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
import * as ClipboardExpo from 'expo-clipboard';
import { GitHubRepo, GitHubService } from '../services/github';
import { JulesService, JulesSource } from '../services/jules';
import { logger } from '../services/logger';

interface DashboardScreenProps {
  githubService: GitHubService;
  julesService: JulesService | null;
  onSelectRepo: (repo: GitHubRepo) => void;
  onLogout: () => void;
}

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

  // New repo fields
  const [newRepoName, setNewRepoName] = useState('');
  const [newRepoPrivate, setNewRepoPrivate] = useState(false);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [guideModalVisible, setGuideModalVisible] = useState(false);
  const [justCreatedRepo, setJustCreatedRepo] = useState<GitHubRepo | null>(null);

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
      onSelectRepo(repo);
    }
  };

  const filteredRepos = repos.filter((r) =>
    r.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Your Projects</Text>
          <Text style={styles.subtitle}>Select or create a GitHub repo for Jules</Text>
        </View>
        <TouchableOpacity style={styles.logoutBtn} onPress={onLogout}>
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </View>

      {/* Actions & Search */}
      <View style={styles.actionRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search repositories..."
          placeholderTextColor="#888"
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCapitalize="none"
        />
        <TouchableOpacity style={styles.createBtn} onPress={() => setCreateModalVisible(true)}>
          <Text style={styles.createBtnText}>+ New Repo</Text>
        </TouchableOpacity>
      </View>

      {/* List */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#6200ee" />
          <Text style={styles.loadingText}>Loading repositories...</Text>
        </View>
      ) : (
        <FlatList
          data={filteredRepos}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const isConnected = isRepoConnectedToJules(item);
            return (
              <TouchableOpacity style={styles.repoCard} onPress={() => handleSelectRepository(item)}>
                <View style={styles.repoHeader}>
                  <Text style={styles.repoName}>{item.name}</Text>
                  <Text style={[styles.connectionBadge, isConnected ? styles.connectedText : styles.disconnectedText]}>
                    {isConnected ? '🔌 Connected' : '⚠️ Unlinked'}
                  </Text>
                </View>
                {item.description ? (
                  <Text style={styles.repoDesc} numberOfLines={2}>
                    {item.description}
                  </Text>
                ) : null}
                <Text style={styles.repoBranch}>Branch: {item.default_branch}</Text>
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No repositories found.</Text>
              <Text style={styles.emptySubtext}>Try creating a new one above!</Text>
            </View>
          }
        />
      )}

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
  logoutBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: '#2e2e33',
  },
  logoutText: {
    color: '#ef4444',
    fontSize: 14,
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
});
