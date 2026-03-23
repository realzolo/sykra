import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { requireUser, unauthorized } from '@/services/auth';
import { queryOne, exec } from '@/lib/db';
import { formatErrorResponse } from '@/services/retry';
import { getEmailDeliveryStatus } from '@/services/email';
import { notificationSettingsSchema, validateRequest } from '@/services/validation';
import { auditLogger, extractClientInfo } from '@/services/audit';

export const dynamic = 'force-dynamic';

const rateLimiter = createInMemoryRateLimiter(RATE_LIMITS.general);

type NotificationSettings = {
  email_enabled: boolean;
  notify_on_pipeline_run: boolean;
  notify_on_report_ready: boolean;
  notify_on_report_score_below: number | null;
};

async function ensureRow(userId: string): Promise<void> {
  await exec(
    `insert into notification_settings (user_id, created_at, updated_at)
     values ($1, now(), now())
     on conflict (user_id) do nothing`,
    [userId]
  );
}

export async function GET(request: NextRequest) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) return rateLimitResponse;

  const user = await requireUser();
  if (!user) return unauthorized();

  try {
    await ensureRow(user.id);
    const row = await queryOne<NotificationSettings>(
      `select email_enabled, notify_on_pipeline_run, notify_on_report_ready, notify_on_report_score_below
       from notification_settings
       where user_id = $1`,
      [user.id]
    );
    return NextResponse.json({ settings: row, delivery: getEmailDeliveryStatus() });
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    return NextResponse.json({ error }, { status: statusCode });
  }
}

export async function PUT(request: NextRequest) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) return rateLimitResponse;

  const user = await requireUser();
  if (!user) return unauthorized();

  try {
    const body = await request.json().catch(() => ({}));
    const validated = validateRequest(notificationSettingsSchema, body);

    await ensureRow(user.id);

    await exec(
      `update notification_settings
       set
         email_enabled = $2,
         notify_on_pipeline_run = $3,
         notify_on_report_ready = $4,
         notify_on_report_score_below = $5,
         updated_at = now()
       where user_id = $1`,
      [
        user.id,
        validated.email_enabled,
        validated.notify_on_pipeline_run,
        validated.notify_on_report_ready,
        validated.notify_on_report_score_below,
      ]
    );

    await auditLogger.log({
      action: 'update',
      entityType: 'user',
      entityId: user.id,
      userId: user.id,
      changes: {
        scope: 'notification_settings',
        ...validated,
      },
      ...extractClientInfo(request),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    return NextResponse.json({ error }, { status: statusCode });
  }
}
