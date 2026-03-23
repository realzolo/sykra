import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { exec, query, queryOne } from '@/lib/db';
import type { JsonObject } from '@/lib/json';
import { logger } from '@/services/logger';
import { withRetry, formatErrorResponse } from '@/services/retry';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { requireUser, unauthorized } from '@/services/auth';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const rateLimiter = createInMemoryRateLimiter(RATE_LIMITS.general);

const savedFilterColumns = [
  'id',
  'user_id',
  'name',
  'filter_config',
  'is_default',
  'created_at',
].join(', ');

const filterSchema = z.object({
  name: z.string().min(1).max(100),
  filterConfig: z.record(z.string(), z.unknown()),
  isDefault: z.boolean().optional(),
});

type SavedFilterRow = {
  id: string;
  user_id: string;
  name: string;
  filter_config: JsonObject;
  is_default: boolean;
  created_at: string;
};

// Get saved filters
export async function GET(request: NextRequest) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  try {
    const { searchParams } = new URL(request.url);
    const requestedUserId = searchParams.get('userId');

    const user = await requireUser();
    if (!user) return unauthorized();

    if (requestedUserId && requestedUserId !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const userId = user.id;
    logger.setContext({ userId });

    const data = await withRetry(async () => {
      return query<SavedFilterRow>(
        `select ${savedFilterColumns}
         from analysis_saved_filters
         where user_id = $1
         order by created_at desc`,
        [userId]
      );
    });

    logger.info(`Filters fetched: ${data.length} filters`);
    return NextResponse.json(data);
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    logger.error('Get filters failed', err instanceof Error ? err : undefined);
    return NextResponse.json({ error }, { status: statusCode });
  } finally {
    logger.clearContext();
  }
}

// Create saved filter
export async function POST(request: NextRequest) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  try {
    const user = await requireUser();
    if (!user) return unauthorized();

    const body = await request.json();
    const validated = filterSchema.parse(body);
    const { name, filterConfig, isDefault } = validated;
    const userId = user.id;

    logger.setContext({ userId });

    const data = await withRetry(async () => {
      // If set as default, unset others
      if (isDefault) {
        await exec(
          `update analysis_saved_filters set is_default = false where user_id = $1`,
          [userId]
        );
      }

      const created = await queryOne<SavedFilterRow>(
        `insert into analysis_saved_filters
          (user_id, name, filter_config, is_default, created_at)
         values ($1,$2,$3,$4,now())
         returning ${savedFilterColumns}`,
        [userId, name, JSON.stringify(filterConfig), isDefault ?? false]
      );

      if (!created) {
        throw new Error('Failed to create filter');
      }

      return created;
    });

    logger.info(`Filter created: ${data.id}`);
    return NextResponse.json(data);
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    logger.error('Create filter failed', err instanceof Error ? err : undefined);
    return NextResponse.json({ error }, { status: statusCode });
  } finally {
    logger.clearContext();
  }
}

// Delete saved filter
export async function DELETE(request: NextRequest) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  try {
    const user = await requireUser();
    if (!user) return unauthorized();

    const { searchParams } = new URL(request.url);
    const filterId = searchParams.get('filterId');

    if (!filterId) {
      return NextResponse.json({ error: 'filterId is required' }, { status: 400 });
    }

    logger.setContext({ filterId });

    await withRetry(async () => {
      await exec(
        `delete from analysis_saved_filters where id = $1 and user_id = $2`,
        [filterId, user.id]
      );
    });

    logger.info(`Filter deleted: ${filterId}`);
    return NextResponse.json({ success: true });
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    logger.error('Delete filter failed', err instanceof Error ? err : undefined);
    return NextResponse.json({ error }, { status: statusCode });
  } finally {
    logger.clearContext();
  }
}
