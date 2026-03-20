import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireUser, unauthorized } from '@/services/auth';
import { exec, queryOne } from '@/lib/db';
import { encrypt } from '@/lib/encryption';
import { getActiveOrgId, getOrgMemberRole, isRoleAllowed, ORG_ADMIN_ROLES } from '@/services/orgs';

export const dynamic = 'force-dynamic';

const providerSchema = z.enum(['local', 's3']);

const optionalTrimmedString = (max: number) =>
  z.preprocess(
    (value) => {
      if (typeof value !== 'string') return value;
      const trimmed = value.trim();
      return trimmed === '' ? undefined : trimmed;
    },
    z.string().min(1).max(max).optional()
  );

const localConfigSchema = z.object({
  localBasePath: optionalTrimmedString(512),
});

const s3ConfigSchema = z.object({
  s3Endpoint: z.preprocess(
    (value) => {
      if (typeof value !== 'string') return value;
      const trimmed = value.trim();
      return trimmed === '' ? undefined : trimmed;
    },
    z.string().url().optional()
  ),
  s3Region: z.string().trim().min(1).max(128),
  s3Bucket: z.string().trim().min(1).max(128),
  s3Prefix: optionalTrimmedString(256),
  s3AccessKeyId: z.string().trim().min(1).max(256),
  s3SecretAccessKey: optionalTrimmedString(512),
  s3ForcePathStyle: z.boolean().optional(),
});

const upsertSchema = z.object({
  provider: providerSchema,
  config: z.unknown(),
});

type StorageRow = {
  provider: 'local' | 's3';
  config: Record<string, unknown>;
};

function sanitizeResponse(row: StorageRow | null) {
  if (!row) {
    return {
      provider: 'local' as const,
      config: {
        localBasePath: 'artifacts',
      },
    };
  }
  if (row.provider === 'local') {
    const parsed = localConfigSchema.safeParse(row.config ?? {});
    return {
      provider: 'local' as const,
      config: {
        localBasePath: parsed.success ? parsed.data.localBasePath ?? 'artifacts' : 'artifacts',
      },
    };
  }

  const cfg = row.config ?? {};
  return {
    provider: 's3' as const,
    config: {
      s3Endpoint: typeof cfg.s3Endpoint === 'string' ? cfg.s3Endpoint : '',
      s3Region: typeof cfg.s3Region === 'string' ? cfg.s3Region : '',
      s3Bucket: typeof cfg.s3Bucket === 'string' ? cfg.s3Bucket : '',
      s3Prefix: typeof cfg.s3Prefix === 'string' ? cfg.s3Prefix : '',
      s3AccessKeyId: typeof cfg.s3AccessKeyId === 'string' ? cfg.s3AccessKeyId : '',
      s3ForcePathStyle: Boolean(cfg.s3ForcePathStyle),
      hasSecret: typeof cfg.s3SecretAccessKeyEncrypted === 'string' && cfg.s3SecretAccessKeyEncrypted.length > 0,
    },
  };
}

export async function GET(request: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const orgId = await getActiveOrgId(user.id, user.email ?? undefined, request);
  const role = await getOrgMemberRole(orgId, user.id);
  if (!role) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const row = await queryOne<StorageRow>(
    `select provider, config
     from org_storage_settings
     where org_id = $1`,
    [orgId]
  );

  return NextResponse.json(sanitizeResponse(row));
}

export async function PUT(request: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const orgId = await getActiveOrgId(user.id, user.email ?? undefined, request);
  const role = await getOrgMemberRole(orgId, user.id);
  if (!isRoleAllowed(role, ORG_ADMIN_ROLES)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const parsedBody = upsertSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsedBody.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const existing = await queryOne<StorageRow>(
    `select provider, config
     from org_storage_settings
     where org_id = $1`,
    [orgId]
  );

  const provider = parsedBody.data.provider;
  let nextConfig: Record<string, unknown>;
  if (provider === 'local') {
    const parsedLocal = localConfigSchema.safeParse(parsedBody.data.config ?? {});
    if (!parsedLocal.success) {
      return NextResponse.json({ error: 'Invalid local storage config' }, { status: 400 });
    }
    nextConfig = {
      localBasePath: parsedLocal.data.localBasePath ?? 'artifacts',
    };
  } else {
    const parsedS3 = s3ConfigSchema.safeParse(parsedBody.data.config ?? {});
    if (!parsedS3.success) {
      return NextResponse.json({ error: 'Invalid S3 storage config' }, { status: 400 });
    }

    const existingEncrypted =
      existing?.provider === 's3' && existing.config
        ? (existing.config.s3SecretAccessKeyEncrypted as string | undefined)
        : undefined;

    let encryptedSecret = existingEncrypted ?? '';
    if (parsedS3.data.s3SecretAccessKey && parsedS3.data.s3SecretAccessKey.length > 0) {
      encryptedSecret = encrypt(parsedS3.data.s3SecretAccessKey);
    }
    if (!encryptedSecret) {
      return NextResponse.json(
        { error: 'S3 secret key is required when configuring S3 storage' },
        { status: 400 }
      );
    }

    nextConfig = {
      s3Endpoint: parsedS3.data.s3Endpoint ?? '',
      s3Region: parsedS3.data.s3Region,
      s3Bucket: parsedS3.data.s3Bucket,
      s3Prefix: parsedS3.data.s3Prefix ?? '',
      s3AccessKeyId: parsedS3.data.s3AccessKeyId,
      s3SecretAccessKeyEncrypted: encryptedSecret,
      s3ForcePathStyle: parsedS3.data.s3ForcePathStyle ?? true,
    };
  }

  await exec(
    `insert into org_storage_settings (org_id, provider, config, updated_by, created_at, updated_at)
     values ($1, $2, $3::jsonb, $4, now(), now())
     on conflict (org_id) do update set
       provider = excluded.provider,
       config = excluded.config,
       updated_by = excluded.updated_by,
       updated_at = now()`,
    [orgId, provider, JSON.stringify(nextConfig), user.id]
  );

  return NextResponse.json({ ok: true });
}
