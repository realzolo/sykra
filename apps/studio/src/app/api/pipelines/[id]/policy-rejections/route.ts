import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireUser, unauthorized } from '@/services/auth';
import { getActiveOrgId } from '@/services/orgs';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { formatErrorResponse } from '@/services/retry';
import { query, queryOne } from '@/lib/db';
import { asJsonObject, type JsonObject } from '@/lib/json';

export const dynamic = 'force-dynamic';

const rateLimiter = createInMemoryRateLimiter(RATE_LIMITS.general);

type PipelineRow = {
  id: string;
  org_id: string;
};

type PolicyRejectionRow = {
  id: string;
  user_id: string | null;
  changes: JsonObject | null;
  created_at: string;
};

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) return rateLimitResponse;

  const user = await requireUser();
  if (!user) return unauthorized();

  try {
    const { id } = await params;
    const orgId = await getActiveOrgId(user.id, user.email ?? undefined, request);
    const pipeline = await queryOne<PipelineRow>(
      `select id, org_id
         from pipelines
        where id = $1`,
      [id]
    );
    if (!pipeline) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (pipeline.org_id !== orgId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const limitRaw = request.nextUrl.searchParams.get('limit');
    const parsedLimit = limitRaw ? Number.parseInt(limitRaw, 10) : 20;
    const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(50, parsedLimit)) : 20;

    const rows = await query<PolicyRejectionRow>(
      `select id, user_id, changes, created_at
         from audit_logs
        where entity_type = 'pipeline'
          and entity_id = $1
          and action = 'reject'
          and changes->>'scope' = 'pipeline_policy_reject'
        order by created_at desc
        limit $2`,
      [id, limit]
    );

    const actorIds = Array.from(
      new Set(
        rows
          .map((item) => item.user_id)
          .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      )
    );
    const actorRows =
      actorIds.length > 0
        ? await query<{ id: string; email: string | null; display_name: string | null }>(
            `select id, email, display_name
               from auth_users
              where id = any($1::uuid[])`,
            [actorIds]
          )
        : [];
    const actorById = new Map(actorRows.map((item) => [item.id, item]));

    const items = rows.map((row) => {
      const payload = asJsonObject(row.changes) ?? {};
      const actor = row.user_id ? actorById.get(row.user_id) : undefined;
      return {
        id: row.id,
        reason_code: typeof payload.reason_code === 'string' ? payload.reason_code : 'unknown',
        operation: typeof payload.operation === 'string' ? payload.operation : 'unknown',
        message: typeof payload.message === 'string' ? payload.message : '',
        path: typeof payload.path === 'string' ? payload.path : null,
        created_at: row.created_at,
        rejected_by: row.user_id,
        rejected_by_name: actor?.display_name ?? null,
        rejected_by_email: actor?.email ?? null,
      };
    });

    return NextResponse.json({ items });
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    return NextResponse.json({ error }, { status: statusCode });
  }
}

