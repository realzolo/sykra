import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { createRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { requireUser, unauthorized } from '@/services/auth';
import { getOrgMemberRole, isRoleAllowed, ORG_ADMIN_ROLES, requireProjectAccess } from '@/services/orgs';

export const dynamic = 'force-dynamic';

// Get project configuration
const rateLimiter = createRateLimiter(RATE_LIMITS.general);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const user = await requireUser();
  if (!user) return unauthorized();

  const { id } = await params;
  await requireProjectAccess(id, user.id);
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('projects')
    .select('ignore_patterns, quality_threshold, auto_analyze, webhook_url')
    .eq('id', id)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

// Update project configuration
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const user = await requireUser();
  if (!user) return unauthorized();

  const { id } = await params;
  const body = await request.json();
  const { ignorePatterns, qualityThreshold, autoAnalyze, webhookUrl } = body;

  const project = await requireProjectAccess(id, user.id);
  if (project.org_id) {
    const role = await getOrgMemberRole(project.org_id, user.id);
    if (!isRoleAllowed(role, ORG_ADMIN_ROLES)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }
  const supabase = createAdminClient();

  const updateData: Record<string, unknown> = {};
  if (ignorePatterns !== undefined) updateData.ignore_patterns = ignorePatterns;
  if (qualityThreshold !== undefined) updateData.quality_threshold = qualityThreshold;
  if (autoAnalyze !== undefined) updateData.auto_analyze = autoAnalyze;
  if (webhookUrl !== undefined) updateData.webhook_url = webhookUrl;

  const { data, error } = await supabase
    .from('projects')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
