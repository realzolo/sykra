import type { NextRequest } from 'next/server';

function bearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function schedulerTokenFromRequest(request: NextRequest): string | null {
  const header = request.headers.get('x-scheduler-token')?.trim();
  if (header) return header;
  const bearer = bearerToken(request.headers.get('authorization'));
  if (bearer) return bearer;
  return null;
}

/**
 * Determines whether a request is authorized as the internal Scheduler service.
 *
 * - If `SCHEDULER_TOKEN` is set, the request must present that token via `X-Scheduler-Token`
 *   or `Authorization: Bearer ...`.
 * - If `SCHEDULER_TOKEN` is not set:
 *   - Allow in non-production to keep local development simple.
 *   - Deny in production.
 */
export function isSchedulerAuthorized(request: NextRequest): boolean {
  const provided = schedulerTokenFromRequest(request);
  if (!provided) return false;

  const expected = process.env.SCHEDULER_TOKEN?.trim() ?? '';
  if (!expected) {
    return process.env.NODE_ENV !== 'production';
  }

  return provided === expected;
}
