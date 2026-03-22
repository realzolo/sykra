import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createEmailVerification, isEmailVerificationRequired, sendVerificationEmail } from '@/services/auth';
import { createRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { queryOne } from '@/lib/db';

export const dynamic = 'force-dynamic';

const rateLimiter = createRateLimiter(RATE_LIMITS.strict);

export async function POST(request: NextRequest) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  if (!isEmailVerificationRequired()) {
    return NextResponse.json({ success: true, verificationRequired: false });
  }

  const body = await request.json();
  const email = String(body?.email ?? '').trim().toLowerCase();

  if (!email) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 });
  }

  const user = await queryOne<{ id: string; status: string; email_verified_at: string | null }>(
    `select id, status, email_verified_at from auth_users where email = $1`,
    [email]
  );

  let token: string | undefined;
  if (user && user.status !== 'disabled' && !user.email_verified_at) {
    const verification = await createEmailVerification(user.id);
    token = verification.token;
    const baseUrl = process.env.STUDIO_BASE_URL?.trim() || new URL(request.url).origin;
    await sendVerificationEmail(email, verification.token, baseUrl);
  }

  const payload: Record<string, unknown> = { success: true };
  if (process.env.NODE_ENV !== 'production' && token) {
    payload.verificationToken = token;
  }

  return NextResponse.json(payload);
}
