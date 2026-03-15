import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import crypto from 'crypto';
import { createAdminClient } from '@/lib/supabase/server';
import { getProjectByRepo, getRulesBySetId, createReport } from '@/services/db';
import { buildReportCommits } from '@/services/analyzeTask';
import { taskQueue } from '@/services/taskQueue';
import { logger } from '@/services/logger';
import { auditLogger, extractClientInfo } from '@/services/audit';

export const dynamic = 'force-dynamic';

function verifySignature(payload: string, signature: string, secret: string) {
  const hmac = crypto.createHmac('sha256', secret);
  const digest = `sha256=${hmac.update(payload, 'utf8').digest('hex')}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get('x-hub-signature-256') || '';
  const event = request.headers.get('x-github-event') || '';
  const secret = process.env.GITHUB_WEBHOOK_SECRET;

  if (secret && !verifySignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  if (event !== 'pull_request') {
    return NextResponse.json({ ok: true });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const action = payload.action;
  if (!['opened', 'reopened', 'synchronize'].includes(action)) {
    return NextResponse.json({ ok: true });
  }

  const repoFullName = payload?.repository?.full_name as string | undefined;
  const pr = payload?.pull_request;
  if (!repoFullName || !pr) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const project = await getProjectByRepo(repoFullName).catch(() => null);
  if (!project) {
    return NextResponse.json({ ok: true });
  }
  if (!project.org_id) {
    return NextResponse.json({ error: 'Project is not associated with an organization' }, { status: 400 });
  }

  if (!project.ruleset_id) {
    return NextResponse.json({ ok: true });
  }

  const rules = await getRulesBySetId(project.ruleset_id);
  if (!rules.length) {
    return NextResponse.json({ ok: true });
  }

  const headSha = pr?.head?.sha as string | undefined;
  const baseSha = pr?.base?.sha as string | undefined;
  if (!headSha) {
    return NextResponse.json({ error: 'Missing head sha' }, { status: 400 });
  }

  logger.setContext({ projectId: project.id });
  try {
    const commits = await buildReportCommits(project.repo, [headSha], project.id);
    const report = await createReport({
      project_id: project.id,
      org_id: project.org_id,
      ruleset_snapshot: rules,
      commits,
    });

    const db = createAdminClient();
    const { data: prRow, error: prError } = await db
      .from('pull_requests')
      .upsert(
        {
          project_id: project.id,
          provider: 'github',
          repo_full_name: repoFullName,
          number: pr.number,
          title: pr.title,
          author: pr.user?.login,
          url: pr.html_url,
          base_sha: baseSha,
          head_sha: headSha,
          status: pr.state === 'closed' ? (pr.merged ? 'merged' : 'closed') : 'open',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'provider,repo_full_name,number' }
      )
      .select()
      .single();

    if (prError || !prRow) {
      return NextResponse.json({ error: 'Failed to upsert pull request' }, { status: 500 });
    }

    await db.from('review_runs').insert({
      pull_request_id: prRow.id,
      project_id: project.id,
      report_id: report.id,
      trigger: 'webhook',
      status: 'queued',
    });

    await taskQueue.enqueue(
      'analyze',
      project.id,
      {
        reportId: report.id,
        repo: project.repo,
        hashes: [headSha],
        rules,
        previousReport: null,
      } as Record<string, unknown>,
      8,
      report.id
    );

    const clientInfo = extractClientInfo(request);
    await auditLogger.log({
      action: 'analyze',
      entityType: 'project',
      entityId: project.id,
      changes: { source: 'github_webhook', pullRequest: pr.number },
      ...clientInfo,
    });

    return NextResponse.json({ status: 'queued', reportId: report.id });
  } finally {
    logger.clearContext();
  }
}
