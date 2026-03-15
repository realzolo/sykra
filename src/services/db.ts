import { createAdminClient } from '@/lib/supabase/server';

const db = () => createAdminClient();

// ── Projects ──────────────────────────────────────────────
export async function getProjects(orgId: string) {
  if (!orgId) {
    throw new Error('orgId is required');
  }
  const query = db()
    .from('projects')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function getProjectById(id: string) {
  const { data, error } = await db().from('projects').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

export async function getProjectByRepo(repo: string, orgId?: string) {
  let query = db().from('projects').select('*').eq('repo', repo);
  if (orgId) {
    query = query.eq('org_id', orgId);
  }
  const { data, error } = await query.single();
  if (error) throw error;
  return data;
}

export async function createProject(payload: {
  name: string;
  repo: string;
  description?: string;
  default_branch?: string;
  ruleset_id?: string;
  user_id: string;
  org_id: string;
  vcs_integration_id: string;
  ai_integration_id: string;
}) {
  const { data, error } = await db().from('projects').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function updateProject(id: string, payload: {
  name?: string;
  description?: string;
  ruleset_id?: string | null;
}) {
  const { data, error } = await db().from('projects').update(payload).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteProject(id: string) {
  const { error } = await db().from('projects').delete().eq('id', id);
  if (error) throw error;
}

// ── Rule Sets ─────────────────────────────────────────────
export async function getRuleSets(orgId: string) {
  if (!orgId) {
    throw new Error('orgId is required');
  }
  const query = db()
    .from('rule_sets')
    .select('*, rules(*)')
    .or(`is_global.eq.true,org_id.eq.${orgId}`)
    .order('created_at', { ascending: false });
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function getRuleSetById(id: string) {
  const { data, error } = await db()
    .from('rule_sets')
    .select('*, rules(*)')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

export async function createRuleSet(payload: { name: string; description?: string; org_id: string }) {
  const { data, error } = await db().from('rule_sets').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function getRulesBySetId(rulesetId: string) {
  const { data, error } = await db()
    .from('rules')
    .select('*')
    .eq('ruleset_id', rulesetId)
    .eq('is_enabled', true)
    .order('sort_order');
  if (error) throw error;
  return data ?? [];
}

export async function upsertRule(payload: {
  id?: string;
  ruleset_id: string;
  category: string;
  name: string;
  prompt: string;
  weight?: number;
  severity?: string;
  is_enabled?: boolean;
  sort_order?: number;
}) {
  const { data, error } = await db().from('rules').upsert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function deleteRule(id: string) {
  const { error } = await db().from('rules').delete().eq('id', id);
  if (error) throw error;
}

// ── Reports ───────────────────────────────────────────────
export async function createReport(payload: {
  project_id: string;
  org_id: string;
  ruleset_snapshot: object[];
  commits: object[];
}) {
  const { data, error } = await db()
    .from('reports')
    .insert({ ...payload, status: 'pending' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateReport(id: string, payload: object) {
  const { error } = await db().from('reports').update(payload).eq('id', id);
  if (error) throw error;
}

export async function deleteReport(id: string) {
  const { error } = await db().from('reports').delete().eq('id', id);
  if (error) throw error;
}

export async function getReports(orgId: string) {
  if (!orgId) {
    throw new Error('orgId is required');
  }
  const query = db()
    .from('reports')
    .select('id, status, score, category_scores, commits, created_at, projects(name, repo)')
    .order('created_at', { ascending: false })
    .eq('org_id', orgId)
    .limit(50);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function getReportById(id: string) {
  const { data, error } = await db()
    .from('reports')
    .select('*, projects(name, repo)')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}
