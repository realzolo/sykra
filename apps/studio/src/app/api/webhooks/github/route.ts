import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import crypto from 'crypto';
import { exec, queryOne } from '@/lib/db';
import { getProjectById, listProjectsByRepo, getRulesBySetId, createReport, updateReport } from '@/services/db';
import { buildReportCommits } from '@/services/analyzeTask';
import { enqueueAnalyze, listPipelines, createPipelineRun, getPipeline } from '@/services/schedulerClient';
import { logger } from '@/services/logger';
import { auditLogger, extractClientInfo } from '@/services/audit';
import { codebaseService } from '@/services/CodebaseService';

export const dynamic = 'force-dynamic';

type WebhookProject = {
  id: string;
  org_id: string | null;
  repo: string;
  ruleset_id: string | null;
};

type PullRequestPayload = {
  number?: number;
  title?: string;
  html_url?: string;
  state?: string;
  merged?: boolean;
  user?: { login?: string };
  head?: { sha?: string };
  base?: { sha?: string };
};

type GitHubWebhookPayload = {
  action?: string;
  ref?: string;
  repository?: { full_name?: string };
  pull_request?: PullRequestPayload;
};

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

  let payload: GitHubWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as GitHubWebhookPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (event === 'push') {
    const repoFullName = payload.repository?.full_name;
    if (!repoFullName) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('project_id');
    let projects: WebhookProject[] = [];

    if (projectId) {
      const project = (await getProjectById(projectId).catch(() => null)) as WebhookProject | null;
      if (!project) {
        return NextResponse.json({ error: 'Project not found' }, { status: 404 });
      }
      if (project.repo !== repoFullName) {
        return NextResponse.json({ error: 'Project repository mismatch' }, { status: 400 });
      }
      projects = [project];
    } else {
      projects = (await listProjectsByRepo(repoFullName).catch(() => [])) as WebhookProject[];
    }

    if (projects.length === 0) {
      return NextResponse.json({ ok: true });
    }

    let synced = 0;
    let failed = 0;
    let pipelinesTriggered = 0;
    const pushedBranch = payload.ref?.replace('refs/heads/', '') ?? '';
    const orgIds = new Set<string>();

    for (const project of projects) {
      if (!project.org_id || !project.repo) {
        failed += 1;
        continue;
      }
      try {
        await codebaseService.ensureMirror(
          {
            orgId: project.org_id,
            projectId: project.id,
            repo: project.repo,
          },
          { forceSync: true }
        );
        synced += 1;
        orgIds.add(project.org_id);
      } catch (err) {
        failed += 1;
        logger.warn('Codebase sync from webhook failed', err instanceof Error ? err : undefined);
      }
    }

    // Auto-trigger pipelines with matching branch
    if (pushedBranch) {
      for (const orgId of orgIds) {
        try {
          const allPipelines = await listPipelines(orgId);
          if (!Array.isArray(allPipelines)) continue;
          for (const p of allPipelines) {
            const detail = await getPipeline(p.id).catch(() => null);
            const trigger = detail?.version?.config && typeof detail.version.config === 'object'
              ? ((detail.version.config as { trigger?: { autoTrigger?: boolean; branch?: string } }).trigger ?? null)
              : null;
            if (!trigger?.autoTrigger) continue;
            const branch = typeof trigger.branch === 'string' && trigger.branch.trim() !== '' ? trigger.branch : 'main';
            if (branch !== pushedBranch) continue;
            try {
              await createPipelineRun(p.id, {
                triggerType: 'webhook',
                metadata: { ref: payload.ref, pushedBranch, repo: repoFullName },
              });
              pipelinesTriggered += 1;
            } catch (err) {
              logger.warn('Auto-trigger pipeline failed', err instanceof Error ? err : undefined);
            }
          }
        } catch {
          // best-effort
        }
      }
    }

    return NextResponse.json({ ok: true, synced, failed, pipelinesTriggered });
  }

  if (event !== 'pull_request') {
    return NextResponse.json({ ok: true });
  }

  const action = payload.action;
  if (typeof action !== 'string' || !['opened', 'reopened', 'synchronize'].includes(action)) {
    return NextResponse.json({ ok: true });
  }

  const repoFullName = payload.repository?.full_name;
  const pr = payload.pull_request;
  if (!repoFullName || !pr) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('project_id');
  let project: WebhookProject | null = null;

  if (projectId) {
    project = (await getProjectById(projectId).catch(() => null)) as WebhookProject | null;
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    if (project.repo !== repoFullName) {
      return NextResponse.json({ error: 'Project repository mismatch' }, { status: 400 });
    }
  } else {
    const projects = (await listProjectsByRepo(repoFullName).catch(() => [])) as WebhookProject[];
    if (projects.length === 0) {
      return NextResponse.json({ ok: true });
    }
    if (projects.length > 1) {
      return NextResponse.json(
        { error: 'Multiple projects match this repository. Configure webhook with ?project_id=...' },
        { status: 409 }
      );
    }
    project = projects[0] ?? null;
  }
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
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

    const prStatus = pr.state === 'closed' ? (pr.merged ? 'merged' : 'closed') : 'open';
    const prRow = await queryOne<{ id: string }>(
      `insert into pull_requests
        (project_id, provider, repo_full_name, number, title, author, url, base_sha, head_sha, status, created_at, updated_at)
       values ($1,'github',$2,$3,$4,$5,$6,$7,$8,$9,now(),now())
       on conflict (provider, repo_full_name, number)
       do update set
         project_id = excluded.project_id,
         title = excluded.title,
         author = excluded.author,
         url = excluded.url,
         base_sha = excluded.base_sha,
         head_sha = excluded.head_sha,
         status = excluded.status,
         updated_at = now()
       returning *`,
      [
        project.id,
        repoFullName,
        pr.number,
        pr.title,
        pr.user?.login,
        pr.html_url,
        baseSha,
        headSha,
        prStatus,
      ]
    );

    if (!prRow) {
      return NextResponse.json({ error: 'Failed to upsert pull request' }, { status: 500 });
    }

    await exec(
      `insert into review_runs
        (pull_request_id, project_id, report_id, trigger, status, created_at)
       values ($1,$2,$3,'webhook','queued',now())`,
      [prRow.id, project.id, report.id]
    );

    try {
      await enqueueAnalyze({
        projectId: project.id,
        reportId: report.id,
        repo: project.repo,
        hashes: [headSha],
        rules,
        previousReport: null,
        useIncremental: false,
      });
    } catch (err) {
      await updateReport(report.id, {
        status: 'failed',
        error_message: err instanceof Error ? err.message : 'Scheduler enqueue failed',
      });
      throw err;
    }

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
