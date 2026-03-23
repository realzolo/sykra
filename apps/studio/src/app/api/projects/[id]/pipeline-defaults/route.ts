import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireUser, unauthorized } from '@/services/auth';
import { projectIdSchema } from '@/services/validation';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { formatErrorResponse, withRetry } from '@/services/retry';
import { requireProjectAccess } from '@/services/orgs';
import { logger } from '@/services/logger';
import { inferProjectPipelineDefaults } from '@/services/pipelineInference';

export const dynamic = 'force-dynamic';

const rateLimiter = createInMemoryRateLimiter(RATE_LIMITS.general);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) return rateLimitResponse;

  const user = await requireUser();
  if (!user) return unauthorized();

  try {
    const { id } = await params;
    const projectId = projectIdSchema.parse(id);

    logger.setContext({ projectId });

    const project = await withRetry(() => requireProjectAccess(projectId, user.id));
    const defaultBranch = project.default_branch?.trim();
    const suggestion = await withRetry(() =>
      inferProjectPipelineDefaults({
        orgId: project.org_id,
        projectId,
        repo: project.repo,
        ...(defaultBranch ? { defaultBranch } : {}),
      })
    );

    return NextResponse.json({
      defaults: suggestion,
    });
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    logger.error('Infer pipeline defaults failed', err instanceof Error ? err : undefined);
    return NextResponse.json({ error }, { status: statusCode });
  } finally {
    logger.clearContext();
  }
}
