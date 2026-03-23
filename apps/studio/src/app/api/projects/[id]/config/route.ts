import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { exec, queryOne } from '@/lib/db';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { requireUser, unauthorized } from '@/services/auth';
import { getOrgMemberRole, isRoleAllowed, ORG_ADMIN_ROLES, requireProjectAccess } from '@/services/orgs';
import { projectConfigColumnList } from '@/services/sql/projections';

export const dynamic = 'force-dynamic';

// Get project configuration
const rateLimiter = createInMemoryRateLimiter(RATE_LIMITS.general);

type ProjectConfigRow = {
  ignore_patterns: string[];
  quality_threshold: number | null;
  artifact_retention_days: number | null;
  auto_analyze: boolean;
  webhook_url: string | null;
  ai_integration_id: string | null;
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const user = await requireUser();
  if (!user) return unauthorized();

  const { id } = await params;
  await requireProjectAccess(id, user.id);
  const data = await queryOne<ProjectConfigRow>(
    `select ${projectConfigColumnList}
     from code_projects
     where id = $1`,
    [id]
  );

  if (!data) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  return NextResponse.json(data);
}

// Update project configuration
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const user = await requireUser();
  if (!user) return unauthorized();

  const { id } = await params;
  const body = await request.json();
  const { ignorePatterns, qualityThreshold, artifactRetentionDays, autoAnalyze, webhookUrl, aiIntegrationId } = body;

  const project = await requireProjectAccess(id, user.id);
  if (project.org_id) {
    const role = await getOrgMemberRole(project.org_id, user.id);
    if (!isRoleAllowed(role, ORG_ADMIN_ROLES)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }
  const updateData: Partial<ProjectConfigRow> = {};
  if (ignorePatterns !== undefined) updateData.ignore_patterns = ignorePatterns;
  if (qualityThreshold !== undefined) updateData.quality_threshold = qualityThreshold;
  if (artifactRetentionDays !== undefined) {
    if (artifactRetentionDays === null || artifactRetentionDays === '') {
      updateData.artifact_retention_days = null;
    } else if (
      typeof artifactRetentionDays === 'number' &&
      Number.isInteger(artifactRetentionDays) &&
      artifactRetentionDays >= 1 &&
      artifactRetentionDays <= 3650
    ) {
      updateData.artifact_retention_days = artifactRetentionDays;
    } else {
      return NextResponse.json(
        { error: 'artifactRetentionDays must be an integer between 1 and 3650' },
        { status: 400 }
      );
    }
  }
  if (autoAnalyze !== undefined) updateData.auto_analyze = autoAnalyze;
  if (webhookUrl !== undefined) updateData.webhook_url = webhookUrl;
  if (aiIntegrationId !== undefined) {
    if (aiIntegrationId === null || aiIntegrationId === '') {
      updateData.ai_integration_id = null;
    } else {
      if (typeof aiIntegrationId !== 'string') {
        return NextResponse.json({ error: 'Invalid AI integration' }, { status: 400 });
      }
      const integration = await queryOne<{ id: string }>(
        `select id
         from org_integrations
         where id = $1 and org_id = $2 and type = 'ai'`,
        [aiIntegrationId, project.org_id]
      );
      if (!integration) {
        return NextResponse.json({ error: 'Invalid AI integration' }, { status: 400 });
      }
      updateData.ai_integration_id = aiIntegrationId;
    }
  }

  const fields = Object.keys(updateData) as Array<keyof ProjectConfigRow>;
  if (fields.length === 0) {
    const existing = await queryOne<ProjectConfigRow>(
      `select ${projectConfigColumnList}
       from code_projects
       where id = $1`,
      [id]
    );
    return NextResponse.json(existing);
  }

  const assignments = fields.map((field, idx) => `${field} = $${idx + 2}`);
  const values = fields.map((field) => updateData[field]);

  await exec(
    `update code_projects
     set ${assignments.join(', ')}, updated_at = now()
     where id = $1`,
    [id, ...values]
  );

  const data = await queryOne<ProjectConfigRow>(
    `select ${projectConfigColumnList}
     from code_projects
     where id = $1`,
    [id]
  );

  return NextResponse.json(data);
}
