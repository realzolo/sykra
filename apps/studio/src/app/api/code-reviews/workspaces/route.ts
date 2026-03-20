import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { queryOne } from '@/lib/db';
import { codebaseService } from '@/services/CodebaseService';
import { logger } from '@/services/logger';
import { isSchedulerAuthorized } from '@/services/schedulerAuth';
import { formatErrorResponse } from '@/services/retry';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!isSchedulerAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json() as { projectId?: string; ref?: string };
    const projectId = body.projectId?.trim() ?? '';
    if (!projectId) {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
    }

    const project = await queryOne<{
      id: string;
      org_id: string;
      repo: string;
    }>(
      `select id, org_id, repo
       from code_projects
       where id = $1`,
      [projectId]
    );
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const workspace = await codebaseService.prepareWorkspace(
      {
        orgId: project.org_id,
        projectId: project.id,
        repo: project.repo,
        ...(body.ref?.trim() ? { ref: body.ref.trim() } : {}),
      },
      { forceSync: true }
    );
    return NextResponse.json(workspace);
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    logger.error('Prepare code review workspace failed', err instanceof Error ? err : undefined);
    return NextResponse.json({ error }, { status: statusCode });
  }
}

export async function DELETE(request: NextRequest) {
  if (!isSchedulerAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const workspacePath = request.nextUrl.searchParams.get('workspacePath')?.trim() ?? '';
    if (!workspacePath) {
      return NextResponse.json({ error: 'workspacePath is required' }, { status: 400 });
    }
    await codebaseService.cleanupWorkspace({ workspacePath });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    logger.error('Cleanup code review workspace failed', err instanceof Error ? err : undefined);
    return NextResponse.json({ error }, { status: statusCode });
  }
}
