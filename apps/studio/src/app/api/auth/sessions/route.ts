import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getSession, listSessions, revokeSessionById, clearSessionCookie } from '@/services/auth';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';

export const dynamic = 'force-dynamic';

const rateLimiter = createInMemoryRateLimiter(RATE_LIMITS.general);

export async function GET(request: NextRequest) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) return rateLimitResponse;

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sessions = await listSessions(session.user.id);
  const data = sessions.map((s) => ({
    ...s,
    isCurrent: s.id === session.session.id,
  }));

  return NextResponse.json({ sessions: data });
}

export async function POST(request: NextRequest) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) return rateLimitResponse;

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const sessionId = String(body?.sessionId ?? '').trim();

  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
  }

  await revokeSessionById(session.user.id, sessionId);

  const response = NextResponse.json({ success: true });
  if (sessionId === session.session.id) {
    clearSessionCookie(response);
  }

  return response;
}
