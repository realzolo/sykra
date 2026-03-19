import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { codebaseService } from '@/services/CodebaseService';
import { logger } from '@/services/logger';
import { projectIdSchema } from '@/services/validation';
import { withRetry, formatErrorResponse } from '@/services/retry';
import { createRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { requireUser, unauthorized } from '@/services/auth';
import { requireProjectAccess } from '@/services/orgs';

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

  const user = await requireUser();
  if (!user) return unauthorized();

  try {
    const { id } = await params;
    const projectId = projectIdSchema.parse(id);

    logger.setContext({ projectId });

    const project = await withRetry(() => requireProjectAccess(projectId, user.id));
    const requestedRefRaw = request.nextUrl.searchParams.get('ref');
    const requestedRef = requestedRefRaw?.trim() ? requestedRefRaw.trim() : undefined;
    const path = request.nextUrl.searchParams.get('path') || '';
    const syncPolicy = resolveSyncPolicy(request.nextUrl.searchParams.get('sync'));

    let result: Awaited<ReturnType<typeof codebaseService.listTree>>;
    try {
      result = await withRetry(() =>
        codebaseService.listTree(
          {
            orgId: project.org_id,
            projectId,
            repo: project.repo,
            ref: requestedRef,
          },
          path,
          { syncPolicy }
        )
      );
    } catch (err) {
      if (shouldFallbackToResolvedHead(err, requestedRef, project.default_branch)) {
        result = await withRetry(() =>
          codebaseService.listTree(
            {
              orgId: project.org_id,
              projectId,
              repo: project.repo,
            },
            path,
            { syncPolicy: 'force' }
          )
        );
      } else {
        throw err;
      }
    }

    return NextResponse.json(result);
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    logger.error('Get codebase tree failed', err instanceof Error ? err : undefined);
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

function shouldFallbackToResolvedHead(
  error: unknown,
  requestedRef: string | undefined,
  projectDefaultBranch: string | null | undefined
) {
  if (!requestedRef) return false;
  if (!projectDefaultBranch) return false;
  if (!isInvalidRefError(error)) return false;
  return requestedRef === projectDefaultBranch.trim();
}

function isInvalidRefError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return error.message.toLowerCase().includes('invalid ref');
}
