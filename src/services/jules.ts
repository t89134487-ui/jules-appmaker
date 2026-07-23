export interface JulesSource {
  name: string;
  id: string;
  githubRepo?: {
    owner: string;
    repo: string;
    isPrivate: boolean;
    defaultBranch: {
      displayName: string;
    };
    branches: Array<{ displayName: string }>;
  };
}

export interface JulesSession {
  name: string; // e.g., "sessions/123456"
  id: string;
  prompt: string;
  title?: string;
  state: 'QUEUED' | 'PLANNING' | 'AWAITING_PLAN_APPROVAL' | 'AWAITING_USER_FEEDBACK' | 'IN_PROGRESS' | 'PAUSED' | 'COMPLETED' | 'FAILED';
  url: string;
  createTime: string;
  updateTime: string;
}

export interface JulesStep {
  id: string;
  index: number;
  title: string;
  description: string;
}

export interface JulesPlan {
  id: string;
  steps: JulesStep[];
  createTime: string;
}

export interface JulesActivity {
  name: string;
  id: string;
  originator: 'system' | 'agent' | 'user';
  description: string;
  createTime: string;
  planGenerated?: {
    plan: JulesPlan;
  };
  planApproved?: {
    planId: string;
  };
  userMessaged?: {
    userMessage: string;
  };
  agentMessaged?: {
    agentMessage: string;
  };
  progressUpdated?: {
    title: string;
    description: string;
  };
  sessionCompleted?: Record<string, any>;
  sessionFailed?: {
    reason: string;
  };
  artifacts?: Array<{
    changeSet?: {
      source: string;
      gitPatch: {
        baseCommitId: string;
        unidiffPatch: string;
        suggestedCommitMessage: string;
      };
    };
    bashOutput?: {
      command: string;
      output: string;
      exitCode: number;
    };
  }>;
}

import { logger } from './logger';

export class JulesService {
  private apiKey: string;
  private baseUrl = 'https://jules.googleapis.com/v1alpha';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    logger.info('JulesService initialized with API key');
  }

  private async fetchWithAuth(url: string, options: RequestInit = {}): Promise<any> {
    const method = options.method || 'GET';
    logger.info(`Jules Request: ${method} ${url}`);
    if (options.body) {
      logger.info(`Jules Request Body: ${options.body}`);
    }

    const headers = {
      'x-goog-api-key': this.apiKey,
      'Content-Type': 'application/json',
      ...options.headers,
    };

    try {
      const res = await fetch(url, { ...options, headers });
      if (!res.ok) {
        const errorText = await res.text();
        logger.error(`Jules API raw error response: ${errorText}`);
        let parsedErr: any;
        try {
          parsedErr = JSON.parse(errorText);
        } catch {
          parsedErr = null;
        }
        const msg = parsedErr?.error?.message || res.statusText || errorText;
        logger.error(`Jules API Error parsed: ${res.status} - ${msg}`);
        throw new Error(`Jules API Error: ${res.status} - ${msg}`);
      }

      logger.info(`Jules Response code: ${res.status}`);
      if (res.status === 204) return null;
      const data = await res.json();
      logger.info(`Jules Response payload success: ${JSON.stringify(data).substring(0, 300)}...`);
      return data;
    } catch (e: any) {
      logger.error(`Jules Fetch Failure: ${e.message}`);
      throw e;
    }
  }

  /**
   * List all connected sources (repositories)
   */
  async getSources(): Promise<JulesSource[]> {
    const data = await this.fetchWithAuth(`${this.baseUrl}/sources?pageSize=50`);
    return data.sources || [];
  }

  /**
   * List sessions
   */
  async getSessions(): Promise<JulesSession[]> {
    const data = await this.fetchWithAuth(`${this.baseUrl}/sessions?pageSize=50`);
    return data.sessions || [];
  }

  /**
   * Create a new session on a specific github source repository.
   */
  async createSession(options: {
    prompt: string;
    repoOwner: string;
    repoName: string;
    branch?: string;
    requirePlanApproval?: boolean;
  }): Promise<JulesSession> {
    // Construct the source resource name format expected by Jules: sources/github-owner-repo
    const sourceId = `github-${options.repoOwner}-${options.repoName}`.toLowerCase();
    const sourcePath = `sources/${sourceId}`;

    return this.fetchWithAuth(`${this.baseUrl}/sessions`, {
      method: 'POST',
      body: JSON.stringify({
        prompt: options.prompt,
        sourceContext: {
          source: sourcePath,
          githubRepoContext: {
            startingBranch: options.branch || 'main',
          },
        },
        requirePlanApproval: options.requirePlanApproval ?? true,
        automationMode: 'AUTO_CREATE_PR',
      }),
    });
  }

  /**
   * Retrieves single session detail
   */
  async getSession(sessionId: string): Promise<JulesSession> {
    // Accept either "sessions/1234" or just "1234"
    const cleanedId = sessionId.startsWith('sessions/') ? sessionId : `sessions/${sessionId}`;
    return this.fetchWithAuth(`${this.baseUrl}/${cleanedId}`);
  }

  /**
   * Retrieves activities for a session to show plan, logs, and messages.
   */
  async getActivities(sessionId: string): Promise<JulesActivity[]> {
    const cleanedId = sessionId.startsWith('sessions/') ? sessionId : `sessions/${sessionId}`;
    const data = await this.fetchWithAuth(`${this.baseUrl}/${cleanedId}/activities?pageSize=100`);
    return data.activities || [];
  }

  /**
   * Sends a user chat message into the active session
   */
  async sendMessage(sessionId: string, message: string): Promise<void> {
    const cleanedId = sessionId.startsWith('sessions/') ? sessionId : `sessions/${sessionId}`;
    await this.fetchWithAuth(`${this.baseUrl}/${cleanedId}:sendMessage`, {
      method: 'POST',
      body: JSON.stringify({
        prompt: message,
      }),
    });
  }

  /**
   * Approves a plan in a session
   */
  async approvePlan(sessionId: string): Promise<void> {
    const cleanedId = sessionId.startsWith('sessions/') ? sessionId : `sessions/${sessionId}`;
    await this.fetchWithAuth(`${this.baseUrl}/${cleanedId}:approvePlan`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }
}
