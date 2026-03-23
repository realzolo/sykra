import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { formatErrorResponse } from '@/services/retry';
import { authenticateUser, createSession, setSessionCookie } from '@/services/auth';
import { ensurePersonalOrg } from '@/services/orgs';
import { syncUserAvatar } from '@/services/avatars';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { auditLogger, extractClientInfo } from '@/services/audit';

export const dynamic = 'force-dynamic';

const rateLimiter = createInMemoryRateLimiter(RATE_LIMITS.strict);

export async function POST(request: NextRequest) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  try {
    const body = await request.json();
    const email = String(body?.email ?? '').trim().toLowerCase();
    const password = String(body?.password ?? '');

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip');
    const userAgent = request.headers.get('user-agent');

    const result = await authenticateUser(email, password, ip, userAgent);
    if ('error' in result) {
      switch (result.error) {
        case 'RATE_LIMITED':
          return NextResponse.json(
            { error: 'Too many attempts', code: result.error, retryAfter: result.retryAfter },
            { status: 429 }
          );
        case 'ACCOUNT_LOCKED':
          return NextResponse.json(
            { error: 'Account locked', code: result.error, lockedUntil: result.lockedUntil },
            { status: 423 }
          );
        case 'EMAIL_NOT_VERIFIED':
          return NextResponse.json({ error: 'Email not verified', code: result.error }, { status: 403 });
        case 'ACCOUNT_DISABLED':
          return NextResponse.json({ error: 'Account disabled', code: result.error }, { status: 403 });
        default:
          return NextResponse.json({ error: 'Invalid credentials', code: result.error }, { status: 401 });
      }
    }

    const user = result.user;

    const { token, expiresAt } = await createSession(
      user.id,
      ip,
      userAgent
    );

    await syncUserAvatar(user.id).catch(() => undefined);

    await ensurePersonalOrg(user.id, user.email ?? null);

    const response = NextResponse.json({ user: { id: user.id, email: user.email, displayName: user.displayName } });
    setSessionCookie(response, token, expiresAt);

    const clientInfo = extractClientInfo(request);
    await auditLogger.log({
      action: 'login',
      entityType: 'user',
      entityId: user.id,
      userId: user.id,
      ...clientInfo,
    });

    return response;
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    return NextResponse.json({ error }, { status: statusCode });
  }
}
