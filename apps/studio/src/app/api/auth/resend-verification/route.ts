import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createEmailVerification, sendVerificationEmail } from '@/services/auth';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { queryOne } from '@/lib/db';
import { getEmailDeliveryStatus } from '@/services/email';

export const dynamic = 'force-dynamic';

const rateLimiter = createInMemoryRateLimiter(RATE_LIMITS.strict);

type ResendVerificationResponse = {
  success: boolean;
};

export async function POST(request: NextRequest) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const deliveryStatus = getEmailDeliveryStatus();
  if (deliveryStatus.mode !== 'live') {
    return NextResponse.json(
      {
        error: 'Email delivery is not configured for live sending',
        code: 'EMAIL_DELIVERY_UNAVAILABLE',
      },
      { status: 503 }
    );
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

  if (user && user.status !== 'disabled' && !user.email_verified_at) {
    const verification = await createEmailVerification(user.id);
    const baseUrl = process.env.STUDIO_BASE_URL?.trim() || new URL(request.url).origin;
    await sendVerificationEmail(email, verification.token, baseUrl);
  }

  const payload: ResendVerificationResponse = { success: true };
  return NextResponse.json(payload);
}
