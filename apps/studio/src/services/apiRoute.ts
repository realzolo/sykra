import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireUser, unauthorized } from '@/services/auth';
import { getActiveOrgId } from '@/services/orgs';
import { formatErrorResponse } from '@/services/retry';

type AuthenticatedUser = NonNullable<Awaited<ReturnType<typeof requireUser>>>;
type RouteParamsContext<TParams> = { params: Promise<TParams> };

type RouteHandlerContext<TParams> = {
  request: NextRequest;
  params: Promise<TParams>;
  user: AuthenticatedUser;
  orgId?: string;
};

type RouteRateLimiter = (request: NextRequest) => Response | null;

export function withAuthedRoute<TParams>(
  options: {
    rateLimiter?: RouteRateLimiter;
    requireOrg?: boolean;
  },
  handler: (ctx: RouteHandlerContext<TParams>) => Promise<Response>
) {
  return async (request: NextRequest, routeContext?: RouteParamsContext<TParams>): Promise<Response> => {
    const rateLimitResponse = options.rateLimiter?.(request);
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    const user = await requireUser();
    if (!user) {
      return unauthorized();
    }

    try {
      let orgId: string | undefined;
      if (options.requireOrg) {
        orgId = await getActiveOrgId(user.id, user.email ?? undefined, request);
        if (!orgId) {
          return unauthorized();
        }
      }
      return await handler({
        request,
        params: routeContext?.params ?? Promise.resolve({} as TParams),
        user,
        ...(orgId ? { orgId } : {}),
      });
    } catch (err) {
      const { error, statusCode } = formatErrorResponse(err);
      return NextResponse.json({ error }, { status: statusCode });
    }
  };
}
