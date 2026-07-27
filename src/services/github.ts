export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  owner: {
    login: string;
    avatar_url: string;
  };
  html_url: string;
  description: string | null;
  default_branch: string;
}

export interface GitHubWorkflowRun {
  id: number;
  status: string;
  conclusion: string | null;
  html_url: string;
  created_at: string;
}

export interface GitHubReleaseAsset {
  id: number;
  name: string;
  browser_download_url: string;
  content_type: string;
}

export interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string;
  html_url: string;
  assets: GitHubReleaseAsset[];
}

import { logger } from './logger';

export class GitHubService {
  private token: string;

  constructor(token: string) {
    this.token = token;
    logger.info('GitHubService initialized with token');
  }

  private async fetchWithAuth(url: string, options: RequestInit = {}): Promise<any> {
    const method = options.method || 'GET';
    logger.info(`GitHub Request: ${method} ${url}`);

    const headers = {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...options.headers,
    };

    try {
      const res = await fetch(url, { ...options, headers });
      if (!res.ok) {
        const errorText = await res.text();
        logger.error(`GitHub API Error: ${res.status} ${res.statusText} - ${errorText}`);
        throw new Error(`GitHub API Error: ${res.status} ${res.statusText} - ${errorText}`);
      }

      logger.info(`GitHub Response: ${res.status} ${res.statusText}`);
      if (res.status === 204) return null;
      return res.json();
    } catch (e: any) {
      logger.error(`GitHub Fetch Failure: ${e.message}`);
      throw e;
    }
  }

  /**
   * Fetches the repositories belonging to the authenticated user.
   */
  async getRepositories(): Promise<GitHubRepo[]> {
    return this.fetchWithAuth('https://api.github.com/user/repos?sort=updated&per_page=50');
  }

  /**
   * Creates a new repository on the authenticated user's account.
   */
  async createRepository(name: string, isPrivate: boolean = false): Promise<GitHubRepo> {
    return this.fetchWithAuth('https://api.github.com/user/repos', {
      method: 'POST',
      body: JSON.stringify({
        name,
        private: isPrivate,
        auto_init: true, // Auto-initialize with README to make it ready for Jules
        description: 'App built autonomously using Jules',
      }),
    });
  }

  /**
   * Fetches the user profile details.
   */
  async getUserProfile(): Promise<{ login: string; avatar_url: string; name: string }> {
    return this.fetchWithAuth('https://api.github.com/user');
  }

  /**
   * Polls the workflow runs in the specified repository to check build status.
   */
  async getWorkflowRuns(owner: string, repo: string): Promise<GitHubWorkflowRun[]> {
    try {
      const data = await this.fetchWithAuth(
        `https://api.github.com/repos/${owner}/${repo}/actions/runs?per_page=10`
      );
      return data.workflow_runs || [];
    } catch (e) {
      console.warn('Failed to fetch workflow runs', e);
      return [];
    }
  }

  /**
   * Polls releases in the specified repository to find the built APK.
   */
  async getReleases(owner: string, repo: string): Promise<GitHubRelease[]> {
    try {
      return await this.fetchWithAuth(`https://api.github.com/repos/${owner}/${repo}/releases`);
    } catch (e) {
      console.warn('Failed to fetch releases', e);
      return [];
    }
  }

  /**
   * Searches for release assets with .apk extension in the latest release.
   */
  async getLatestApkAsset(owner: string, repo: string): Promise<GitHubReleaseAsset | null> {
    const releases = await this.getReleases(owner, repo);
    if (!releases || releases.length === 0) return null;

    // Check release assets
    for (const release of releases) {
      const apkAsset = release.assets.find(
        (asset) => asset.name.endsWith('.apk') || asset.content_type === 'application/vnd.android.package-archive'
      );
      if (apkAsset) return apkAsset;
    }
    return null;
  }

  /**
   * Merges a Pull Request directly via the GitHub API using the user's token.
   */
  async mergePullRequest(owner: string, repo: string, prNumber: number): Promise<{ merged: boolean; message: string }> {
    logger.info(`GitHub: Attempting to automatically merge PR #${prNumber} on ${owner}/${repo}...`);
    return this.fetchWithAuth(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/merge`, {
      method: 'PUT',
      body: JSON.stringify({
        commit_title: `Auto-merge Jules generated app code (PR #${prNumber})`,
        commit_message: 'Merged automatically by Jules App Maker on mobile.',
        merge_method: 'merge', // 'merge', 'squash', or 'rebase'
      }),
    });
  }

  /**
   * Fetches the latest commit SHA of the specified branch.
   */
  async getLatestCommitSha(owner: string, repo: string, branch: string): Promise<string> {
    logger.info(`GitHubService: Fetching latest commit SHA for branch ${branch} in ${owner}/${repo}...`);
    const commits = await this.fetchWithAuth(
      `https://api.github.com/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=1`
    );
    if (commits && commits.length > 0) {
      return commits[0].sha;
    }
    throw new Error('No commits found on branch ' + branch);
  }

  /**
   * Searches for release assets with .apk extension in releases matching the short commit SHA.
   */
  async getApkAssetForCommit(owner: string, repo: string, shortSha: string): Promise<GitHubReleaseAsset | null> {
    logger.info(`GitHubService: Searching for APK asset matching commit short SHA: ${shortSha} in ${owner}/${repo}...`);
    const releases = await this.getReleases(owner, repo);
    if (!releases || releases.length === 0) {
      logger.info('GitHubService: No releases found.');
      return null;
    }

    for (const release of releases) {
      // Check if release tag name contains the short SHA (case-insensitive search)
      if (release.tag_name.toLowerCase().includes(shortSha.toLowerCase())) {
        logger.info(`GitHubService: Found matching release: ${release.tag_name}`);
        const apkAsset = release.assets.find(
          (asset) => asset.name.endsWith('.apk') || asset.content_type === 'application/vnd.android.package-archive'
        );
        if (apkAsset) {
          logger.info(`GitHubService: Found APK asset: ${apkAsset.name}`);
          return apkAsset;
        }
      }
    }
    logger.info(`GitHubService: No matching APK release asset found for commit short SHA: ${shortSha}`);
    return null;
  }
}
