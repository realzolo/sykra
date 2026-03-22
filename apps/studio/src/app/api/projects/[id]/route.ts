import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { deleteProject, updateProject } from '@/services/db';
import { logger } from '@/services/logger';
import { projectIdSchema, updateProjectSchema } from '@/services/validation';
import { withRetry, formatErrorResponse } from '@/services/retry';
import { createRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { auditLogger, extractClientInfo } from '@/services/audit';
import { requireUser, unauthorized } from '@/services/auth';
import { getOrgMemberRole, isRoleAllowed, ORG_ADMIN_ROLES, requireProjectAccess } from '@/services/orgs';
import { queryOne } from '@/lib/db';
import { isConductorAuthorized } from '@/services/conductorAuth';

export const dynamic = 'force-dynamic';

const rateLimiter = createRateLimiter(RATE_LIMITS.general);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const conductorAuthorized = isConductorAuthorized(request);
  const user = conductorAuthorized ? null : await requireUser();
  if (!conductorAuthorized && !user) return unauthorized();

  try {
    const { id } = await params;
    const projectId = projectIdSchema.parse(id);

    logger.setContext({ projectId });

    if (conductorAuthorized) {
      const project = await withRetry(() =>
        queryOne<{
          id: string;
          org_id: string | null;
          repo: string | null;
          default_branch: string;
        }>(
          `select id, org_id, repo, default_branch
           from code_projects
           where id = $1`,
          [projectId]
        )
      );
      if (!project) {
        return NextResponse.json({ error: 'Project not found' }, { status: 404 });
      }
      return NextResponse.json(project);
    }

    const project = await withRetry(() => requireProjectAccess(projectId, user!.id));
    logger.info(`Project fetched: ${projectId}`);
    return NextResponse.json(project);
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    logger.error('Get project failed', err instanceof Error ? err : undefined);
    return NextResponse.json({ error }, { status: statusCode });
  } finally {
    logger.clearContext();
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const user = await requireUser();
  if (!user) return unauthorized();

  try {
    const { id } = await params;
    const projectId = projectIdSchema.parse(id);
    const body = await request.json();
    const validated = updateProjectSchema.parse(body);
    const { name, description, ruleset_id } = validated;

    logger.setContext({ projectId });

    const project = await withRetry(() => requireProjectAccess(projectId, user.id));
    if (project.org_id) {
      const role = await getOrgMemberRole(project.org_id, user.id);
      if (!isRoleAllowed(role, ORG_ADMIN_ROLES)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    if (ruleset_id !== undefined && ruleset_id !== null) {
      const ruleSet = await queryOne<{ id: string; is_global: boolean; org_id: string | null }>(
        `select id, is_global, org_id
         from quality_rule_sets
         where id = $1`,
        [ruleset_id]
      );

      if (!ruleSet) {
        return NextResponse.json({ error: 'Rule set not found' }, { status: 400 });
      }

      if (!ruleSet.is_global && ruleSet.org_id !== project.org_id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    const updatePayload: { name?: string; description?: string; ruleset_id?: string | null } = {
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(ruleset_id !== undefined ? { ruleset_id: ruleset_id || null } : {}),
    };

    const data = await withRetry(() => updateProject(projectId, updatePayload));

    // Audit log
    const clientInfo = extractClientInfo(request);
    await auditLogger.log({
      action: 'update',
      entityType: 'project',
      entityId: projectId,
      changes: { name, description, ruleset_id },
      ...clientInfo,
    });

    logger.info(`Project updated: ${projectId}`);
    return NextResponse.json(data);
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    logger.error('Update project failed', err instanceof Error ? err : undefined);
    return NextResponse.json({ error }, { status: statusCode });
  } finally {
    logger.clearContext();
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const user = await requireUser();
  if (!user) return unauthorized();

  try {
    const { id } = await params;
    const projectId = projectIdSchema.parse(id);

    logger.setContext({ projectId });

    const project = await withRetry(() => requireProjectAccess(projectId, user.id));
    if (project.org_id) {
      const role = await getOrgMemberRole(project.org_id, user.id);
      if (!isRoleAllowed(role, ORG_ADMIN_ROLES)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }
    await withRetry(() => deleteProject(projectId));

    // Audit log
    const clientInfo = extractClientInfo(request);
    await auditLogger.log({
      action: 'delete',
      entityType: 'project',
      entityId: projectId,
      ...clientInfo,
    });

    logger.info(`Project deleted: ${projectId}`);
    return NextResponse.json({ success: true });
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    logger.error('Delete project failed', err instanceof Error ? err : undefined);
    return NextResponse.json({ error }, { status: statusCode });
  } finally {
    logger.clearContext();
  }
}
