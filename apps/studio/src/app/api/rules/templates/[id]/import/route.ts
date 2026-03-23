import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireUser, unauthorized } from '@/services/auth';
import { getActiveOrgId, getOrgMemberRole, isRoleAllowed, ORG_ADMIN_ROLES } from '@/services/orgs';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { createRuleSet, upsertRule } from '@/services/db';
import { RULE_TEMPLATES } from '@/lib/ruleTemplates';

export const dynamic = 'force-dynamic';

const rateLimiter = createInMemoryRateLimiter(RATE_LIMITS.general);

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) return rateLimitResponse;

  const user = await requireUser();
  if (!user) return unauthorized();

  const { id } = await params;
  const template = RULE_TEMPLATES.find(t => t.id === id);
  if (!template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }

  const orgId = await getActiveOrgId(user.id, user.email ?? undefined, request);
  const role = await getOrgMemberRole(orgId, user.id);
  if (!isRoleAllowed(role, ORG_ADMIN_ROLES)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const ruleSet = await createRuleSet({
      name: template.name,
      description: template.description,
      org_id: orgId,
    }) as { id: string };

    for (const [i, rule] of template.rules.entries()) {
      await upsertRule({
        ruleset_id: ruleSet.id,
        name: rule.name,
        prompt: rule.prompt,
        severity: rule.severity,
        category: rule.category,
        weight: rule.weight,
        is_enabled: true,
        sort_order: i,
      });
    }

    return NextResponse.json({ id: ruleSet.id, name: template.name, rulesImported: template.rules.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Import failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
