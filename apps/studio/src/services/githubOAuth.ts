import { randomBytes } from 'crypto';
import type { NextRequest } from 'next/server';

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_API_BASE_URL = 'https://api.github.com';
const GITHUB_SCOPE = 'read:user user:email';

type GitHubOAuthUser = {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
};

type GitHubEmail = {
  email: string;
  primary: boolean;
  verified: boolean;
  visibility: string | null;
};

export function createGitHubState() {
  return randomBytes(32).toString('hex');
}

export function getGitHubClientId(): string | null {
  const value = process.env.GITHUB_CLIENT_ID?.trim();
  return value || null;
}

export function getGitHubClientSecret(): string | null {
  const value = process.env.GITHUB_CLIENT_SECRET?.trim();
  return value || null;
}

export function resolveGitHubCallbackUrl(request: NextRequest): string {
  const configured = process.env.GITHUB_CALLBACK_URL?.trim();
  if (configured) return configured;
  return new URL('/auth/callback', request.url).toString();
}

export function buildGitHubAuthorizeUrl(args: {
  clientId: string;
  callbackUrl: string;
  state: string;
}) {
  const url = new URL(GITHUB_AUTHORIZE_URL);
  url.searchParams.set('client_id', args.clientId);
  url.searchParams.set('redirect_uri', args.callbackUrl);
  url.searchParams.set('state', args.state);
  url.searchParams.set('scope', GITHUB_SCOPE);
  url.searchParams.set('allow_signup', 'true');
  return url.toString();
}

export async function exchangeGitHubCode(args: {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
  code: string;
}): Promise<string> {
  const response = await fetch(GITHUB_ACCESS_TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: args.clientId,
      client_secret: args.clientSecret,
      code: args.code,
      redirect_uri: args.callbackUrl,
    }).toString(),
  });

  const data = (await response.json().catch(() => null)) as
    | { access_token?: string; error?: string; error_description?: string }
    | null;

  if (!response.ok || !data?.access_token) {
    const detail = data?.error_description || data?.error || `HTTP ${response.status}`;
    throw new Error(`GitHub token exchange failed: ${detail}`);
  }

  return data.access_token;
}

export async function fetchGitHubProfile(accessToken: string): Promise<GitHubOAuthUser> {
  const response = await fetch(`${GITHUB_API_BASE_URL}/user`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  const data = (await response.json().catch(() => null)) as GitHubOAuthUser | null;
  if (!response.ok || !data || typeof data.id !== 'number' || typeof data.login !== 'string') {
    throw new Error(`GitHub profile fetch failed: HTTP ${response.status}`);
  }

  return data;
}

export async function fetchGitHubEmails(accessToken: string): Promise<GitHubEmail[]> {
  const response = await fetch(`${GITHUB_API_BASE_URL}/user/emails`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  const data = (await response.json().catch(() => null)) as GitHubEmail[] | { message?: string } | null;
  if (!response.ok || !Array.isArray(data)) {
    const detail = data && 'message' in data ? data.message : `HTTP ${response.status}`;
    throw new Error(`GitHub email fetch failed: ${detail}`);
  }

  return data;
}

export function resolveGitHubVerifiedEmail(profile: GitHubOAuthUser, emails: GitHubEmail[]) {
  void profile;
  const verifiedPrimary = emails.find((item) => item.primary && item.verified);
  if (verifiedPrimary) return verifiedPrimary.email;

  const verified = emails.find((item) => item.verified);
  if (verified) return verified.email;

  return null;
}
