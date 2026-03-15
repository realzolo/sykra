/**
 * Integration factory and resolver
 */

import { createAdminClient } from '@/lib/supabase/server';
import { readSecret } from '@/lib/vault';
import type {
  Integration,
  VCSClient,
  AIClient,
  VCSConfigWithSecret,
  AIConfig,
  AIConfigWithSecret,
  VCSProvider,
  AIProvider,
} from './types';
import { GitHubClient, GitLabClient, GenericGitClient } from './vcs-clients';
import { OpenAICompatibleClient } from './ai-clients';

/**
 * Create a VCS client from an integration
 */
export function createVCSClient(integration: Integration, token: string): VCSClient {
  const config: VCSConfigWithSecret = {
    ...integration.config,
    token,
  };

  switch (integration.provider as VCSProvider) {
    case 'github':
      return new GitHubClient(config);
    case 'gitlab':
      return new GitLabClient(config);
    case 'git':
      return new GenericGitClient(config);
    default:
      throw new Error(`Unsupported VCS provider: ${integration.provider}`);
  }
}

/**
 * Create an AI client from an integration
 */
export function createAIClient(integration: Integration, apiKey: string): AIClient {
  const config: AIConfigWithSecret = {
    ...(integration.config as AIConfig),
    apiKey,
  };

  switch (integration.provider as AIProvider) {
    case 'openai-compatible':
      return new OpenAICompatibleClient(config);
    default:
      throw new Error(`Unsupported AI provider: ${integration.provider}`);
  }
}

/**
 * Resolve VCS integration for a project
 * Priority: Project-specific > Org default
 */
export async function resolveVCSIntegration(projectId: string): Promise<{
  integration: Integration | null;
  client: VCSClient;
}> {
  const supabase = createAdminClient();

  // Get project
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('vcs_integration_id, org_id')
    .eq('id', projectId)
    .single();

  if (projectError || !project) {
    throw new Error('Project not found');
  }

  // 1. Try project-specific integration
  if (project.vcs_integration_id) {
    const { data: integration, error } = await supabase
      .from('user_integrations')
      .select('*')
      .eq('id', project.vcs_integration_id)
      .single();

    if (!error && integration) {
      if (project.org_id && integration.org_id !== project.org_id) {
        throw new Error('Integration does not belong to this organization');
      }
      const token = await readSecret(integration.vault_secret_name);
      const client = createVCSClient(integration as Integration, token);
      return { integration: integration as Integration, client };
    }
  }

  // 2. Try org default integration
  if (project.org_id) {
    const { data: defaultIntegration, error: defaultError } = await supabase
      .from('user_integrations')
      .select('*')
      .eq('org_id', project.org_id)
      .eq('type', 'vcs')
      .eq('is_default', true)
      .single();

    if (!defaultError && defaultIntegration) {
      const token = await readSecret(defaultIntegration.vault_secret_name);
      const client = createVCSClient(defaultIntegration as Integration, token);
      return { integration: defaultIntegration as Integration, client };
    }
  }

  // 3. No integration found - user must configure one
  throw new Error(
    'No VCS integration configured. Please add a code repository integration in Settings > Integrations.'
  );
}

/**
 * Resolve AI integration for a project
 * Priority: Project-specific > Org default
 */
export async function resolveAIIntegration(projectId: string): Promise<{
  integration: Integration | null;
  client: AIClient;
}> {
  const supabase = createAdminClient();

  // Get project
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('ai_integration_id, org_id')
    .eq('id', projectId)
    .single();

  if (projectError || !project) {
    throw new Error('Project not found');
  }

  // 1. Try project-specific integration
  if (project.ai_integration_id) {
    const { data: integration, error } = await supabase
      .from('user_integrations')
      .select('*')
      .eq('id', project.ai_integration_id)
      .single();

    if (!error && integration) {
      if (project.org_id && integration.org_id !== project.org_id) {
        throw new Error('Integration does not belong to this organization');
      }
      const apiKey = await readSecret(integration.vault_secret_name);
      const client = createAIClient(integration as Integration, apiKey);
      return { integration: integration as Integration, client };
    }
  }

  // 2. Try org default integration
  if (project.org_id) {
    const { data: defaultIntegration, error: defaultError } = await supabase
      .from('user_integrations')
      .select('*')
      .eq('org_id', project.org_id)
      .eq('type', 'ai')
      .eq('is_default', true)
      .single();

    if (!defaultError && defaultIntegration) {
      const apiKey = await readSecret(defaultIntegration.vault_secret_name);
      const client = createAIClient(defaultIntegration as Integration, apiKey);
      return { integration: defaultIntegration as Integration, client };
    }
  }

  // 3. No integration found - user must configure one
  throw new Error(
    'No AI integration configured. Please add an AI model integration in Settings > Integrations.'
  );
}

/**
 * Get all integrations for an organization
 */
export async function getOrgIntegrations(
  orgId: string,
  type?: 'vcs' | 'ai'
): Promise<Integration[]> {
  const supabase = createAdminClient();

  let query = supabase.from('user_integrations').select('*').eq('org_id', orgId);

  if (type) {
    query = query.eq('type', type);
  }

  const { data, error } = await query.order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to get user integrations: ${error.message}`);
  }

  return (data || []) as Integration[];
}

/**
 * Get a specific integration by ID
 */
export async function getIntegration(integrationId: string, orgId?: string): Promise<Integration> {
  const supabase = createAdminClient();

  let query = supabase
    .from('user_integrations')
    .select('*')
    .eq('id', integrationId);

  if (orgId) {
    query = query.eq('org_id', orgId);
  }

  const { data, error } = await query.single();

  if (error) {
    console.error('Failed to get integration:', error);
    throw new Error(`Integration not found: ${error.message}`);
  }

  if (!data) {
    throw new Error('Integration not found');
  }

  return data as Integration;
}
