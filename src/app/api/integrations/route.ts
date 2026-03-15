/**
 * GET /api/integrations - Get user's integrations
 * POST /api/integrations - Create a new integration
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  getOrgIntegrations,
  createIntegration,
  type CreateIntegrationInput,
} from '@/services/integrations';
import { getActiveOrgId, getOrgMemberRole, isRoleAllowed, ORG_ADMIN_ROLES } from '@/services/orgs';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') as 'vcs' | 'ai' | null;

    const orgId = await getActiveOrgId(user.id, user.email ?? undefined, request);
    const role = await getOrgMemberRole(orgId, user.id);
    if (!role) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const integrations = await getOrgIntegrations(orgId, type || undefined);

    // Remove sensitive data before sending to client
    const sanitized = integrations.map((int) => ({
      id: int.id,
      type: int.type,
      provider: int.provider,
      name: int.name,
      is_default: int.is_default,
      config: int.config,
      created_at: int.created_at,
      updated_at: int.updated_at,
      // Don't send vault_secret_name or user_id
    }));

    return NextResponse.json(sanitized);
  } catch (error) {
    console.error('Failed to get integrations:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get integrations' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { type, provider, name, config, secret, isDefault } = body;

    // Validation
    if (!type || !provider || !name || !secret) {
      return NextResponse.json(
        { error: 'Missing required fields: type, provider, name, secret' },
        { status: 400 }
      );
    }

    if (!['vcs', 'ai'].includes(type)) {
      return NextResponse.json({ error: 'Invalid type. Must be vcs or ai' }, { status: 400 });
    }

    const orgId = await getActiveOrgId(user.id, user.email ?? undefined, request);
    const role = await getOrgMemberRole(orgId, user.id);
    if (!isRoleAllowed(role, ORG_ADMIN_ROLES)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const input: CreateIntegrationInput = {
      userId: user.id,
      orgId,
      type,
      provider,
      name,
      config: config || {},
      secret,
      isDefault: isDefault || false,
    };

    const integration = await createIntegration(input);

    // Remove sensitive data
    const sanitized = {
      id: integration.id,
      type: integration.type,
      provider: integration.provider,
      name: integration.name,
      is_default: integration.is_default,
      config: integration.config,
      created_at: integration.created_at,
      updated_at: integration.updated_at,
    };

    return NextResponse.json(sanitized, { status: 201 });
  } catch (error) {
    console.error('Failed to create integration:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create integration' },
      { status: 500 }
    );
  }
}
