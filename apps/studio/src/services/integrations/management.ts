/**
 * Integration management service
 */

import { query, queryOne, exec, withTransaction } from '@/lib/db';
import { storeSecret, updateSecret, deleteSecret } from '@/lib/vault';
import type { Integration, IntegrationType, Provider } from './types';

export interface CreateIntegrationInput {
  userId: string;
  orgId: string;
  type: IntegrationType;
  provider: Provider;
  name: string;
  config: Record<string, any>;
  secret: string; // token or apiKey
  isDefault?: boolean;
}

export interface UpdateIntegrationInput {
  name?: string;
  config?: Record<string, any>;
  secret?: string;
  isDefault?: boolean;
}

/**
 * Create a new integration.
 * If isDefault is true, clears the existing default of the same type atomically.
 */
export async function createIntegration(input: CreateIntegrationInput): Promise<Integration> {
  const encryptedSecret = await storeSecret('', input.secret);

  return withTransaction(async (client) => {
    if (input.isDefault) {
      await client.query(
        `update org_integrations set is_default = false where org_id = $1 and type = $2`,
        [input.orgId, input.type]
      );
    }

    const result = await client.query(
      `insert into org_integrations
        (user_id, org_id, type, provider, name, config, vault_secret_name, is_default, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,now(),now())
       returning *`,
      [
        input.userId,
        input.orgId,
        input.type,
        input.provider,
        input.name,
        JSON.stringify(input.config ?? {}),
        encryptedSecret,
        input.isDefault ?? false,
      ]
    );

    if (!result.rows[0]) {
      throw new Error('Failed to create integration');
    }

    const config =
      typeof result.rows[0].config === 'string'
        ? JSON.parse(result.rows[0].config)
        : result.rows[0].config;

    return { ...result.rows[0], config } as Integration;
  });
}

/**
 * Update an integration.
 * If isDefault is being set to true, clears the existing default of the same type atomically.
 */
export async function updateIntegration(
  integrationId: string,
  orgId: string,
  input: UpdateIntegrationInput
): Promise<Integration> {
  return withTransaction(async (client) => {
    const existingResult = await client.query(
      `select * from org_integrations where id = $1 and org_id = $2`,
      [integrationId, orgId]
    );

    if (existingResult.rowCount === 0) {
      throw new Error('Integration not found');
    }

    const existing = existingResult.rows[0] as Integration;

    // If promoting to default, clear old default first
    if (input.isDefault === true && !existing.is_default) {
      await client.query(
        `update org_integrations set is_default = false where org_id = $1 and type = $2`,
        [orgId, existing.type]
      );
    }

    const updateData: Record<string, any> = {};
    if (input.name !== undefined) updateData.name = input.name;
    if (input.config !== undefined) updateData.config = JSON.stringify(input.config);
    if (input.isDefault !== undefined) updateData.is_default = input.isDefault;

    if (input.secret) {
      updateData.vault_secret_name = await updateSecret(existing.vault_secret_name, input.secret);
    }

    const fields = Object.keys(updateData);
    if (fields.length === 0) {
      const config =
        typeof existing.config === 'string' ? JSON.parse(existing.config) : existing.config;
      return { ...existing, config } as Integration;
    }

    const assignments = fields.map((key, idx) => `${key} = $${idx + 3}`);
    const values = fields.map((key) => updateData[key]);

    const updated = await client.query(
      `update org_integrations
       set ${assignments.join(', ')}, updated_at = now()
       where id = $1 and org_id = $2
       returning *`,
      [integrationId, orgId, ...values]
    );

    if (!updated.rows[0]) {
      throw new Error('Failed to update integration');
    }

    const config =
      typeof updated.rows[0].config === 'string'
        ? JSON.parse(updated.rows[0].config)
        : updated.rows[0].config;

    return { ...updated.rows[0], config } as Integration;
  });
}

/**
 * Delete an integration
 */
export async function deleteIntegration(integrationId: string, orgId: string): Promise<void> {
  const integration = await queryOne<Integration>(
    `select * from org_integrations where id = $1 and org_id = $2`,
    [integrationId, orgId]
  );

  if (!integration) {
    throw new Error('Integration not found');
  }

  const projects = await query(
    `select id from code_projects
     where vcs_integration_id = $1 or ai_integration_id = $1
     limit 1`,
    [integrationId]
  );

  if (projects.length > 0) {
    throw new Error('Cannot delete integration: it is being used by one or more projects');
  }

  const pipelines = await query(
    `select id from pipelines
     where ai_integration_id = $1 or vcs_integration_id = $1
     limit 1`,
    [integrationId]
  );

  if (pipelines.length > 0) {
    throw new Error('Cannot delete integration: it is being used by one or more pipelines');
  }

  await exec(
    `delete from org_integrations where id = $1 and org_id = $2`,
    [integrationId, orgId]
  );

  try {
    await deleteSecret(integration.vault_secret_name);
  } catch (error) {
    console.error('Failed to delete secret from vault:', error);
  }
}

/**
 * Set an integration as default (clears previous default of same type atomically)
 */
export async function setDefaultIntegration(
  integrationId: string,
  orgId: string
): Promise<void> {
  await withTransaction(async (client) => {
    const row = await client.query(
      `select id, type from org_integrations where id = $1 and org_id = $2`,
      [integrationId, orgId]
    );

    if (row.rowCount === 0) {
      throw new Error('Integration not found');
    }

    const { type } = row.rows[0];

    // Clear existing default for this org + type
    await client.query(
      `update org_integrations set is_default = false where org_id = $1 and type = $2`,
      [orgId, type]
    );

    // Set new default
    await client.query(
      `update org_integrations set is_default = true where id = $1`,
      [integrationId]
    );
  });
}
