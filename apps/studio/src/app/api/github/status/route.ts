import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { requireUser, unauthorized } from '@/services/auth';
import { queryOne } from '@/lib/db';
import { createVCSClient } from '@/services/integrations';
import type { Integration } from '@/services/integrations';
import { readSecret } from '@/lib/vault';
import { getActiveOrgId, getOrgMemberRole, isRoleAllowed, ORG_ADMIN_ROLES } from '@/services/orgs';

const rateLimiter = createInMemoryRateLimiter(RATE_LIMITS.general);

const integrationProjection = `
  id,
  user_id,
  org_id,
  type,
  provider,
  name,
  is_default,
  config,
  vault_secret_name,
  created_at,
  updated_at
`;

export async function GET(request: NextRequest) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const user = await requireUser();
  if (!user) return unauthorized();

  try {
    const orgId = await getActiveOrgId(user.id, user.email ?? undefined, request);
    const role = await getOrgMemberRole(orgId, user.id);
    if (!isRoleAllowed(role, ORG_ADMIN_ROLES)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get org's default VCS integration
    const integrationRow = await queryOne<Integration & { config: Integration['config'] | string | null }>(
      `select ${integrationProjection}
       from org_integrations
       where org_id = $1 and type = 'vcs' and is_default = true
       limit 1`,
      [orgId]
    );

    if (!integrationRow) {
      return NextResponse.json({
        authenticated: false,
        message: 'No VCS integration configured. Please add a code repository integration in Settings > Integrations.',
      });
    }

    const integration: Integration = {
      ...integrationRow,
      config:
        typeof integrationRow.config === 'string'
          ? JSON.parse(integrationRow.config)
          : (integrationRow.config ?? {}),
    };

    // Decrypt the token
    const token = await readSecret(integration.vault_secret_name);

    // Create VCS client and test connection
    const client = createVCSClient(integration, token);
    const isConnected = await client.testConnection();

    return NextResponse.json({
      authenticated: isConnected,
      provider: integration.provider,
      name: integration.name,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to connect';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
