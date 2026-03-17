import type { NextRequest } from 'next/server';

function bearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function runnerTokenFromRequest(request: NextRequest): string | null {
  const header = request.headers.get('x-runner-token')?.trim();
  if (header) return header;
  const bearer = bearerToken(request.headers.get('authorization'));
  if (bearer) return bearer;
  return null;
}

/**
 * Determines whether a request is authorized as the internal Runner service.
 *
 * - If `RUNNER_TOKEN` is set, the request must present that token via `X-Runner-Token`
 *   or `Authorization: Bearer ...`.
 * - If `RUNNER_TOKEN` is not set:
 *   - Allow in non-production to keep local development simple.
 *   - Deny in production.
 */
export function isRunnerAuthorized(request: NextRequest): boolean {
  const provided = runnerTokenFromRequest(request);
  if (!provided) return false;

  const expected = process.env.RUNNER_TOKEN?.trim() ?? '';
  if (!expected) {
    return process.env.NODE_ENV !== 'production';
  }

  return provided === expected;
}
