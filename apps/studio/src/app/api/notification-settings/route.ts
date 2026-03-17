import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { requireUser, unauthorized } from '@/services/auth';
import { queryOne, exec } from '@/lib/db';
import { formatErrorResponse } from '@/services/retry';

export const dynamic = 'force-dynamic';

const rateLimiter = createRateLimiter(RATE_LIMITS.general);

type NotificationSettings = {
  email_enabled: boolean;
  slack_webhook: string | null;
  notify_on_complete: boolean;
  notify_on_critical: boolean;
  notify_on_threshold: number | null;
  daily_digest: boolean;
  weekly_digest: boolean;
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
      `select email_enabled, slack_webhook, notify_on_complete, notify_on_critical, notify_on_threshold, daily_digest, weekly_digest
       from notification_settings
       where user_id = $1`,
      [user.id]
    );
    return NextResponse.json({ settings: row });
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

    const emailEnabled = body?.email_enabled;
    const notifyOnComplete = body?.notify_on_complete;
    const notifyOnCritical = body?.notify_on_critical;
    const dailyDigest = body?.daily_digest;
    const weeklyDigest = body?.weekly_digest;
    const hasSlackWebhook = typeof body === 'object' && body != null && 'slack_webhook' in body;
    const slackWebhook = body?.slack_webhook;
    const hasThreshold = typeof body === 'object' && body != null && 'notify_on_threshold' in body;
    const notifyOnThreshold = body?.notify_on_threshold;

    await ensureRow(user.id);

    const thresholdValue =
      notifyOnThreshold === null || notifyOnThreshold === undefined
        ? null
        : typeof notifyOnThreshold === 'number'
          ? Math.min(100, Math.max(0, Math.round(notifyOnThreshold)))
          : null;

    await exec(
      `update notification_settings
       set
         email_enabled = coalesce($2, email_enabled),
         slack_webhook = case when $3 then $4 else slack_webhook end,
         notify_on_complete = coalesce($5, notify_on_complete),
         notify_on_critical = coalesce($6, notify_on_critical),
         notify_on_threshold = case when $7 then $8 else notify_on_threshold end,
         daily_digest = coalesce($9, daily_digest),
         weekly_digest = coalesce($10, weekly_digest),
         updated_at = now()
       where user_id = $1`,
      [
        user.id,
        typeof emailEnabled === 'boolean' ? emailEnabled : null,
        hasSlackWebhook,
        typeof slackWebhook === 'string' ? slackWebhook : null,
        typeof notifyOnComplete === 'boolean' ? notifyOnComplete : null,
        typeof notifyOnCritical === 'boolean' ? notifyOnCritical : null,
        hasThreshold,
        thresholdValue,
        typeof dailyDigest === 'boolean' ? dailyDigest : null,
        typeof weeklyDigest === 'boolean' ? weeklyDigest : null,
      ]
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    return NextResponse.json({ error }, { status: statusCode });
  }
}
