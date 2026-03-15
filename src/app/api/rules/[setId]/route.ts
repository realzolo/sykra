import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getRuleSetById } from '@/services/db';
import { createRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { requireUser, unauthorized } from '@/services/auth';
import { getActiveOrgId } from '@/services/orgs';

const rateLimiter = createRateLimiter(RATE_LIMITS.general);

export async function GET(request: NextRequest, { params }: { params: Promise<{ setId: string }> }) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) return rateLimitResponse;

  const user = await requireUser();
  if (!user) return unauthorized();

  const { setId } = await params;
  const data = await getRuleSetById(setId);
  if (!data) {
    return NextResponse.json({ error: 'Rule set not found' }, { status: 404 });
  }

  if (!data.is_global) {
    const orgId = await getActiveOrgId(user.id, user.email ?? undefined, request);
    if (!data.org_id || data.org_id !== orgId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }
  return NextResponse.json(data);
}
