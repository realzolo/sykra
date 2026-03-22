import type { NextRequest } from 'next/server';

function bearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function conductorTokenFromRequest(request: NextRequest): string | null {
  const header = request.headers.get('x-conductor-token')?.trim();
  if (header) return header;
  const bearer = bearerToken(request.headers.get('authorization'));
  if (bearer) return bearer;
  return null;
}

/**
 * Determines whether a request is authorized as the internal Conductor service.
 *
 * - If `CONDUCTOR_TOKEN` is set, the request must present that token via `X-Conductor-Token`
 *   or `Authorization: Bearer ...`.
 * - If `CONDUCTOR_TOKEN` is not set:
 *   - Allow in non-production to keep local development simple.
 *   - Deny in production.
 */
export function isConductorAuthorized(request: NextRequest): boolean {
  const provided = conductorTokenFromRequest(request);
  if (!provided) return false;

  const expected = process.env.CONDUCTOR_TOKEN?.trim() ?? '';
  if (!expected) {
    return process.env.NODE_ENV !== 'production';
  }

  return provided === expected;
}
