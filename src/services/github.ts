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

export class GitHubService {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  private async fetchWithAuth(url: string, options: RequestInit = {}): Promise<any> {
    const headers = {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...options.headers,
    };

    const res = await fetch(url, { ...options, headers });
    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`GitHub API Error: ${res.status} ${res.statusText} - ${errorText}`);
    }

    if (res.status === 204) return null;
    return res.json();
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
}
