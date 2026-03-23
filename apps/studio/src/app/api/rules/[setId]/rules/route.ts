import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { upsertRule, deleteRule, getRuleSetById } from '@/services/db';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { requireUser, unauthorized } from '@/services/auth';
import { z } from 'zod';
import { getActiveOrgId, getOrgMemberRole, isRoleAllowed, ORG_ADMIN_ROLES } from '@/services/orgs';
import { queryOne } from '@/lib/db';

const rateLimiter = createInMemoryRateLimiter(RATE_LIMITS.general);

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
  const payload = {
    ruleset_id: setId,
    category: validated.category,
    name: validated.name,
    prompt: validated.prompt,
    ...(validated.id !== undefined ? { id: validated.id } : {}),
    ...(validated.weight !== undefined ? { weight: validated.weight } : {}),
    ...(validated.severity !== undefined ? { severity: validated.severity } : {}),
    ...(validated.is_enabled !== undefined ? { is_enabled: validated.is_enabled } : {}),
    ...(validated.sort_order !== undefined ? { sort_order: validated.sort_order } : {}),
  };
  const data = await upsertRule(payload);
  return NextResponse.json(data);
}

export async function DELETE(request: NextRequest) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) return rateLimitResponse;

  const user = await requireUser();
  if (!user) return unauthorized();

  const { id } = await request.json();

  const rule = await queryOne<{ ruleset_id: string }>(
    `select ruleset_id from quality_rules where id = $1`,
    [id]
  );

  if (!rule) {
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
