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
    logger.info(`Jules Request: ${method} ${url}`, options.body ? String(options.body) : undefined);

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

      if (res.status === 204) {
        logger.info(`Jules Response code: ${res.status}`);
        return null;
      }
      const data = await res.json();
      logger.info(`Jules Response success: ${res.status}`, JSON.stringify(data));
      return data;
    } catch (e: any) {
      logger.error(`Jules Fetch Failure: ${e.message}`);
      throw e;
    }
  }

  /**
   * Helper function that calls the Jules API with a custom X-Goog-FieldMask HTTP header.
   * This optimizes response payload sizes by requesting only specific fields.
   *
   * @param path The relative API endpoint path (e.g., 'sessions/1234')
   * @param fields Array of required fields (e.g., ['id', 'title', 'state'])
   * @param options Additional RequestInit options
   */
  async fetchWithFieldMask(
    path: string,
    fields: string[],
    options: RequestInit = {}
  ): Promise<any> {
    const fieldMask = fields.join(',');
    const headers = {
      'X-Goog-FieldMask': fieldMask,
      ...options.headers,
    };

    const url = path.startsWith('http') ? path : `${this.baseUrl}/${path}`;
    return this.fetchWithAuth(url, { ...options, headers });
  }

  /**
   * List all connected sources (repositories)
   */
  async getSources(): Promise<JulesSource[]> {
    const data = await this.fetchWithFieldMask('sources?pageSize=50', [
      'sources.id',
      'sources.githubRepo'
    ]);
    return data.sources || [];
  }

  /**
   * List sessions
   */
  async getSessions(): Promise<JulesSession[]> {
    const data = await this.fetchWithFieldMask('sessions?pageSize=50', [
      'sessions.id',
      'sessions.title',
      'sessions.state',
      'sessions.createTime',
      'sessions.updateTime',
      'sessions.prompt',
      'sessions.sourceContext'
    ]);
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
    // Dynamically look up connected sources first to match the exact source identifier
    // to avoid formatting mismatches causing 404 errors.
    let sourcePath = '';
    try {
      logger.info(`Looking up source name for ${options.repoOwner}/${options.repoName}...`);
      const sources = await this.getSources();
      const match = sources.find((src) => {
        if (src.githubRepo) {
          return (
            src.githubRepo.owner.toLowerCase() === options.repoOwner.toLowerCase() &&
            src.githubRepo.repo.toLowerCase() === options.repoName.toLowerCase()
          );
        }
        return false;
      });

      if (match) {
        sourcePath = match.name;
        logger.info(`Source matched on Jules! Using exact source identifier: "${sourcePath}"`);
      } else {
        logger.warn(`Source not found in Jules connected sources list.`);
      }
    } catch (err: any) {
      logger.warn(`Failed to dynamically fetch sources for matching: ${err.message}`);
    }

    // Fallback to formatted string if dynamic match failed
    if (!sourcePath) {
      const sourceId = `github-${options.repoOwner}-${options.repoName}`.toLowerCase();
      sourcePath = `sources/${sourceId}`;
      logger.info(`Using fallback formatted source path: "${sourcePath}"`);
    }

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
        requirePlanApproval: false, // Explicitly set to false so Jules auto-approves plans and executes them natively without any manual step!
        automationMode: 'AUTO_CREATE_PR', // Reverted back to the official supported value 'AUTO_CREATE_PR' to avoid API validation errors
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
   * Uses field masking to only fetch required fields, discarding heavy unused fields.
   */
  async getActivities(sessionId: string): Promise<JulesActivity[]> {
    const cleanedId = sessionId.startsWith('sessions/') ? sessionId : `sessions/${sessionId}`;
    let allActivities: JulesActivity[] = [];
    let pageToken = '';

    try {
      do {
        const path = `${cleanedId}/activities?pageSize=100${pageToken ? `&pageToken=${pageToken}` : ''}`;
        const data = await this.fetchWithFieldMask(path, [
          'nextPageToken',
          'activities.id',
          'activities.name',
          'activities.originator',
          'activities.description',
          'activities.createTime',
          'activities.userMessaged',
          'activities.agentMessaged',
          'activities.planGenerated',
          'activities.progressUpdated',
          'activities.sessionCompleted',
          'activities.sessionFailed',
        ]);
        if (data.activities && data.activities.length > 0) {
          allActivities = allActivities.concat(data.activities);
        }
        pageToken = data.nextPageToken || '';
      } while (pageToken);
    } catch (e: any) {
      logger.error(`Failed to walk paginated activities: ${e.message}`);
    }

    return allActivities;
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
