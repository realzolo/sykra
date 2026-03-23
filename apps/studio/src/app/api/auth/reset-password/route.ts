import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { resetPasswordWithToken } from '@/services/auth';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';

export const dynamic = 'force-dynamic';

const rateLimiter = createInMemoryRateLimiter(RATE_LIMITS.strict);

function passwordStrength(value: string) {
  const lengthOk = value.length >= 8;
  const hasUpper = /[A-Z]/.test(value);
  const hasNumber = /[0-9]/.test(value);
  const hasSymbol = /[^A-Za-z0-9]/.test(value);
  return [lengthOk, hasUpper, hasNumber, hasSymbol].filter(Boolean).length;
}

export async function POST(request: NextRequest) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const body = await request.json();
  const token = String(body?.token ?? '').trim();
  const newPassword = String(body?.password ?? '');

  if (!token || !newPassword) {
    return NextResponse.json({ error: 'Token and password are required' }, { status: 400 });
  }

  if (passwordStrength(newPassword) < 3) {
    return NextResponse.json({ error: 'Password is too weak' }, { status: 400 });
  }

  const ok = await resetPasswordWithToken(token, newPassword);
  if (!ok) {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
