import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { formatErrorResponse } from '@/services/retry';
import { isSchedulerAuthorized } from '@/services/schedulerAuth';
import { queryOne, query } from '@/lib/db';
import { sendEmail, absoluteStudioUrl } from '@/services/email';
import { writeBackReviewRun } from '@/services/reviewWriteback';
import { logger } from '@/services/logger';

export const dynamic = 'force-dynamic';

const rateLimiter = createRateLimiter(RATE_LIMITS.general);

type SchedulerEvent =
  | { type: 'pipeline.run.completed' | 'pipeline.run.failed'; runId: string }
  | { type: 'report.done'; reportId: string };

type PipelineNotificationsConfig = {
  channels?: string[];
  onSuccess?: boolean;
  onFailure?: boolean;
};

function ok() {
  return NextResponse.json({ ok: true });
}

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

async function notifyPipelineRun(runId: string) {
  const run = await queryOne<{
    id: string;
    pipeline_id: string;
    org_id: string;
    status: string;
  }>(
    `select id, pipeline_id, org_id, status
     from pipeline_runs
     where id = $1`,
    [runId]
  );
  if (!run) return;

  const pipeline = await queryOne<{
    id: string;
    name: string;
    current_version_id: string | null;
  }>(
    `select id, name, current_version_id
     from pipelines
     where id = $1`,
    [run.pipeline_id]
  );
  if (!pipeline) return;

  const version = await queryOne<{ config: { notifications?: PipelineNotificationsConfig } | null }>(
    `select config
     from pipeline_versions
     where id = (select version_id from pipeline_runs where id = $1)`,
    [runId]
  );

  const notifyCfg = version?.config?.notifications ?? null;
  const channels: string[] = Array.isArray(notifyCfg?.channels) ? notifyCfg.channels : [];
  const wantsEmail = channels.includes('email');
  const wantsSuccess = notifyCfg?.onSuccess !== false;
  const wantsFailure = notifyCfg?.onFailure !== false;

  const isSuccess = run.status === 'success';
  const isFailure = run.status === 'failed' || run.status === 'timed_out' || run.status === 'canceled';

  if (isSuccess && !wantsSuccess) return;
  if (isFailure && !wantsFailure) return;
  if (!wantsEmail) return;

  const recipients = await query<{ email: string }>(
    `select u.email
     from org_members m
     join auth_users u on u.id = m.user_id
     left join notification_settings ns on ns.user_id = u.id
     where m.org_id = $1
       and m.status = 'active'
       and u.status = 'active'
       and u.email is not null
       and u.email_verified_at is not null
       and coalesce(ns.email_enabled, true) = true
       and coalesce(ns.notify_on_complete, true) = true`,
    [run.org_id]
  );
  if (recipients.length === 0) return;

  const link = absoluteStudioUrl(`/o/${run.org_id}/pipelines/${pipeline.id}?tab=runs&runId=${run.id}`);
  const subjectStatus = isSuccess ? 'succeeded' : 'failed';
  const subject = `[Spec-Axis] Pipeline "${pipeline.name}" ${subjectStatus}`;
  const text = [
    `Pipeline: ${pipeline.name}`,
    `Status: ${run.status}`,
    link ? `View: ${link}` : '',
    '',
    'You can update notification preferences in Settings > Notifications.',
  ]
    .filter(Boolean)
    .join('\n');

  // Send individually to avoid exposing org emails to each other.
  await Promise.all(
    recipients.map((r) =>
      sendEmail({
        to: r.email,
        subject,
        text,
      }).catch(() => undefined)
    )
  );
}

async function notifyReportDone(reportId: string) {
  const report = await queryOne<{
    id: string;
    org_id: string;
    project_id: string;
    user_id: string | null;
    score: number | null;
    status: string;
  }>(
    `select id, org_id, project_id, user_id, score, status
     from analysis_reports
     where id = $1`,
    [reportId]
  );
  if (!report) return;
  if (report.status !== 'done' && report.status !== 'partial_failed') return;
  if (!report.user_id) return;

  const user = await queryOne<{
    email: string | null;
    email_verified_at: string | null;
    status: string;
    email_enabled: boolean | null;
    notify_on_complete: boolean | null;
    notify_on_threshold: number | null;
  }>(
    `select u.email, u.email_verified_at, u.status,
            ns.email_enabled, ns.notify_on_complete, ns.notify_on_threshold
     from auth_users u
     left join notification_settings ns on ns.user_id = u.id
     where u.id = $1`,
    [report.user_id]
  );
  if (!user?.email || user.status !== 'active' || !user.email_verified_at) return;
  if (user.email_enabled === false) return;
  if (user.notify_on_complete === false) return;
  if (user.notify_on_threshold != null && report.score != null && report.score >= user.notify_on_threshold) {
    return;
  }

  const project = await queryOne<{ name: string }>(
    `select name from code_projects where id = $1`,
    [report.project_id]
  );
  const link = absoluteStudioUrl(`/o/${report.org_id}/reports/${report.id}`);
  const statusLabel = report.status === 'partial_failed' ? 'partial' : 'done';
  const subject = `[Spec-Axis] Report ${statusLabel}${project?.name ? `: ${project.name}` : ''}`;
  const text = [
    `Report: ${report.id}`,
    project?.name ? `Project: ${project.name}` : '',
    report.score != null ? `Score: ${report.score}/100` : '',
    link ? `View: ${link}` : '',
    '',
    'You can update notification preferences in Settings > Notifications.',
  ]
    .filter(Boolean)
    .join('\n');

  await sendEmail({ to: user.email, subject, text }).catch(() => undefined);
  await writeBackReviewRun(reportId).catch((error) => {
    logger.warn('PR review write-back failed', error instanceof Error ? error : undefined);
  });
}

export async function POST(request: NextRequest) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) return rateLimitResponse;

  if (!isSchedulerAuthorized(request)) return unauthorized();

  try {
    const body = (await request.json().catch(() => null)) as SchedulerEvent | null;
    if (!body || typeof body.type !== 'string') {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    if (body.type === 'pipeline.run.completed' || body.type === 'pipeline.run.failed') {
      if (!('runId' in body) || !body.runId) {
        return NextResponse.json({ error: 'runId is required' }, { status: 400 });
      }
      await notifyPipelineRun(body.runId);
      return ok();
    }

    if (body.type === 'report.done') {
      if (!('reportId' in body) || !body.reportId) {
        return NextResponse.json({ error: 'reportId is required' }, { status: 400 });
      }
      await notifyReportDone(body.reportId);
      return ok();
    }

    return NextResponse.json({ error: 'Unsupported event type' }, { status: 400 });
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    return NextResponse.json({ error }, { status: statusCode });
  }
}
