import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { upsertRule, deleteRule, getRuleSetById } from '@/services/db';
import { createRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { requireUser, unauthorized } from '@/services/auth';
import { z } from 'zod';
import { getActiveOrgId, getOrgMemberRole, isRoleAllowed, ORG_ADMIN_ROLES } from '@/services/orgs';
import { createAdminClient } from '@/lib/supabase/server';

const rateLimiter = createRateLimiter(RATE_LIMITS.general);

const ruleSchema = z.object({
  id: z.string().uuid().optional(),
  category: z.enum(['style', 'security', 'architecture', 'performance', 'maintainability']),
  name: z.string().min(1).max(100),
  prompt: z.string().min(1).max(5000),
  weight: z.number().min(0).max(100).optional(),
  severity: z.enum(['error', 'warning', 'info']).optional(),
  is_enabled: z.boolean().optional(),
  sort_order: z.number().int().optional(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ setId: string }> }) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) return rateLimitResponse;

  const user = await requireUser();
  if (!user) return unauthorized();

  const { setId } = await params;
  const ruleSet = await getRuleSetById(setId);
  if (!ruleSet) {
    return NextResponse.json({ error: 'Rule set not found' }, { status: 404 });
  }
  if (ruleSet.is_global) {
    return NextResponse.json({ error: 'Global rule sets are read-only' }, { status: 403 });
  }
  if (!ruleSet.is_global) {
    const orgId = await getActiveOrgId(user.id, user.email ?? undefined, request);
    if (!ruleSet.org_id || ruleSet.org_id !== orgId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const role = await getOrgMemberRole(orgId, user.id);
    if (!isRoleAllowed(role, ORG_ADMIN_ROLES)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }
  const body = await request.json();
  const validated = ruleSchema.parse(body);
  const data = await upsertRule({ ...validated, ruleset_id: setId });
  return NextResponse.json(data);
}

export async function DELETE(request: NextRequest) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) return rateLimitResponse;

  const user = await requireUser();
  if (!user) return unauthorized();

  const { id } = await request.json();

  const db = createAdminClient();
  const { data: rule, error } = await db
    .from('rules')
    .select('ruleset_id')
    .eq('id', id)
    .single();

  if (error || !rule) {
    return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
  }

  const ruleSet = await getRuleSetById(rule.ruleset_id);
  if (!ruleSet) {
    return NextResponse.json({ error: 'Rule set not found' }, { status: 404 });
  }

  if (ruleSet.is_global) {
    return NextResponse.json({ error: 'Global rule sets are read-only' }, { status: 403 });
  }
  if (!ruleSet.is_global) {
    const orgId = await getActiveOrgId(user.id, user.email ?? undefined, request);
    if (!ruleSet.org_id || ruleSet.org_id !== orgId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const role = await getOrgMemberRole(orgId, user.id);
    if (!isRoleAllowed(role, ORG_ADMIN_ROLES)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  await deleteRule(id);
  return NextResponse.json({ success: true });
}
