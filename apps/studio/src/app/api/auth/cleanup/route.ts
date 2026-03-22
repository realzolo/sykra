import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { cleanupAuthData, requireUser, unauthorized } from '@/services/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const token = request.headers.get('x-task-token');
  if (process.env.TASK_CONDUCTOR_TOKEN) {
    if (token !== process.env.TASK_CONDUCTOR_TOKEN) {
      const user = await requireUser();
      if (!user) return unauthorized();
    }
  } else {
    const user = await requireUser();
    if (!user) return unauthorized();
  }

  const result = await cleanupAuthData();
  return NextResponse.json({ success: true, ...result });
}
