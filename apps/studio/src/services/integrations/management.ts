/**
 * Integration management service
 */

import { exec, execTx, queryOne, withTransaction } from '@/lib/db';
import type { JsonObject } from '@/lib/json';
import { storeSecret, updateSecret, deleteSecret } from '@/lib/vault';
import { logger } from '@/services/logger';
import { orgIntegrationColumnList } from '@/services/sql/projections';
import type { Integration, IntegrationType, Provider, IntegrationConfig } from './types';

type IntegrationRow = Omit<Integration, 'config'> & { config: string | IntegrationConfig | null };
type IntegrationTypeRow = { id: string; type: IntegrationType };

export interface CreateIntegrationInput {
  userId: string;
  orgId: string;
  type: IntegrationType;
  provider: Provider;
  name: string;
  config: IntegrationConfig;
  secret: string; // token or apiKey
  isDefault?: boolean;
}

export interface UpdateIntegrationInput {
  name?: string;
  config?: IntegrationConfig;
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
      await execTx(client,
        `update org_integrations set is_default = false where org_id = $1 and type = $2`,
        [input.orgId, input.type]
      );
    }

    const result = await client.query<IntegrationRow>(
      `insert into org_integrations
        (user_id, org_id, type, provider, name, config, vault_secret_name, is_default, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,now(),now())
       returning ${orgIntegrationColumnList}`,
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

    const created = result.rows[0];
    if (!created) {
      throw new Error('Failed to create integration');
    }
    const config = typeof created.config === 'string' ? (JSON.parse(created.config) as IntegrationConfig) : (created.config ?? {});
    return { ...created, config };
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
    const existingResult = await client.query<IntegrationRow>(
      `select ${orgIntegrationColumnList}
       from org_integrations
       where id = $1 and org_id = $2`,
      [integrationId, orgId]
    );

    const existing = existingResult.rows[0];
    if (!existing) {
      throw new Error('Integration not found');
    }

    // If promoting to default, clear the current default first
    if (input.isDefault === true && !existing.is_default) {
      await execTx(client,
        `update org_integrations set is_default = false where org_id = $1 and type = $2`,
        [orgId, existing.type]
      );
    }

    const updateData: JsonObject = {};
    if (input.name !== undefined) updateData.name = input.name;
    if (input.config !== undefined) updateData.config = JSON.stringify(input.config);
    if (input.isDefault !== undefined) updateData.is_default = input.isDefault;

    if (input.secret) {
      updateData.vault_secret_name = await updateSecret(existing.vault_secret_name, input.secret);
    }

    const fields = Object.keys(updateData);
    if (fields.length === 0) {
      const config = typeof existing.config === 'string' ? (JSON.parse(existing.config) as IntegrationConfig) : (existing.config ?? {});
      return { ...existing, config };
    }

    const assignments = fields.map((key, idx) => `${key} = $${idx + 3}`);
    const values = fields.map((key) => updateData[key]);

    const updated = await client.query<IntegrationRow>(
      `update org_integrations
       set ${assignments.join(', ')}, updated_at = now()
       where id = $1 and org_id = $2
       returning ${orgIntegrationColumnList}`,
      [integrationId, orgId, ...values]
    );

    const row = updated.rows[0];
    if (!row) {
      throw new Error('Failed to update integration');
    }
    const config = typeof row.config === 'string' ? (JSON.parse(row.config) as IntegrationConfig) : (row.config ?? {});
    return { ...row, config };
  });
}

/**
 * Delete an integration
 */
export async function deleteIntegration(integrationId: string, orgId: string): Promise<void> {
  const integration = await queryOne<IntegrationRow>(
    `select ${orgIntegrationColumnList}
     from org_integrations
     where id = $1 and org_id = $2`,
    [integrationId, orgId]
  );

  if (!integration) {
    throw new Error('Integration not found');
  }

  await exec(
    `delete from org_integrations where id = $1 and org_id = $2`,
    [integrationId, orgId]
  );

  try {
    await deleteSecret(integration.vault_secret_name);
  } catch (error) {
    logger.error('Failed to delete secret from vault', error instanceof Error ? error : undefined);
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
    const row = await client.query<IntegrationTypeRow>(
      `select id, type from org_integrations where id = $1 and org_id = $2`,
      [integrationId, orgId]
    );

    if (row.rowCount === 0) {
      throw new Error('Integration not found');
    }

    const integration = row.rows[0];
    if (!integration) {
      throw new Error('Integration not found');
    }
    const { type } = integration;

    // Clear existing default for this org + type
    await execTx(client,
      `update org_integrations set is_default = false where org_id = $1 and type = $2`,
      [orgId, type]
    );

    // Set new default
    await execTx(client,
      `update org_integrations set is_default = true where id = $1`,
      [integrationId]
    );
  });
}
