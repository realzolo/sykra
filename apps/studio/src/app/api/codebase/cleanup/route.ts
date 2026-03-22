import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { codebaseService } from '@/services/CodebaseService';
import { requireUser, unauthorized } from '@/services/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const token = request.headers.get('x-task-token');
  const isTaskConductor = Boolean(process.env.TASK_CONDUCTOR_TOKEN && token === process.env.TASK_CONDUCTOR_TOKEN);
  const user = isTaskConductor ? null : await requireUser();
  if (!isTaskConductor && !user) return unauthorized();

  const { searchParams } = new URL(request.url);
  const maxAgeHours = parsePositiveNumber(searchParams.get('max_age_hours'));
  const maxAgeMs = parsePositiveNumber(searchParams.get('max_age_ms'));

  if (searchParams.has('max_age_hours') && maxAgeHours === null) {
    return NextResponse.json({ error: 'Invalid max_age_hours' }, { status: 400 });
  }
  if (searchParams.has('max_age_ms') && maxAgeMs === null) {
    return NextResponse.json({ error: 'Invalid max_age_ms' }, { status: 400 });
  }

  const maxAge = maxAgeHours != null
    ? maxAgeHours * 60 * 60 * 1000
    : maxAgeMs != null
      ? maxAgeMs
      : undefined;

  const removed = await codebaseService.cleanupStaleWorkspaces(maxAge);
  return NextResponse.json({ success: true, removed });
}

function parsePositiveNumber(value: string | null) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}
