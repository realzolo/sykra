import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { formatErrorResponse } from '@/services/retry';
import { createEmailVerification, createUser, deleteAuthUser, isEmailVerificationRequired, sendVerificationEmail } from '@/services/auth';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { auditLogger, extractClientInfo } from '@/services/audit';

export const dynamic = 'force-dynamic';

const rateLimiter = createInMemoryRateLimiter(RATE_LIMITS.strict);

type RegisterResponse = {
  user: { id: string; email: string | null; displayName: string | null };
  verificationRequired: boolean;
  verificationToken?: string;
};

export async function POST(request: NextRequest) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  try {
    const body = await request.json();
    const email = String(body?.email ?? '').trim().toLowerCase();
    const password = String(body?.password ?? '');
    const displayName = typeof body?.displayName === 'string' ? body.displayName.trim() : null;

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    const user = await createUser(email, password, displayName);
    const verificationRequired = isEmailVerificationRequired();
    let verificationToken: string | undefined;
    if (verificationRequired) {
      const verification = await createEmailVerification(user.id);
      verificationToken = verification.token;
      const baseUrl = process.env.STUDIO_BASE_URL?.trim() || new URL(request.url).origin;
      try {
        await sendVerificationEmail(user.email ?? email, verification.token, baseUrl);
      } catch (error) {
        await deleteAuthUser(user.id);
        throw error;
      }
    }

    const clientInfo = extractClientInfo(request);
    await auditLogger.log({
      action: 'create',
      entityType: 'user',
      entityId: user.id,
      userId: user.id,
      ...clientInfo,
    });

    const payload: RegisterResponse = {
      user: { id: user.id, email: user.email, displayName },
      verificationRequired,
    };

    if (process.env.NODE_ENV !== 'production' && verificationToken) {
      payload.verificationToken = verificationToken;
    }

    return NextResponse.json(payload, { status: 201 });
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    return NextResponse.json({ error }, { status: statusCode });
  }
}
