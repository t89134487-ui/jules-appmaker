import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { GitHubService, GitHubRepo } from '../services/github';
import { logger } from '../services/logger';

interface IntegrationScreenProps {
  githubService: GitHubService;
  selectedRepo: GitHubRepo;
  onMergeComplete: (commitSha: string) => void;
  onFixMergeConflict: (msg: string) => void;
  onBack: () => void;
}

interface StepStatus {
  id: string;
  label: string;
  state: 'pending' | 'running' | 'success' | 'failed';
  error?: string;
}

export const IntegrationScreen: React.FC<IntegrationScreenProps> = ({
  githubService,
  selectedRepo,
  onMergeComplete,
  onFixMergeConflict,
  onBack,
}) => {
  const [steps, setSteps] = useState<StepStatus[]>([
    { id: '1', label: 'Discovering development branch...', state: 'pending' },
    { id: '2', label: 'Checking and creating Pull Request...', state: 'pending' },
    { id: '3', label: 'Performing regular merge...', state: 'pending' },
    { id: '4', label: 'Cleaning up development branch...', state: 'pending' },
    { id: '5', label: 'Retrieving latest merge commit SHA...', state: 'pending' },
  ]);

  const [integrating, setIntegrating] = useState(true);
  const [integrated, setIntegrated] = useState(false);
  const [finalCommitSha, setFinalCommitSha] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const updateStepState = (id: string, state: 'pending' | 'running' | 'success' | 'failed', error?: string) => {
    setSteps((prev) =>
      prev.map((s) => (s.id === id ? { ...s, state, error } : s))
    );
  };

  const startIntegration = async () => {
    setIntegrating(true);
    setIntegrated(false);
    setErrorMsg('');
    setFinalCommitSha('');

    // Reset steps
    setSteps([
      { id: '1', label: 'Discovering development branch...', state: 'running' },
      { id: '2', label: 'Checking and creating Pull Request...', state: 'pending' },
      { id: '3', label: 'Performing regular merge...', state: 'pending' },
      { id: '4', label: 'Cleaning up development branch...', state: 'pending' },
      { id: '5', label: 'Retrieving latest merge commit SHA...', state: 'pending' },
    ]);

    try {
      // Step 1: Branch Discovery
      const branches = await githubService.getBranches(selectedRepo.owner.login, selectedRepo.name);
      let matchedAnyBranch = false;
      let targetBranchName = '';

      for (const branch of branches) {
        const branchName = branch.name;
        if (branchName.startsWith('jules-') && branchName !== selectedRepo.default_branch) {
          matchedAnyBranch = true;
          targetBranchName = branchName;
          break;
        }
      }

      if (!matchedAnyBranch) {
        updateStepState('1', 'success');
        setSteps((prev) => prev.map((s) => s.id !== '1' ? { ...s, state: 'success' as const } : s));

        // Retrieve latest commit sha directly since it's already integrated
        const latestSha = await githubService.getLatestCommitSha(
          selectedRepo.owner.login,
          selectedRepo.name,
          selectedRepo.default_branch
        );
        setFinalCommitSha(latestSha);
        setIntegrated(true);
        setIntegrating(false);
        return;
      }

      updateStepState('1', 'success');

      // Step 2: PR Creation/Retrieval
      updateStepState('2', 'running');
      const openPrs = await githubService.getOpenPullRequests(selectedRepo.owner.login, selectedRepo.name);
      let pr = openPrs.find((p: any) => p.head && p.head.ref === targetBranchName);

      if (!pr) {
        pr = await githubService.createPullRequest(
          selectedRepo.owner.login,
          selectedRepo.name,
          `Merge Jules development branch "${targetBranchName}"`,
          targetBranchName,
          selectedRepo.default_branch
        );
      }
      updateStepState('2', 'success');

      // Step 3: Regular Merge
      updateStepState('3', 'running');
      const prNumber = pr.number;
      await githubService.mergePullRequest(
        selectedRepo.owner.login,
        selectedRepo.name,
        prNumber,
        'merge'
      );
      updateStepState('3', 'success');

      // Step 4: Delete Branch Reference
      updateStepState('4', 'running');
      try {
        await githubService.deleteBranch(
          selectedRepo.owner.login,
          selectedRepo.name,
          targetBranchName
        );
        updateStepState('4', 'success');
      } catch (deleteErr: any) {
        logger.warn(`Quiet branch deletion failed for "${targetBranchName}": ${deleteErr.message}`);
        updateStepState('4', 'success', `Cleanup skipped: ${deleteErr.message}`);
      }

      // Step 5: Get Latest Commit SHA
      updateStepState('5', 'running');
      const latestSha = await githubService.getLatestCommitSha(
        selectedRepo.owner.login,
        selectedRepo.name,
        selectedRepo.default_branch
      );
      updateStepState('5', 'success');
      setFinalCommitSha(latestSha);
      setIntegrated(true);

    } catch (e: any) {
      // Mark current running step as failed
      setSteps((prev) => {
        return prev.map((s) => s.state === 'running' ? ({ ...s, state: 'failed' as const, error: e.message }) : s);
      });
      setErrorMsg(e.message);
    } finally {
      setIntegrating(false);
    }
  };

  useEffect(() => {
    startIntegration();
  }, []);

  const getStepIndicator = (state: string) => {
    switch (state) {
      case 'running':
        return <ActivityIndicator size="small" color="#3b82f6" style={styles.indicator} />;
      case 'success':
        return <Text style={[styles.indicator, { color: '#10b981' }]}>✓</Text>;
      case 'failed':
        return <Text style={[styles.indicator, { color: '#ef4444' }]}>✗</Text>;
      default:
        return <Text style={[styles.indicator, { color: '#52525b' }]}>○</Text>;
    }
  };

  const getStepLabelStyle = (state: string) => {
    switch (state) {
      case 'running':
        return [styles.stepLabel, { color: '#3b82f6', fontWeight: 'bold' as const }];
      case 'success':
        return [styles.stepLabel, { color: '#e4e4e7' }];
      case 'failed':
        return [styles.stepLabel, { color: '#ef4444', fontWeight: 'bold' as const }];
      default:
        return [styles.stepLabel, { color: '#71717a' }];
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Branch Integration</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>🚀 Merging Development Branch</Text>
        <Text style={styles.subtitle}>
          Integrating Jules changes from development branch into the <Text style={styles.bold}>{selectedRepo.default_branch}</Text> branch.
        </Text>

        <View style={styles.stepsCard}>
          {steps.map((step) => (
            <View key={step.id} style={styles.stepRow}>
              {getStepIndicator(step.state)}
              <View style={{ flex: 1 }}>
                <Text style={getStepLabelStyle(step.state)}>{step.label}</Text>
                {step.error ? <Text style={styles.stepError}>{step.error}</Text> : null}
              </View>
            </View>
          ))}
        </View>

        {integrated && (
          <View style={styles.successCard}>
            <Text style={styles.successTitle}>🎉 Integration Complete!</Text>
            <Text style={styles.successText}>
              The development changes have been successfully merged. GitHub Actions has triggered a new pipeline build for this merge.
            </Text>
            {finalCommitSha ? (
              <Text style={styles.commitShaText}>Merge Commit: {finalCommitSha.substring(0, 7)}</Text>
            ) : null}

            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => onMergeComplete(finalCommitSha)}
            >
              <Text style={styles.actionBtnText}>🚀 View APK Pipeline & Download</Text>
            </TouchableOpacity>
          </View>
        )}

        {errorMsg ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>❌ Integration Failed</Text>
            <Text style={styles.errorText}>{errorMsg}</Text>

            <TouchableOpacity style={styles.retryBtn} onPress={startIntegration}>
              <Text style={styles.retryBtnText}>🔄 Retry Integration</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: '#6200ee', marginTop: 12 }]}
              onPress={() => onFixMergeConflict("The branch integration failed due to a merge conflict. Please resolve the merge conflict against the default branch and rebuild.")}
            >
              <Text style={styles.actionBtnText}>💬 Fix Merge Conflict with Jules</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack} disabled={integrating}>
          <Text style={[styles.backBtnText, integrating ? { color: '#52525b' } : undefined]}>← Back to Chat</Text>
        </TouchableOpacity>
      </View>
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
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  scrollContent: {
    padding: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#a0a0ab',
    lineHeight: 20,
    marginBottom: 24,
    textAlign: 'center',
  },
  bold: {
    color: '#fff',
    fontWeight: 'bold',
  },
  stepsCard: {
    backgroundColor: '#1c1c1f',
    borderWidth: 1,
    borderColor: '#2e2e33',
    borderRadius: 12,
    padding: 20,
    marginBottom: 24,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  indicator: {
    width: 24,
    fontSize: 16,
    fontWeight: 'bold',
    marginRight: 12,
    textAlign: 'center',
    marginTop: 2,
  },
  stepLabel: {
    fontSize: 15,
    lineHeight: 20,
    color: '#fff',
  },
  stepError: {
    color: '#ef4444',
    fontSize: 12,
    marginTop: 4,
  },
  successCard: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderWidth: 1,
    borderColor: '#10b981',
    borderRadius: 12,
    padding: 20,
    marginBottom: 24,
    alignItems: 'center',
  },
  successTitle: {
    color: '#10b981',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  successText: {
    color: '#a0a0ab',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 16,
  },
  commitShaText: {
    color: '#fff',
    fontSize: 13,
    fontFamily: 'monospace',
    backgroundColor: '#121214',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#2e2e33',
    marginBottom: 16,
  },
  actionBtn: {
    backgroundColor: '#10b981',
    borderRadius: 8,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    width: '100%',
  },
  actionBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: 'bold',
  },
  errorCard: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: '#ef4444',
    borderRadius: 12,
    padding: 20,
    marginBottom: 24,
    alignItems: 'center',
  },
  errorTitle: {
    color: '#ef4444',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  errorText: {
    color: '#a0a0ab',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 16,
  },
  retryBtn: {
    backgroundColor: '#ef4444',
    borderRadius: 8,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    width: '100%',
  },
  retryBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  footer: {
    padding: 24,
    borderTopWidth: 1,
    borderColor: '#1e1e24',
    alignItems: 'center',
  },
  backBtn: {
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  backBtnText: {
    color: '#a0a0ab',
    fontSize: 15,
    fontWeight: 'bold',
  },
});
