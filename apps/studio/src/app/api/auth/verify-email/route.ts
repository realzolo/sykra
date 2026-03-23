import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifyEmailToken } from '@/services/auth';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';

export const dynamic = 'force-dynamic';

const rateLimiter = createInMemoryRateLimiter(RATE_LIMITS.strict);

export async function POST(request: NextRequest) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const body = await request.json();
  const token = String(body?.token ?? '').trim();

  if (!token) {
    return NextResponse.json({ error: 'Token is required' }, { status: 400 });
  }

  const ok = await verifyEmailToken(token);
  if (!ok) {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
