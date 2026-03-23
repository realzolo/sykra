import type { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { query, queryOne, exec } from '@/lib/db';
import { logger } from '@/services/logger';
import { organizationColumnList } from '@/services/sql/projections';

export type OrgRole = 'owner' | 'admin' | 'reviewer' | 'member';
export type OrgStatus = 'active' | 'invited' | 'suspended';
export const ORG_COOKIE = 'org_id';
export const ORG_ADMIN_ROLES: OrgRole[] = ['owner', 'admin'];
const DEFAULT_PERSONAL_ORG_FALLBACK = 'User';

type ProjectAccessRecord = {
  id: string;
  org_id: string | null;
  repo: string;
  default_branch?: string | null;
  ruleset_id?: string | null;
};

type ReportAccessRecord = {
  id: string;
  org_id: string | null;
};

export interface Organization {
  id: string;
  name: string;
  slug: string;
  is_personal: boolean;
  owner_id: string | null;
  created_at: string;
}

function extractPersonalOrgHandle(email?: string | null) {
  const localPart = email?.trim().toLowerCase().split('@')[0]?.trim();
  if (!localPart) return null;

  const base = localPart.split('+')[0]?.split('.')[0]?.trim();
  if (!base) return null;

  const cleaned = base.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, '');
  return cleaned || null;
}

function personalOrgName(email?: string | null) {
  const handle = extractPersonalOrgHandle(email) ?? DEFAULT_PERSONAL_ORG_FALLBACK;
  return `${handle}'s Org`;
}

export async function ensurePersonalOrg(userId: string, email?: string | null): Promise<Organization> {
  const existing = await queryOne<Organization>(
    `select ${organizationColumnList}
     from organizations
     where owner_id = $1 and is_personal = true`,
    [userId]
  );

  if (existing) {
    return existing;
  }

  const slug = `personal-${userId}`;
  const name = personalOrgName(email);

  const created = await queryOne<Organization>(
    `insert into organizations (name, slug, is_personal, owner_id, created_at, updated_at)
     values ($1,$2,true,$3,now(),now())
     returning ${organizationColumnList}`,
    [name, slug, userId]
  );

  if (!created) {
    logger.error('Failed to create personal org');
    throw new Error('Failed to create personal org');
  }

  await exec(
    `insert into org_members (org_id, user_id, role, status, created_at, updated_at)
     values ($1,$2,'owner','active',now(),now())
     on conflict (org_id, user_id) do nothing`,
    [created.id, userId]
  );

  return created;
}

export async function getDefaultOrgId(userId: string, email?: string | null): Promise<string> {
  const org = await ensurePersonalOrg(userId, email);
  return org.id;
}

export async function getActiveOrgId(
  userId: string,
  email?: string | null,
  request?: NextRequest,
): Promise<string> {
  const cookieStore = request ? request.cookies : await cookies();
  const orgId = cookieStore.get(ORG_COOKIE)?.value;

  if (orgId) {
    const member = await isOrgMember(orgId, userId);
    if (member) return orgId;
  }

  return getDefaultOrgId(userId, email);
}

export async function getUserOrgs(userId: string): Promise<Organization[]> {
  return query<Organization>(
    `select ${organizationColumnList}
     from org_members m
     join organizations o on o.id = m.org_id
     where m.user_id = $1 and m.status = 'active'`,
    [userId]
  );
}

export async function isOrgMember(orgId: string, userId: string): Promise<boolean> {
  const row = await queryOne<{ org_id: string }>(
    `select org_id
     from org_members
     where org_id = $1 and user_id = $2 and status = 'active'`,
    [orgId, userId]
  );
  return !!row;
}

export async function getOrgMemberRole(orgId: string, userId: string): Promise<OrgRole | null> {
  const row = await queryOne<{ role: OrgRole }>(
    `select role
     from org_members
     where org_id = $1 and user_id = $2 and status = 'active'`,
    [orgId, userId]
  );
  return row?.role ?? null;
}

export function isRoleAllowed(role: OrgRole | null, allowed: OrgRole[]): boolean {
  return !!role && allowed.includes(role);
}

export async function requireOrgAccess(orgId: string, userId: string): Promise<void> {
  const member = await isOrgMember(orgId, userId);
  if (!member) {
    throw new Error('Forbidden');
  }
}

export async function requireProjectAccess(projectId: string, userId: string) {
  const project = await queryOne<ProjectAccessRecord>(
    `select id, org_id, repo, default_branch, ruleset_id
     from code_projects
     where id = $1`,
    [projectId]
  );

  if (!project) {
    throw new Error('Project not found');
  }

  if (!project.org_id) {
    throw new Error('Forbidden');
  }

  await requireOrgAccess(project.org_id, userId);

  return project as ProjectAccessRecord & { org_id: string };
}

export async function requireReportAccess(reportId: string, userId: string) {
  const report = await queryOne<ReportAccessRecord>(
    `select id, org_id
     from analysis_reports
     where id = $1`,
    [reportId]
  );

  if (!report) {
    throw new Error('Report not found');
  }

  if (!report.org_id) {
    throw new Error('Forbidden');
  }

  await requireOrgAccess(report.org_id, userId);

  return report as ReportAccessRecord & { org_id: string };
}
