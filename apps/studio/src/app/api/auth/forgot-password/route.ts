import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createPasswordReset } from '@/services/auth';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';

export const dynamic = 'force-dynamic';

const rateLimiter = createInMemoryRateLimiter(RATE_LIMITS.strict);

type ForgotPasswordResponse = {
  success: boolean;
  resetToken?: string;
};

export async function POST(request: NextRequest) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const body = await request.json();
  const email = String(body?.email ?? '').trim().toLowerCase();

  if (!email) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 });
  }

  const reset = await createPasswordReset(email);

  const payload: ForgotPasswordResponse = { success: true };
  if (process.env.NODE_ENV !== 'production' && reset) {
    payload.resetToken = reset.token;
  }

  return NextResponse.json(payload);
}
