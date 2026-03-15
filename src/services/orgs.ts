import type { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/server';
import { logger } from '@/services/logger';

export type OrgRole = 'owner' | 'admin' | 'reviewer' | 'member';
export type OrgStatus = 'active' | 'invited' | 'suspended';
export const ORG_COOKIE = 'org_id';
export const ORG_ADMIN_ROLES: OrgRole[] = ['owner', 'admin'];

export interface Organization {
  id: string;
  name: string;
  slug: string;
  is_personal: boolean;
  owner_id: string | null;
  created_at: string;
}

function personalOrgName(email?: string | null) {
  if (!email) return 'Personal Org';
  const handle = email.split('@')[0]?.trim();
  return handle ? `${handle} Org` : 'Personal Org';
}

export async function ensurePersonalOrg(userId: string, email?: string | null): Promise<Organization> {
  const db = createAdminClient();

  const { data: existing } = await db
    .from('organizations')
    .select('*')
    .eq('owner_id', userId)
    .eq('is_personal', true)
    .maybeSingle();

  if (existing) return existing as Organization;

  const slug = `personal-${userId}`;
  const name = personalOrgName(email);

  const { data: created, error } = await db
    .from('organizations')
    .insert({
      name,
      slug,
      is_personal: true,
      owner_id: userId,
    })
    .select()
    .single();

  if (error || !created) {
    logger.error('Failed to create personal org', error ?? undefined);
    throw new Error('Failed to create personal org');
  }

  await db.from('org_members').insert({
    org_id: created.id,
    user_id: userId,
    role: 'owner',
    status: 'active',
  });

  return created as Organization;
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
  const db = createAdminClient();
  const { data, error } = await db
    .from('org_members')
    .select('organizations(*)')
    .eq('user_id', userId)
    .eq('status', 'active');

  if (error) {
    throw error;
  }

  const orgs = (data || [])
    .map((row) => (row as Record<string, any>).organizations)
    .filter(Boolean) as Organization[];

  return orgs;
}

export async function isOrgMember(orgId: string, userId: string): Promise<boolean> {
  const db = createAdminClient();
  const { data, error } = await db
    .from('org_members')
    .select('org_id')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();

  if (error) return false;
  return !!data;
}

export async function getOrgMemberRole(orgId: string, userId: string): Promise<OrgRole | null> {
  const db = createAdminClient();
  const { data, error } = await db
    .from('org_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();

  if (error || !data) return null;
  return (data as { role: OrgRole }).role ?? null;
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
  const db = createAdminClient();
  const { data, error } = await db
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single();

  if (error || !data) {
    throw new Error('Project not found');
  }

  if (!data.org_id) {
    throw new Error('Forbidden');
  }

  await requireOrgAccess(data.org_id, userId);

  return data as Record<string, any> & { org_id: string };
}

export async function requireReportAccess(reportId: string, userId: string) {
  const db = createAdminClient();
  const { data, error } = await db
    .from('reports')
    .select('*')
    .eq('id', reportId)
    .single();

  if (error || !data) {
    throw new Error('Report not found');
  }

  if (!data.org_id) {
    throw new Error('Forbidden');
  }

  await requireOrgAccess(data.org_id, userId);

  return data as Record<string, any> & { org_id: string };
}
