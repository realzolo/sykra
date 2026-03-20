import { query, queryOne } from '@/lib/db';

export type CodeReviewProfileVersion = {
  profile_id: string;
  profile_version_id: string;
  profile_name: string;
  config: Record<string, unknown>;
};

export async function getDefaultCodeReviewProfileVersion(orgId: string): Promise<CodeReviewProfileVersion> {
  const row = await queryOne<CodeReviewProfileVersion>(
    `select
        p.id as profile_id,
        v.id as profile_version_id,
        p.name as profile_name,
        v.config
     from code_review_profiles p
     join code_review_profile_versions v on v.profile_id = p.id and v.status = 'active'
     where (p.org_id = $1 or p.is_global = true)
       and p.is_default = true
     order by case when p.org_id = $1 then 0 else 1 end, v.version desc
     limit 1`,
    [orgId]
  );
  if (!row) {
    throw new Error('No active code review profile is configured');
  }
  return row;
}

export async function createCodeReviewRun(payload: {
  projectId: string;
  orgId: string;
  profileId: string;
  profileVersionId: string;
  scopeMode: 'diff' | 'full';
  baseRef?: string | null;
  headRef?: string | null;
  commits: string[];
  createdBy: string;
}) {
  const row = await queryOne(
    `insert into code_review_runs
      (project_id, org_id, profile_id, profile_version_id, scope_mode, base_ref, head_ref, commits, status, gate_status, created_by, created_at, updated_at)
     values
      ($1,$2,$3,$4,$5,$6,$7,$8,'pending','pending',$9,now(),now())
     returning *`,
    [
      payload.projectId,
      payload.orgId,
      payload.profileId,
      payload.profileVersionId,
      payload.scopeMode,
      payload.baseRef ?? null,
      payload.headRef ?? null,
      JSON.stringify(payload.commits),
      payload.createdBy,
    ]
  );
  if (!row) {
    throw new Error('Failed to create code review run');
  }
  return row;
}

export async function listCodeReviewRuns(orgId: string, projectId?: string, limit = 50) {
  if (projectId) {
    return query(
      `select r.*, p.name as project_name, p.repo
       from code_review_runs r
       join code_projects p on p.id = r.project_id
       where r.org_id = $1 and r.project_id = $2
       order by r.created_at desc
       limit $3`,
      [orgId, projectId, limit]
    );
  }
  return query(
    `select r.*, p.name as project_name, p.repo
     from code_review_runs r
     join code_projects p on p.id = r.project_id
     where r.org_id = $1
     order by r.created_at desc
     limit $2`,
    [orgId, limit]
  );
}

export async function getCodeReviewRunById(runId: string) {
  const row = await queryOne(
    `select r.*, p.name as project_name, p.repo
     from code_review_runs r
     join code_projects p on p.id = r.project_id
     where r.id = $1`,
    [runId]
  );
  if (!row) {
    throw new Error('Code review run not found');
  }
  return row;
}

export async function getCodeReviewRunDetails(runId: string) {
  const [run, stages, toolRuns, findings] = await Promise.all([
    getCodeReviewRunById(runId),
    query(
      `select *
       from code_review_stages
       where run_id = $1
       order by started_at asc`,
      [runId]
    ),
    query(
      `select *
       from code_review_tool_runs
       where run_id = $1
       order by started_at asc`,
      [runId]
    ),
    query(
      `select *
       from code_review_findings
       where run_id = $1
       order by
         case severity
           when 'critical' then 1
           when 'high' then 2
           when 'medium' then 3
           when 'low' then 4
           else 5
         end,
         created_at asc`,
      [runId]
    ),
  ]);

  return { ...run, stages, toolRuns, findings };
}
