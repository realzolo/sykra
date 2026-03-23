import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getRepoBranches } from '@/services/github';
import { codebaseService } from '@/services/CodebaseService';
import { logger } from '@/services/logger';
import { projectIdSchema } from '@/services/validation';
import { withRetry, formatErrorResponse } from '@/services/retry';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { requireUser, unauthorized } from '@/services/auth';
import { requireProjectAccess } from '@/services/orgs';

export const dynamic = 'force-dynamic';

const rateLimiter = createInMemoryRateLimiter(RATE_LIMITS.general);

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

  try {
    const { id } = await params;
    const projectId = projectIdSchema.parse(id);

    logger.setContext({ projectId });

    const project = await withRetry(() => requireProjectAccess(projectId, user.id));
    const defaultBranch = project.default_branch?.trim() ?? '';
    const syncPolicy = resolveSyncPolicy(request.nextUrl.searchParams.get('sync'));
    const branches = await withRetry(async () => {
      const attempts: Array<() => Promise<string[]>> = [
        () => codebaseService.listBranches(
          {
            orgId: project.org_id,
            projectId,
            repo: project.repo,
          },
          { syncPolicy }
        ),
      ];

      if (syncPolicy !== 'force') {
        attempts.push(() =>
          codebaseService.listBranches(
            {
              orgId: project.org_id,
              projectId,
              repo: project.repo,
            },
            { syncPolicy: 'force' }
          )
        );
      }

      attempts.push(() => getRepoBranches(project.repo, projectId));

      let lastError: unknown = null;
      for (const attempt of attempts) {
        try {
          const result = await attempt();
          if (Array.isArray(result) && result.length) {
            return prioritizeDefaultBranch(result, defaultBranch);
          }
        } catch (err) {
          lastError = err;
        }
      }

      throw (lastError instanceof Error ? lastError : new Error('No branches available'));
    });

    logger.info(`Branches fetched: ${projectId}`);
    return NextResponse.json(branches);
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    logger.error('Get branches failed', err instanceof Error ? err : undefined);
    return NextResponse.json({ error }, { status: statusCode });
  } finally {
    logger.clearContext();
  }
}

function resolveSyncPolicy(value: string | null): 'auto' | 'force' | 'never' {
  if (!value) return 'auto';
  const normalized = value.trim().toLowerCase();
  if (['0', 'false', 'no', 'off', 'never'].includes(normalized)) return 'never';
  if (['1', 'true', 'yes', 'force'].includes(normalized)) return 'force';
  return 'auto';
}

function prioritizeDefaultBranch(branches: string[], defaultBranch: string) {
  const unique = Array.from(new Set(branches));
  if (!defaultBranch) return unique;
  if (!unique.includes(defaultBranch)) return unique;
  return [defaultBranch, ...unique.filter((branch) => branch !== defaultBranch)];
}
