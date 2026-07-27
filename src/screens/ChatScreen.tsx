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
} from 'react-native';
import { JulesService, JulesSession, JulesActivity } from '../services/jules';
import { GitHubRepo } from '../services/github';
import { logger } from '../services/logger';

import { GitHubService } from '../services/github';

interface ChatScreenProps {
  julesService: JulesService;
  gitHubService?: GitHubService | null; // Pass GitHub service for dynamic merge execution
  selectedRepo: GitHubRepo;
  initialSessionId?: string | null;
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
  onSessionStarted,
  onSessionStateFetched,
  onViewBuildProgress,
  onBack,
}) => {
  const [session, setSession] = useState<JulesSession | null>(null);
  const [activities, setActivities] = useState<JulesActivity[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [mergedPrs, setMergedPrs] = useState<Record<number, boolean>>({});

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

      // Perform auto-merge if Jules has completed the task and left a pull request URL
      if (sess.state === 'COMPLETED' && gitHubService) {
        // Read pull request outputs
        const outputs = (sess as any).outputs || [];
        for (const output of outputs) {
          if (output.pullRequest && output.pullRequest.url) {
            const prUrl = output.pullRequest.url;
            // Parse pull request number from url e.g. "https://github.com/owner/repo/pull/12"
            const match = prUrl.match(/\/pull\/(\d+)/);
            if (match && match[1]) {
              const prNumber = parseInt(match[1], 10);

              // Only trigger merge once per PR to avoid spamming the PUT call
              if (!mergedPrs[prNumber]) {
                logger.info(`Detected completed session PR #${prNumber}. Triggering auto-merge...`);
                // Mark as merged in local state immediately to avoid concurrent runs
                setMergedPrs((prev) => ({ ...prev, [prNumber]: true }));

                try {
                  const mergeResult = await gitHubService.mergePullRequest(
                    selectedRepo.owner.login,
                    selectedRepo.name,
                    prNumber
                  );
                  logger.info(`PR #${prNumber} merged successfully: ${JSON.stringify(mergeResult)}`);
                } catch (mergeErr: any) {
                  logger.error(`PR #${prNumber} merge failed: ${mergeErr.message}`);
                }
              }
            }
          }
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
    }
  }, [initialSessionId]);

  // Poll active sessions (optimized to 15 seconds to prevent API spamming)
  useEffect(() => {
    if (!session) return;
    const interval = setInterval(() => {
      fetchSessionState(session.id);
    }, 15000);

    return () => clearInterval(interval);
  }, [session?.id]);

  const handleStartSession = async () => {
    if (!initialPrompt.trim()) {
      Alert.alert('Error', 'Please describe the app you want to build');
      return;
    }

    logger.info(`Starting session for repo: ${selectedRepo.owner.login}/${selectedRepo.name}`);
    setLoading(true);
    try {
      // Append core CI generation prompt instructions autonomously!
      // Letting Jules decide the language, framework, and toolchain autonomously (e.g. Jetpack Compose/Kotlin, Flutter, etc.)
      const augmentedPrompt = `${initialPrompt.trim()}

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
        requirePlanApproval: true,
      });

      logger.info(`Session created successfully. ID: ${newSession.id}. State: ${newSession.state}`);
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
      await fetchSessionState(session.id);
    } catch (e: any) {
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
  const renderActivityItem = (act: JulesActivity) => {
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

      // Determine if this plan has actually been approved yet:
      // 1. Check if there is an explicit planApproved activity event present anywhere in the activities history list.
      const hasPlanApprovedActivity = activities.some((a) => a.planApproved != null);

      // 2. Check if the session is currently awaiting approval.
      const isAwaitingApproval = session?.state === 'AWAITING_PLAN_APPROVAL';

      // 3. Check if the session is in planning/queued stages.
      const isPlanning = session?.state === 'QUEUED' || session?.state === 'PLANNING' || !session;

      return (
        <View key={act.id} style={styles.planCard}>
          <Text style={styles.planTitle}>📋 Proposed Development Plan</Text>
          {plan.steps.map((step) => (
            <View key={step.id} style={styles.stepItem}>
              <Text style={styles.stepIndex}>{step.index + 1}. {step.title}</Text>
              <Text style={styles.stepDesc}>{step.description}</Text>
            </View>
          ))}

          {isAwaitingApproval && !hasPlanApprovedActivity ? (
            <TouchableOpacity style={styles.approveBtn} onPress={handleApprovePlan} disabled={submitting}>
              {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.approveBtnText}>Approve Plan & Run Build</Text>}
            </TouchableOpacity>
          ) : isPlanning && !hasPlanApprovedActivity ? (
            <View style={styles.planningBadge}>
              <ActivityIndicator color="#f59e0b" size="small" style={{ marginRight: 8 }} />
              <Text style={styles.planningBadgeText}>Analyzing code & generating plan...</Text>
            </View>
          ) : session?.state === 'FAILED' ? (
            <View style={[styles.approvedBadge, { borderColor: '#ef4444' }]}>
              <Text style={[styles.approvedBadgeText, { color: '#ef4444' }]}>❌ Plan Failed</Text>
            </View>
          ) : (
            <View style={styles.approvedBadge}>
              <Text style={styles.approvedBadgeText}>✓ Plan Approved (Running Build)</Text>
            </View>
          )}
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
          <Text style={styles.completedTitle}>🏆 Task Complete!</Text>
          <Text style={styles.completedDesc}>Jules has successfully generated the code and merged it directly into your branch.</Text>
          {onViewBuildProgress && (
            <TouchableOpacity style={styles.chatBuildBtn} onPress={onViewBuildProgress}>
              <Text style={styles.chatBuildBtnText}>🚀 View APK Build Progress</Text>
            </TouchableOpacity>
          )}
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

    return null;
  };

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
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.headerMeta}>
          <Text style={styles.headerTitle}>{selectedRepo.name}</Text>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: getStatusColor(session.state) }]} />
            <Text style={styles.statusLabel}>{session.state}</Text>
          </View>
        </View>
        <TouchableOpacity style={styles.refreshHeaderBtn} onPress={() => fetchSessionState(session.id)}>
          <Text style={styles.refreshHeaderText}>🔄 Refresh</Text>
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

        {activities.map(renderActivityItem)}
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
});
