import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { query, queryOne } from '@/lib/db';
import { codebaseService } from '@/services/CodebaseService';
import { projectIdSchema } from '@/services/validation';
import { formatErrorResponse } from '@/services/retry';
import { requireUser, unauthorized } from '@/services/auth';
import { logger } from '@/services/logger';
import { getOrgMemberRole, isRoleAllowed, ORG_ADMIN_ROLES, requireProjectAccess } from '@/services/orgs';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const orgIdSchema = z.string().uuid('Invalid org ID');

export async function POST(request: NextRequest) {
  const token = request.headers.get('x-task-token');
  const isTaskConductor = Boolean(process.env.TASK_CONDUCTOR_TOKEN && token === process.env.TASK_CONDUCTOR_TOKEN);
  const user = isTaskConductor ? null : await requireUser();
  if (!isTaskConductor && !user) return unauthorized();

  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Number(searchParams.get('limit') ?? '10'), 50);
    const force = parseBoolean(searchParams.get('force'));
    const projectIdParam = searchParams.get('project_id');
    const orgIdParam = searchParams.get('org_id');

    let projects: Array<{ id: string; org_id: string | null; repo: string | null }> = [];

    if (projectIdParam) {
      const projectId = projectIdSchema.parse(projectIdParam);
      if (isTaskConductor) {
        const data = await queryOne<{ id: string; org_id: string | null; repo: string | null }>(
          `select id, org_id, repo
           from code_projects
           where id = $1`,
          [projectId]
        );
        if (!data) {
          return NextResponse.json({ error: 'Project not found' }, { status: 404 });
        }
        projects = [data];
      } else if (user) {
        const project = await requireProjectAccess(projectId, user.id);
        projects = [{ id: project.id, org_id: project.org_id, repo: project.repo }];
      }
    } else {
      if (!orgIdParam) {
        return NextResponse.json({ error: 'project_id or org_id is required' }, { status: 400 });
      }

      const orgId = orgIdSchema.parse(orgIdParam);

      if (!isTaskConductor && user) {
        const role = await getOrgMemberRole(orgId, user.id);
        if (!isRoleAllowed(role, ORG_ADMIN_ROLES)) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
      }

      const params: unknown[] = [orgId, limit];
      const sql = `select id, org_id, repo
                   from code_projects
                   where org_id = $1
                   order by created_at desc
                   limit $2`;

      projects = await query<{ id: string; org_id: string | null; repo: string | null }>(sql, params);
    }

    let synced = 0;
    let failed = 0;
    const failures: Array<{ projectId: string; error: string }> = [];

    for (const project of projects) {
      if (!project.org_id || !project.repo) {
        failed += 1;
        failures.push({ projectId: project.id, error: 'missing_org_or_repo' });
        continue;
      }

      try {
        await codebaseService.ensureMirror(
          {
            orgId: project.org_id,
            projectId: project.id,
            repo: project.repo,
          },
          { forceSync: force }
        );
        synced += 1;
      } catch (err) {
        failed += 1;
        failures.push({
          projectId: project.id,
          error: err instanceof Error ? err.message : 'sync_failed',
        });
        logger.warn('Codebase sync failed', err instanceof Error ? err : undefined);
      }
    }

    return NextResponse.json({
      processed: projects.length,
      synced,
      failed,
      failures,
    });
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    return NextResponse.json({ error }, { status: statusCode });
  }
}

function parseBoolean(value: string | null) {
  if (!value) return false;
  return value === '1' || value.toLowerCase() === 'true' || value.toLowerCase() === 'yes';
}
