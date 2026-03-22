import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getActiveOrgId } from '@/services/orgs';
import {
  createSession,
  getSession,
  linkOAuthIdentityToUser,
  setSessionCookie,
  upsertOAuthUser,
} from '@/services/auth';
import { syncUserAvatar } from '@/services/avatars';
import {
  exchangeGitHubCode,
  fetchGitHubEmails,
  fetchGitHubProfile,
  getGitHubClientId,
  getGitHubClientSecret,
  resolveGitHubCallbackUrl,
  resolveGitHubVerifiedEmail,
} from '@/services/githubOAuth';

export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'github_oauth_state';
const BIND_COOKIE = 'github_oauth_bind_user_id';

function clearStateCookie(response: NextResponse) {
  response.cookies.set(STATE_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/auth/callback',
    maxAge: 0,
  });
}

function clearBindCookie(response: NextResponse) {
  response.cookies.set(BIND_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/auth/callback',
    maxAge: 0,
  });
}

function loginRedirect(request: NextRequest, error = 'oauth_failed') {
  const response = NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error)}`, request.url));
  clearStateCookie(response);
  clearBindCookie(response);
  return response;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const oauthError = url.searchParams.get('error');
  if (oauthError) {
    return loginRedirect(request);
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) {
    return loginRedirect(request);
  }

  const stateCookie = request.cookies.get(STATE_COOKIE)?.value;
  if (!stateCookie || stateCookie !== state) {
    return loginRedirect(request);
  }

  const clientId = getGitHubClientId();
  const clientSecret = getGitHubClientSecret();
  if (!clientId || !clientSecret) {
    return loginRedirect(request);
  }

  try {
    const bindUserId = request.cookies.get(BIND_COOKIE)?.value ?? null;
    const session = bindUserId ? await getSession() : null;
    if (bindUserId && (!session || session.user.id !== bindUserId)) {
      return loginRedirect(request);
    }

    const callbackUrl = resolveGitHubCallbackUrl(request);
    const accessToken = await exchangeGitHubCode({
      clientId,
      clientSecret,
      callbackUrl,
      code,
    });

    const profile = await fetchGitHubProfile(accessToken);
    const emails = await fetchGitHubEmails(accessToken);
    const email = resolveGitHubVerifiedEmail(profile, emails);
    if (!email) {
      return loginRedirect(request);
    }

    const profilePayload = {
      id: profile.id,
      login: profile.login,
      name: profile.name,
      email,
      avatar_url: profile.avatar_url,
    };

    const user = bindUserId && session
      ? await linkOAuthIdentityToUser({
          userId: session.user.id,
          provider: 'github',
          providerUserId: String(profile.id),
          email: email.toLowerCase(),
          displayName: profile.name?.trim() || profile.login,
          avatarUrl: profile.avatar_url,
          profile: profilePayload,
        })
      : await upsertOAuthUser({
          provider: 'github',
          providerUserId: String(profile.id),
          email: email.toLowerCase(),
          displayName: profile.name?.trim() || profile.login,
          avatarUrl: profile.avatar_url,
          profile: profilePayload,
        });

    await syncUserAvatar(user.id, { force: true }).catch(() => undefined);

    const orgId = await getActiveOrgId(user.id, user.email ?? undefined, request);
    const response = bindUserId && session
      ? NextResponse.redirect(new URL('/account', request.url))
      : NextResponse.redirect(new URL(`/o/${orgId}`, request.url));

    if (!bindUserId) {
      const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip');
      const userAgent = request.headers.get('user-agent');
      const { token, expiresAt } = await createSession(user.id, ip, userAgent);
      setSessionCookie(response, token, expiresAt);
    }

    clearStateCookie(response);
    clearBindCookie(response);
    return response;
  } catch {
    return loginRedirect(request);
  }
}
