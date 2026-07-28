import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Linking,
  Modal,
} from 'react-native';
import * as ClipboardExpo from 'expo-clipboard';
import { JulesService, JulesSession, JulesActivity } from '../services/jules';
import { GitHubRepo } from '../services/github';
import { logger } from '../services/logger';

import { GitHubService } from '../services/github';

interface ChatScreenProps {
  julesService: JulesService;
  gitHubService?: GitHubService | null; // Pass GitHub service for dynamic merge execution
  selectedRepo: GitHubRepo;
  initialSessionId?: string | null;
  hasExistingSessions?: boolean;
  onSessionStarted: (sessionId: string) => void;
  onSessionStateFetched?: (state: string) => void;
  onViewBuildProgress?: () => void;
  onStartIntegration?: () => void;
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
  onStartIntegration,
  onBack,
}) => {
  const [session, setSession] = useState<JulesSession | null>(null);
  const [activities, setActivities] = useState<JulesActivity[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [mergedBranches, setMergedBranches] = useState<Record<string, boolean>>({});
  const [failedMessages, setFailedMessages] = useState<Array<{ id: string; text: string; createTime: string }>>([]);
  const [jsonModalVisible, setJsonModalVisible] = useState(false);
  const [hasAttemptedMerge, setHasAttemptedMerge] = useState(false);
  const [buildTargetCommitSha, setBuildTargetCommitSha] = useState<string | null>(null);
  const [buildApkAsset, setBuildApkAsset] = useState<any | null>(null);

  // Initial prompt state
  const [initialPrompt, setInitialPrompt] = useState('');

  const scrollRef = useRef<ScrollView>(null);

  const fetchSessionState = async (id: string) => {
    try {
      const sess = await julesService.getSession(id);
      setSession(sess);
      if (onSessionStateFetched) {
        onSessionStateFetched(sess.state);
      }

      const acts = await julesService.getActivities(id);
      setActivities(acts);
    } catch (e: any) {
      console.warn('Failed to poll session state', e);
    }
  };

  // Load existing session if specified on entry
  useEffect(() => {
    if (initialSessionId) {
      logger.info(`Resuming existing session thread: ${initialSessionId}`);
      setLoading(true);
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
      setActivities([]);
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

  // Automatically scroll to end when activities are loaded or updated
  useEffect(() => {
    if (activities.length > 0) {
      const timer = setTimeout(() => {
        scrollRef.current?.scrollToEnd({ animated: true });
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [activities.length, loading]);

  const handleStartSession = async () => {
    if (!initialPrompt.trim()) {
      Alert.alert('Error', 'Please describe the app you want to build');
      return;
    }

    logger.info(`Starting session for repo: ${selectedRepo.owner.login}/${selectedRepo.name}`);
    setLoading(true);
    try {
      // Append core CI generation prompt instructions autonomously ONLY if the repo has no existing sessions!
      // Letting Jules decide the language, framework, and toolchain autonomously (e.g. Jetpack Compose/Kotlin, Flutter, etc.)
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
        requirePlanApproval: false, // Changed to false to prevent manual plan approval prompts
      });

      logger.info(`Session created successfully. ID: ${newSession.id}. State: ${newSession.state}`);
      setHasAttemptedMerge(false);
      setBuildTargetCommitSha(null);
      setBuildApkAsset(null);
      setSession(newSession);
      onSessionStarted(newSession.id);
      logger.info('Fetching initial activities...');
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

  const handleSendMessage = async () => {
    if (!message.trim() || !session) return;
    setSubmitting(true);
    const textToSend = message.trim();
    setMessage('');
    try {
      await julesService.sendMessage(session.id, textToSend);

      // Fetch immediately to display user message in the activities list
      await fetchSessionState(session.id);

      // Schedule subsequent fetches to catch state transition on Jules server
      setTimeout(() => {
        if (session) fetchSessionState(session.id);
      }, 2000);
      setTimeout(() => {
        if (session) fetchSessionState(session.id);
      }, 5000);
    } catch (e: any) {
      const failedId = `failed-msg-${Math.random()}-${Date.now()}`;
      setFailedMessages((prev) => [
        ...prev,
        { id: failedId, text: textToSend, createTime: new Date().toISOString() },
      ]);
      Alert.alert('Error Sending Message', e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRetryMessage = async (failedId: string, text: string) => {
    if (!session) return;
    setSubmitting(true);
    setFailedMessages((prev) => prev.filter((m) => m.id !== failedId));
    try {
      await julesService.sendMessage(session.id, text);

      // Fetch immediately to display user message in the activities list
      await fetchSessionState(session.id);

      // Schedule subsequent fetches to catch state transition on Jules server
      setTimeout(() => {
        if (session) fetchSessionState(session.id);
      }, 2000);
      setTimeout(() => {
        if (session) fetchSessionState(session.id);
      }, 5000);
    } catch (e: any) {
      setFailedMessages((prev) => [
        ...prev,
        { id: failedId, text, createTime: new Date().toISOString() },
      ]);
      Alert.alert('Error Sending Message', e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprovePlan = async () => {
    if (!session) return;
    setSubmitting(true);
    try {
      await julesService.approvePlan(session.id);
      Alert.alert('Success', 'Plan approved! Jules will now execute the tasks.');
      await fetchSessionState(session.id);
    } catch (e: any) {
      Alert.alert('Failed to Approve Plan', e.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Helper to render activity logs/messages
  const renderActivityItem = (act: JulesActivity, isLastMessage = true) => {
    if (act.userMessaged) {
      return (
        <View key={act.id} style={[styles.msgRow, styles.msgUser]}>
          <Text style={styles.msgLabel}>You</Text>
          <Text style={styles.msgText}>{act.userMessaged.userMessage}</Text>
        </View>
      );
    }

    if (act.agentMessaged) {
      return (
        <View key={act.id} style={[styles.msgRow, styles.msgAgent]}>
          <Text style={styles.msgLabelAgent}>Jules</Text>
          <Text style={styles.msgTextAgent}>{act.agentMessaged.agentMessage}</Text>
        </View>
      );
    }

    if (act.planGenerated) {
      const plan = act.planGenerated.plan;
      return (
        <View key={act.id} style={styles.planCard}>
          <Text style={styles.planTitle}>📋 Proposed Development Plan</Text>
          {plan.steps.map((step, idx) => (
            <View key={step.id} style={styles.stepItem}>
              <Text style={styles.stepIndex}>{idx + 1}. {step.title}</Text>
              <Text style={styles.stepDesc}>{step.description}</Text>
            </View>
          ))}
        </View>
      );
    }

    if (act.progressUpdated) {
      const progressTitle = act.progressUpdated.title || 'Task in Progress';
      const progressDesc = act.progressUpdated.description || act.description;

      return (
        <View key={act.id} style={styles.progressCard}>
          <Text style={styles.progressTitle}>⚡ Progress: {progressTitle}</Text>
          {progressDesc ? <Text style={styles.progressDesc}>{progressDesc}</Text> : null}
        </View>
      );
    }

    if (act.sessionCompleted) {
      return (
        <View key={act.id} style={styles.completedCard}>
          <Text selectable style={styles.completedTitle}>🎉 Task Completed!</Text>
          <Text selectable style={styles.completedDesc}>{act.description || 'Jules has successfully completed the task!'}</Text>
          <TouchableOpacity
            style={[styles.chatBuildBtn, !isLastMessage && { backgroundColor: '#2e2e33' }]}
            onPress={onStartIntegration}
            disabled={!isLastMessage}
          >
            <Text style={[styles.chatBuildBtnText, !isLastMessage && { color: '#71717a' }]}>
              {isLastMessage ? '🚀 Integrate Code & View APK' : 'Integrate Code (Disabled - Newer message exists)'}
            </Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (act.sessionFailed) {
      return (
        <View key={act.id} style={styles.failedCard}>
          <Text style={styles.failedTitle}>❌ Session Failed</Text>
          <Text style={styles.failedDesc}>{act.sessionFailed.reason}</Text>
        </View>
      );
    }

    // Default fallback: if the activity has a description, render it as a status card to prevent empty progress boxes
    if (act.description) {
      return (
        <View key={act.id} style={styles.statusCardFallback}>
          <Text style={styles.statusCardTextFallback}>⚙️ {act.description}</Text>
        </View>
      );
    }

    return null;
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

    // Run immediately on mount/update
    checkApk();

    const interval = setInterval(checkApk, 10000); // Check every 10 seconds

    return () => clearInterval(interval);
  }, [buildTargetCommitSha, buildApkAsset, selectedRepo.owner.login, selectedRepo.name]);

  // Combined chronological feed of API activities and local merge statuses
  // We use index preservation to prevent Hermes/JSC unstable sorting from scrambling the feed.
  const combinedFeed = [
    ...activities.map((act, idx) => ({ ...act, originalIdx: idx, isFailedMessage: false, failedText: undefined as string | undefined })),
    ...failedMessages.map(failed => ({
      id: failed.id,
      originalIdx: 999999,
      isFailedMessage: true,
      description: '',
      failedText: failed.text as string | undefined,
      createTime: failed.createTime,
    }))
  ].sort((a, b) => {
    const isTemporalA = a.isFailedMessage;
    const isTemporalB = b.isFailedMessage;

    if (isTemporalA && isTemporalB) {
      return new Date(a.createTime).getTime() - new Date(b.createTime).getTime();
    }
    if (isTemporalA || isTemporalB) {
      const timeA = new Date(a.createTime).getTime();
      const timeB = new Date(b.createTime).getTime();
      if (timeA !== timeB) {
        return timeA - timeB;
      }
    }
    return (a.originalIdx || 0) - (b.originalIdx || 0);
  }).slice(-50); // ONLY show the last fifty items!

  // If no session active, show creation panel
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
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
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
        <TouchableOpacity style={styles.jsonHeaderBtn} onPress={() => setJsonModalVisible(true)}>
          <Text style={styles.jsonHeaderBtnText}>API JSON</Text>
        </TouchableOpacity>
      </View>

      {/* Chat Area */}
      <ScrollView
        ref={scrollRef}
        style={styles.chatArea}
        contentContainerStyle={{ padding: 16 }}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        <View style={styles.systemBanner}>
          <Text style={styles.systemBannerText}>
            🤖 Autonomous session created. Jules is analyzing your repo and planning scaffolding.
          </Text>
        </View>

        {combinedFeed.map((item, idx) => {
          if (item.isFailedMessage) {
            return (
              <View key={item.id} style={[styles.msgRow, styles.msgUser, styles.msgFailedBorder]}>
                <View style={styles.msgFailedRow}>
                  <Text selectable style={[styles.msgLabel, { color: '#ef4444' }]}>Failed to Send</Text>
                  <TouchableOpacity
                    style={styles.retryBtn}
                    onPress={() => handleRetryMessage(item.id, item.failedText || '')}
                  >
                    <Text style={styles.retryBtnText}>🔄 Retry</Text>
                  </TouchableOpacity>
                </View>
                <Text selectable style={styles.msgText}>{item.failedText}</Text>
              </View>
            );
          }

          const isLastMessage = idx === combinedFeed.length - 1;
          return renderActivityItem(item as unknown as JulesActivity, isLastMessage);
        })}
      </ScrollView>

      {/* Input bar */}
      <View style={styles.inputBar}>
        <TextInput
          style={styles.chatInput}
          placeholder="Send Jules a message..."
          placeholderTextColor="#888"
          value={message}
          onChangeText={setMessage}
          editable={!submitting}
        />
        <TouchableOpacity style={styles.sendBtn} onPress={handleSendMessage} disabled={submitting}>
          {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.sendBtnText}>Send</Text>}
        </TouchableOpacity>
      </View>

      {/* Modal to view Raw Jules Session/Activities JSON */}
      <Modal
        visible={jsonModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setJsonModalVisible(false)}
      >
        <View style={styles.jsonOverlay}>
          <View style={styles.jsonContainer}>
            <View style={styles.jsonHeader}>
              <Text style={styles.jsonTitle}>🛠️ Jules API Response Payload</Text>
              <TouchableOpacity style={styles.closeJsonBtn} onPress={() => setJsonModalVisible(false)}>
                <Text style={styles.closeJsonBtnText}>✕ Close</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.jsonScroll}>
              <Text style={styles.sectionTitleHeader}>Session Object:</Text>
              <Text selectable style={styles.jsonTextCode}>
                {JSON.stringify(session, null, 2)}
              </Text>

              <Text style={[styles.sectionTitleHeader, { marginTop: 20 }]}>Activities ({activities.length}):</Text>
              <Text selectable style={styles.jsonTextCode}>
                {JSON.stringify(activities, null, 2)}
              </Text>
            </ScrollView>

            <View style={styles.jsonFooter}>
              <TouchableOpacity
                style={styles.copyJsonBtn}
                onPress={async () => {
                  try {
                    const fullPayload = JSON.stringify({ session, activities }, null, 2);
                    await ClipboardExpo.setStringAsync(fullPayload);
                    Alert.alert('Success', 'Jules API payload copied to clipboard!');
                  } catch (e: any) {
                    Alert.alert('Copy Failed', e.message);
                  }
                }}
              >
                <Text style={styles.copyJsonBtnText}>Copy Raw Payload</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
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
  chatArea: {
    flex: 1,
  },
  systemBanner: {
    backgroundColor: '#1c1c1f',
    borderColor: '#2e2e33',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  systemBannerText: {
    color: '#a0a0ab',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  msgRow: {
    maxWidth: '85%',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  msgUser: {
    backgroundColor: '#6200ee',
    alignSelf: 'flex-end',
  },
  msgAgent: {
    backgroundColor: '#1c1c1f',
    borderWidth: 1,
    borderColor: '#2e2e33',
    alignSelf: 'flex-start',
  },
  msgLabel: {
    color: '#c084fc',
    fontWeight: 'bold',
    fontSize: 11,
    marginBottom: 4,
  },
  msgLabelAgent: {
    color: '#6200ee',
    fontWeight: 'bold',
    fontSize: 11,
    marginBottom: 4,
  },
  msgText: {
    color: '#fff',
    fontSize: 15,
    lineHeight: 20,
  },
  msgTextAgent: {
    color: '#fff',
    fontSize: 15,
    lineHeight: 20,
  },
  msgFailedBorder: {
    borderColor: '#ef4444',
    borderWidth: 1,
  },
  msgFailedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  retryBtn: {
    backgroundColor: '#ef4444',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  retryBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  planCard: {
    backgroundColor: '#1c1c1f',
    borderWidth: 1,
    borderColor: '#ec4899',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  planTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 12,
  },
  stepItem: {
    marginBottom: 10,
    borderLeftWidth: 2,
    borderColor: '#e879f9',
    paddingLeft: 12,
  },
  stepIndex: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#fff',
  },
  stepDesc: {
    fontSize: 12,
    color: '#a0a0ab',
    marginTop: 2,
  },
  approveBtn: {
    backgroundColor: '#ec4899',
    borderRadius: 8,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  approveBtnText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  approvedBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#10b981',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  approvedBadgeText: {
    color: '#10b981',
    fontWeight: 'bold',
  },
  planningBadge: {
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#f59e0b',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  planningBadgeText: {
    color: '#f59e0b',
    fontWeight: 'bold',
  },
  progressCard: {
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    borderWidth: 1,
    borderColor: '#3b82f6',
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
  },
  progressTitle: {
    color: '#3b82f6',
    fontWeight: 'bold',
    fontSize: 14,
    marginBottom: 4,
  },
  progressDesc: {
    color: '#a0a0ab',
    fontSize: 12,
    lineHeight: 18,
  },
  completedCard: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderWidth: 1,
    borderColor: '#10b981',
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
  },
  completedTitle: {
    color: '#10b981',
    fontWeight: 'bold',
    fontSize: 14,
    marginBottom: 4,
  },
  completedDesc: {
    color: '#a0a0ab',
    fontSize: 12,
    marginBottom: 12,
  },
  chatBuildBtn: {
    backgroundColor: '#10b981',
    borderRadius: 8,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  chatBuildBtnText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 13,
  },
  failedCard: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: '#ef4444',
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
  },
  failedTitle: {
    color: '#ef4444',
    fontWeight: 'bold',
    fontSize: 14,
    marginBottom: 4,
  },
  failedDesc: {
    color: '#a0a0ab',
    fontSize: 12,
  },
  inputBar: {
    borderTopWidth: 1,
    borderColor: '#1e1e24',
    padding: 12,
    paddingBottom: Platform.OS === 'android' ? 18 : 12, // Extra breathing room for gesture navigation
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#121214',
  },
  chatInput: {
    flex: 1,
    backgroundColor: '#1c1c1f',
    borderRadius: 8,
    color: '#fff',
    height: 44,
    paddingHorizontal: 16,
    marginRight: 10,
  },
  sendBtn: {
    backgroundColor: '#6200ee',
    borderRadius: 8,
    height: 44,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  statusCardFallback: {
    backgroundColor: '#1c1c1f',
    borderColor: '#2e2e33',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
    alignSelf: 'stretch',
  },
  statusCardTextFallback: {
    color: '#a0a0ab',
    fontSize: 13,
    lineHeight: 18,
  },
  mergeStatusCard: {
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderWidth: 1,
    borderColor: '#f59e0b',
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
    alignSelf: 'stretch',
  },
  mergeStatusTitle: {
    color: '#f59e0b',
    fontWeight: 'bold',
    fontSize: 14,
    marginBottom: 4,
  },
  mergeStatusDesc: {
    color: '#a0a0ab',
    fontSize: 12,
    lineHeight: 18,
  },
  mergeStatusCardReady: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderWidth: 2,
    borderColor: '#10b981',
    borderRadius: 12,
    padding: 18,
    marginBottom: 12,
    alignSelf: 'stretch',
    shadowColor: '#10b981',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 3,
  },
  mergeStatusTitleReady: {
    color: '#10b981',
    fontWeight: 'bold',
    fontSize: 16,
    marginBottom: 6,
  },
  mergeStatusDescReady: {
    color: '#a0a0ab',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 16,
  },
  chatBuildBtnReady: {
    backgroundColor: '#10b981',
    borderRadius: 8,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  chatBuildBtnTextReady: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 15,
  },
  chatCopyBtnReady: {
    borderWidth: 1,
    borderColor: '#2e2e33',
    backgroundColor: '#121214',
    borderRadius: 8,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  chatCopyBtnTextReady: {
    color: '#fff',
    fontSize: 13,
    fontWeight: 'bold',
  },
  apkMetaReady: {
    color: '#71717a',
    fontSize: 11,
    textAlign: 'center',
  },
  mergeStatusCardCompiling: {
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderWidth: 1,
    borderColor: '#f59e0b',
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
    alignSelf: 'stretch',
  },
  mergeStatusTitleCompiling: {
    color: '#f59e0b',
    fontWeight: 'bold',
    fontSize: 14,
    marginBottom: 4,
  },
  mergeStatusDescCompiling: {
    color: '#a0a0ab',
    fontSize: 12,
    lineHeight: 18,
  },
  chatBuildBtnCompiling: {
    backgroundColor: '#f59e0b',
    borderRadius: 8,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatBuildBtnTextCompiling: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 13,
  },
  jsonHeaderBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: '#1c1c1f',
    borderColor: '#2e2e33',
    borderWidth: 1,
    borderRadius: 6,
  },
  jsonHeaderBtnText: {
    color: '#3b82f6',
    fontSize: 12,
    fontWeight: 'bold',
  },
  jsonOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'flex-end',
  },
  jsonContainer: {
    backgroundColor: '#09090b',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    height: '80%',
    paddingBottom: 24,
    borderTopWidth: 2,
    borderColor: '#27272a',
  },
  jsonHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderColor: '#27272a',
  },
  jsonTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: 'bold',
  },
  closeJsonBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: '#27272a',
    borderRadius: 6,
  },
  closeJsonBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: 'bold',
  },
  jsonScroll: {
    padding: 16,
  },
  sectionTitleHeader: {
    color: '#c084fc',
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  jsonTextCode: {
    color: '#a1a1aa',
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    backgroundColor: '#18181b',
    padding: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  jsonFooter: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderColor: '#27272a',
    alignItems: 'flex-end',
  },
  copyJsonBtn: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    backgroundColor: '#3b82f6',
    borderRadius: 8,
  },
  copyJsonBtnText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
});
