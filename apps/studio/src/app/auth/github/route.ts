import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getSession } from '@/services/auth';
import {
  buildGitHubAuthorizeUrl,
  createGitHubState,
  getGitHubClientId,
  resolveGitHubCallbackUrl,
} from '@/services/githubOAuth';

export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'github_oauth_state';
const BIND_COOKIE = 'github_oauth_bind_user_id';
const STATE_MAX_AGE_SECONDS = 10 * 60;

export async function GET(request: NextRequest) {
  const clientId = getGitHubClientId();
  if (!clientId) {
    return NextResponse.redirect(new URL('/login?error=oauth_failed', request.url));
  }

  const mode = new URL(request.url).searchParams.get('mode');
  const session = await getSession();
  if (mode === 'link' && !session) {
    return NextResponse.redirect(new URL('/login?error=oauth_failed', request.url));
  }

  const state = createGitHubState();
  const callbackUrl = resolveGitHubCallbackUrl(request);
  const authorizeUrl = buildGitHubAuthorizeUrl({
    clientId,
    callbackUrl,
    state,
  });

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/auth/callback',
    maxAge: STATE_MAX_AGE_SECONDS,
  });

  if (mode === 'link' && session) {
    response.cookies.set(BIND_COOKIE, session.user.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/auth/callback',
      maxAge: STATE_MAX_AGE_SECONDS,
    });
  }
  return response;
}
