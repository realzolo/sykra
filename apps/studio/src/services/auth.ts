import { NextResponse } from 'next/server';
import { cookies, headers } from 'next/headers';
import { createHash, randomBytes } from 'crypto';
import { hash, verify } from '@node-rs/argon2';
import { exec, execTx, query, queryOne, withTransaction } from '@/lib/db';
import type { JsonObject } from '@/lib/json';
import { sendEmail } from './email';
import { logger } from './logger';

export type AuthUser = {
  id: string;
  email?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
};

export type AuthSession = {
  id: string;
  userId: string;
  createdAt: Date;
  lastUsedAt?: Date | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  expiresAt: Date;
};

export type AuthErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'EMAIL_NOT_VERIFIED'
  | 'ACCOUNT_LOCKED'
  | 'RATE_LIMITED'
  | 'ACCOUNT_DISABLED';

export type AuthResult =
  | { user: AuthUser }
  | { error: AuthErrorCode; retryAfter?: number; lockedUntil?: string };

const SESSION_COOKIE = 'session';
const SESSION_TTL_DAYS = 14;
const SESSION_ROTATE_DAYS = 7;
const SESSION_MAX_PER_USER = 5;
const EMAIL_VERIFY_TTL_HOURS = 24;
const PASSWORD_RESET_TTL_HOURS = 2;
const LOGIN_FAILURE_LIMIT = 5;
const LOGIN_FAILURE_WINDOW_MINUTES = 15;
const LOGIN_RATE_LIMIT = 10;
const ACCOUNT_LOCK_MINUTES = 15;

type UserRow = {
  id: string;
  email: string | null;
  status: string;
  email_verified_at?: string | null;
  locked_until?: string | null;
  failed_login_count?: number | null;
};

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export async function getSession(): Promise<{ user: AuthUser; session: AuthSession; token: string } | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const tokenHash = hashToken(token);
  const row = await queryOne<{
    session_id: string;
    user_id: string;
    display_name: string | null;
    email: string | null;
    avatar_url: string | null;
    status: string;
    email_verified_at: string | null;
    created_at: string;
    last_used_at: string | null;
    ip_address: string | null;
    user_agent: string | null;
    expires_at: string;
  }>(
    `select s.id as session_id, s.user_id, s.created_at, s.last_used_at, s.ip_address, s.user_agent, s.expires_at,
            u.display_name, u.email, u.avatar_url, u.status, u.email_verified_at
     from auth_sessions s
     join auth_users u on u.id = s.user_id
     where s.session_token_hash = $1
       and s.revoked_at is null
       and s.expires_at > now()`,
    [tokenHash]
  );

  if (!row) return null;
  if (row.status === 'disabled') return null;
  if (!row.email_verified_at || row.status !== 'active') return null;

  await exec(
    `update auth_sessions set last_used_at = now()
     where id = $1`,
    [row.session_id]
  );

  return {
    user: {
      id: row.user_id,
      email: row.email,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
    },
    session: {
      id: row.session_id,
      userId: row.user_id,
      createdAt: new Date(row.created_at),
      lastUsedAt: row.last_used_at ? new Date(row.last_used_at) : null,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      expiresAt: new Date(row.expires_at),
    },
    token,
  };
}

export async function requireUser(): Promise<AuthUser | null> {
  try {
    const requestHeaders = await headers();
    const requestId = requestHeaders.get('x-request-id');
    if (requestId) {
      logger.setContext({ requestId });
    }
  } catch {}

  const session = await getSession();
  if (!session) return null;
  return session.user;
}

export function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export async function createUser(email: string, password: string, displayName?: string | null) {
  const existing = await queryOne<UserRow>('select id from auth_users where email = $1', [email]);
  if (existing) {
    throw new Error('Email already in use');
  }

  const passwordHash = await hash(password);
  const user = await queryOne<UserRow>(
    `insert into auth_users (email, display_name, status, email_verified_at, created_at, updated_at)
     values ($1, $2, $3, $4, now(), now())
     returning id, email, status`,
    [email, displayName ?? null, 'pending', null]
  );

  if (!user) {
    throw new Error('Failed to create user');
  }

  await exec(
    `insert into auth_credentials (user_id, password_hash, password_updated_at)
     values ($1, $2, now())`,
    [user.id, passwordHash]
  );

  return user;
}

export async function deleteAuthUser(userId: string) {
  await exec(`delete from auth_users where id = $1`, [userId]);
}

export async function sendVerificationEmail(email: string, token: string, baseUrl: string) {
  const verifyUrl = new URL('/verify', baseUrl);
  verifyUrl.searchParams.set('token', token);

  const text = [
    'Verify your email address to complete registration.',
    '',
    `Verification code: ${token}`,
    '',
    `Open this link: ${verifyUrl.toString()}`,
    '',
    'This verification link expires in 24 hours.',
    'If you did not create this account, you can ignore this email.',
  ].join('\n');

  await sendEmail({
    to: email,
    subject: '[Sykra] Verify your email',
    text,
  });
}

export async function upsertOAuthUser(input: {
  provider: string;
  providerUserId: string;
  email: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  profile: JsonObject;
}): Promise<AuthUser> {
  return withTransaction(async (client) => {
    const identityRow = await client.query<{
      user_id: string;
      email: string | null;
      status: string;
      display_name: string | null;
    }>(
      `select i.user_id, u.email, u.display_name, u.status
       from auth_identities i
       join auth_users u on u.id = i.user_id
       where i.provider = $1 and i.provider_user_id = $2`,
      [input.provider, input.providerUserId]
    );

    const existingIdentity = identityRow.rows[0];
    if (existingIdentity) {
      if (existingIdentity.status === 'disabled') {
        throw new Error('Account disabled');
      }

      await execTx(client,
        `update auth_users
         set display_name = coalesce(display_name, $2),
             avatar_url = coalesce(avatar_url, $3),
             email_verified_at = coalesce(email_verified_at, now()),
             status = case when status = 'disabled' then status else 'active' end,
             updated_at = now()
         where id = $1`,
        [existingIdentity.user_id, input.displayName ?? null, input.avatarUrl ?? null]
      );
      await execTx(client,
        `update auth_identities
         set email = $3,
             profile = $4
         where provider = $1 and provider_user_id = $2`,
        [input.provider, input.providerUserId, input.email, JSON.stringify(input.profile ?? {})]
      );

      return {
        id: existingIdentity.user_id,
        email: existingIdentity.email,
        displayName: existingIdentity.display_name,
      };
    }

    const userRow = await client.query<{
      id: string;
      email: string | null;
      display_name: string | null;
      status: string;
    }>(
      `insert into auth_users (email, display_name, avatar_url, status, email_verified_at, created_at, updated_at)
       values ($1, $2, $3, 'active', now(), now(), now())
       on conflict (email) do update
         set display_name = coalesce(auth_users.display_name, excluded.display_name),
             avatar_url = coalesce(auth_users.avatar_url, excluded.avatar_url),
             email_verified_at = coalesce(auth_users.email_verified_at, excluded.email_verified_at),
             status = case when auth_users.status = 'disabled' then auth_users.status else 'active' end,
             updated_at = now()
       returning id, email, display_name, status`,
      [input.email, input.displayName ?? null, input.avatarUrl ?? null]
    );

    const user = userRow.rows[0];
    if (!user) {
      throw new Error('Failed to create user');
    }
    if (user.status === 'disabled') {
      throw new Error('Account disabled');
    }

    const profile = JSON.stringify(input.profile ?? {});
    await execTx(client,
      `insert into auth_identities (user_id, provider, provider_user_id, email, profile, created_at)
       values ($1, $2, $3, $4, $5, now())
       on conflict (provider, provider_user_id) do nothing`,
      [user.id, input.provider, input.providerUserId, input.email, profile]
    );

    const linkedIdentity = await client.query<{
      user_id: string;
      email: string | null;
    }>(
      `select user_id, email
       from auth_identities
       where provider = $1 and provider_user_id = $2`,
      [input.provider, input.providerUserId]
    );
    const linkedUserId = linkedIdentity.rows[0]?.user_id ?? user.id;
    const linkedEmail = linkedIdentity.rows[0]?.email ?? user.email;
    return { id: linkedUserId, email: linkedEmail, displayName: user.display_name ?? input.displayName ?? null };
  });
}

export async function linkOAuthIdentityToUser(input: {
  userId: string;
  provider: string;
  providerUserId: string;
  email: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  profile: JsonObject;
}): Promise<AuthUser> {
  return withTransaction(async (client) => {
    const targetUserRow = await client.query<{
      id: string;
      email: string | null;
      display_name: string | null;
      status: string;
    }>(
      `select id, email, display_name, status
       from auth_users
       where id = $1`,
      [input.userId]
    );
    const targetUser = targetUserRow.rows[0];
    if (!targetUser) {
      throw new Error('User not found');
    }
    if (targetUser.status === 'disabled') {
      throw new Error('Account disabled');
    }

    const identityRow = await client.query<{
      user_id: string;
      status: string;
    }>(
      `select i.user_id, u.status
       from auth_identities i
       join auth_users u on u.id = i.user_id
       where i.provider = $1 and i.provider_user_id = $2`,
      [input.provider, input.providerUserId]
    );
    const existingIdentity = identityRow.rows[0];
    if (existingIdentity && existingIdentity.user_id !== input.userId) {
      throw new Error('This GitHub account is already linked to another user');
    }
    if (existingIdentity?.status === 'disabled') {
      throw new Error('Account disabled');
    }

    await execTx(client,
      `update auth_users
       set display_name = coalesce(display_name, $2),
           avatar_url = coalesce(avatar_url, $3),
           email_verified_at = coalesce(email_verified_at, now()),
           status = case when status = 'disabled' then status else 'active' end,
           updated_at = now()
       where id = $1`,
      [input.userId, input.displayName ?? null, input.avatarUrl ?? null]
    );

    const profile = JSON.stringify(input.profile ?? {});
    const identityUpdate = await client.query<{ _never?: never }>(
      `update auth_identities
       set email = $3,
           profile = $4
       where provider = $1 and provider_user_id = $2`,
      [input.provider, input.providerUserId, input.email, profile]
    );

    if (identityUpdate.rowCount === 0) {
      await execTx(client,
        `insert into auth_identities (user_id, provider, provider_user_id, email, profile, created_at)
         values ($1, $2, $3, $4, $5, now())
         on conflict (provider, provider_user_id) do nothing`,
        [input.userId, input.provider, input.providerUserId, input.email, profile]
      );
    }

    const linkedIdentity = await client.query<{
      user_id: string;
    }>(
      `select user_id
       from auth_identities
       where provider = $1 and provider_user_id = $2`,
      [input.provider, input.providerUserId]
    );
    const linkedUserId = linkedIdentity.rows[0]?.user_id;
    if (linkedUserId && linkedUserId !== input.userId) {
      throw new Error('This GitHub account is already linked to another user');
    }

    return { id: targetUser.id, email: targetUser.email, displayName: targetUser.display_name };
  });
}

export async function listOAuthProviders(userId: string): Promise<string[]> {
  const rows = await query<{ provider: string }>(
    `select distinct provider
     from auth_identities
     where user_id = $1
     order by provider asc`,
    [userId]
  );
  return rows.map((row) => row.provider);
}

export async function authenticateUser(
  email: string,
  password: string,
  ip?: string | null,
  userAgent?: string | null
): Promise<AuthResult> {
  const rateLimit = await checkLoginRateLimit(email, ip ?? null);
  if (!rateLimit.allowed) {
    await recordLoginAttempt(null, email, ip ?? null, userAgent ?? null, false, 'rate_limited');
    if (typeof rateLimit.retryAfter === 'number') {
      return { error: 'RATE_LIMITED', retryAfter: rateLimit.retryAfter };
    }
    return { error: 'RATE_LIMITED' };
  }

  const row = await queryOne<{
    id: string;
    email: string | null;
    display_name: string | null;
    status: string;
    email_verified_at: string | null;
    password_hash: string;
    failed_login_count: number | null;
    locked_until: string | null;
  }>(
    `select u.id, u.email, u.display_name, u.status, u.email_verified_at, u.failed_login_count, u.locked_until, c.password_hash
     from auth_users u
     join auth_credentials c on c.user_id = u.id
     where u.email = $1`,
    [email]
  );

  if (!row) {
    await recordLoginAttempt(null, email, ip ?? null, userAgent ?? null, false, 'not_found');
    return { error: 'INVALID_CREDENTIALS' };
  }

  if (row.status === 'disabled') {
    await recordLoginAttempt(row.id, email, ip ?? null, userAgent ?? null, false, 'disabled');
    return { error: 'ACCOUNT_DISABLED' };
  }

  if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
    await recordLoginAttempt(row.id, email, ip ?? null, userAgent ?? null, false, 'locked');
    return { error: 'ACCOUNT_LOCKED', lockedUntil: row.locked_until };
  }

  if (!row.email_verified_at || row.status !== 'active') {
    await recordLoginAttempt(row.id, email, ip ?? null, userAgent ?? null, false, 'unverified');
    return { error: 'EMAIL_NOT_VERIFIED' };
  }

  const ok = await verify(row.password_hash, password);
  if (!ok) {
    await handleFailedLogin(row.id, email, ip ?? null, userAgent ?? null);
    return { error: 'INVALID_CREDENTIALS' };
  }

  await handleSuccessfulLogin(row.id, email, ip ?? null, userAgent ?? null);

  return { user: { id: row.id, email: row.email, displayName: row.display_name } };
}

export async function createSession(userId: string, ip?: string | null, userAgent?: string | null) {
  const token = randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  const row = await queryOne<{ id: string }>(
    `insert into auth_sessions (user_id, session_token_hash, expires_at, ip_address, user_agent, created_at)
     values ($1, $2, $3, $4, $5, now())
     returning id`,
    [userId, tokenHash, expiresAt, ip ?? null, userAgent ?? null]
  );

  if (row?.id) {
    await enforceSessionLimit(userId, row.id);
  }

  return { token, expiresAt, sessionId: row?.id };
}

export async function revokeSession(token: string) {
  const tokenHash = hashToken(token);
  await exec(
    `update auth_sessions set revoked_at = now()
     where session_token_hash = $1`,
    [tokenHash]
  );
}

export async function revokeSessionById(userId: string, sessionId: string) {
  await exec(
    `update auth_sessions set revoked_at = now()
     where id = $1 and user_id = $2`,
    [sessionId, userId]
  );
}

export async function revokeAllSessions(userId: string, keepSessionId?: string | null) {
  await exec(
    `update auth_sessions set revoked_at = now()
     where user_id = $1 and revoked_at is null ${keepSessionId ? 'and id <> $2' : ''}`,
    keepSessionId ? [userId, keepSessionId] : [userId]
  );
}

export async function listSessions(userId: string): Promise<AuthSession[]> {
  const rows = await query<{
    id: string;
    user_id: string;
    created_at: string;
    last_used_at: string | null;
    ip_address: string | null;
    user_agent: string | null;
    expires_at: string;
  }>(
    `select id, user_id, created_at, last_used_at, ip_address, user_agent, expires_at
     from auth_sessions
     where user_id = $1 and revoked_at is null
     order by created_at desc`,
    [userId]
  );

  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    createdAt: new Date(row.created_at),
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at) : null,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    expiresAt: new Date(row.expires_at),
  }));
}

export async function maybeRotateSession(
  token: string,
  userId: string,
  ip?: string | null,
  userAgent?: string | null
) {
  const tokenHash = hashToken(token);
  const session = await queryOne<{ id: string; created_at: string; last_used_at: string | null }>(
    `select id, created_at, last_used_at
     from auth_sessions
     where session_token_hash = $1 and revoked_at is null`,
    [tokenHash]
  );

  if (!session) return null;

  const lastUsed = session.last_used_at ?? session.created_at;
  const shouldRotate =
    Date.now() - new Date(lastUsed).getTime() > SESSION_ROTATE_DAYS * 24 * 60 * 60 * 1000;

  if (!shouldRotate) return null;

  const { token: newToken, expiresAt } = await createSession(userId, ip ?? null, userAgent ?? null);
  await exec(`update auth_sessions set revoked_at = now() where id = $1`, [session.id]);
  return { token: newToken, expiresAt };
}

export function setSessionCookie(response: NextResponse, token: string, expiresAt: Date) {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

export async function createEmailVerification(userId: string) {
  const token = randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + EMAIL_VERIFY_TTL_HOURS * 60 * 60 * 1000);

  await exec(`delete from auth_email_verifications where user_id = $1`, [userId]);
  await exec(
    `insert into auth_email_verifications (user_id, token_hash, expires_at, created_at)
     values ($1,$2,$3,now())`,
    [userId, tokenHash, expiresAt]
  );

  return { token, expiresAt };
}

export async function verifyEmailToken(token: string): Promise<boolean> {
  const tokenHash = hashToken(token);
  const row = await queryOne<{ id: string; user_id: string }>(
    `select id, user_id
     from auth_email_verifications
     where token_hash = $1 and expires_at > now() and used_at is null`,
    [tokenHash]
  );
  if (!row) return false;

  await withTransaction(async (client) => {
    await execTx(client, `update auth_email_verifications set used_at = now() where id = $1`, [row.id]);
    await execTx(client,
      `update auth_users
       set email_verified_at = now(),
           status = case when status = 'pending' then 'active' else status end,
           updated_at = now()
       where id = $1`,
      [row.user_id]
    );
  });

  return true;
}

export async function createPasswordReset(email: string) {
  const user = await queryOne<UserRow>(
    `select id, email_verified_at, status from auth_users where email = $1`,
    [email]
  );
  if (!user || user.status === 'disabled') {
    return null;
  }
  if (!user.email_verified_at || user.status !== 'active') {
    return null;
  }

  const token = randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_HOURS * 60 * 60 * 1000);

  await exec(`delete from auth_password_resets where user_id = $1 and used_at is null`, [user.id]);
  await exec(
    `insert into auth_password_resets (user_id, token_hash, expires_at, created_at)
     values ($1,$2,$3,now())`,
    [user.id, tokenHash, expiresAt]
  );

  return { token, expiresAt };
}

export async function resetPasswordWithToken(token: string, newPassword: string): Promise<boolean> {
  const tokenHash = hashToken(token);
  const row = await queryOne<{ id: string; user_id: string }>(
    `select id, user_id
     from auth_password_resets
     where token_hash = $1 and expires_at > now() and used_at is null`,
    [tokenHash]
  );
  if (!row) return false;

  const passwordHash = await hash(newPassword);

  await withTransaction(async (client) => {
    await execTx(client,
      `insert into auth_credentials (user_id, password_hash, password_updated_at)
       values ($1, $2, now())
       on conflict (user_id) do update
         set password_hash = excluded.password_hash,
             password_updated_at = now()`,
      [row.user_id, passwordHash]
    );
    await execTx(client, `update auth_password_resets set used_at = now() where id = $1`, [row.id]);
    await execTx(client, `update auth_users set updated_at = now() where id = $1`, [row.user_id]);
    await execTx(client,
      `update auth_sessions set revoked_at = now() where user_id = $1 and revoked_at is null`,
      [row.user_id]
    );
  });

  return true;
}

export async function cleanupAuthData() {
  const expiredSessions = await query<{ count: number }>(
    `delete from auth_sessions
     where expires_at < now() or (revoked_at is not null and revoked_at < now() - interval '30 days')
     returning 1 as count`
  );
  const emailTokens = await query<{ count: number }>(
    `delete from auth_email_verifications
     where expires_at < now() or used_at is not null
     returning 1 as count`
  );
  const resetTokens = await query<{ count: number }>(
    `delete from auth_password_resets
     where expires_at < now() or used_at is not null
     returning 1 as count`
  );
  const attempts = await query<{ count: number }>(
    `delete from auth_login_attempts
     where created_at < now() - interval '30 days'
     returning 1 as count`
  );

  return {
    sessions: expiredSessions.length,
    emailVerifications: emailTokens.length,
    passwordResets: resetTokens.length,
    loginAttempts: attempts.length,
  };
}

async function enforceSessionLimit(userId: string, newSessionId: string) {
  const sessions = await query<{ id: string }>(
    `select id from auth_sessions
     where user_id = $1 and revoked_at is null
     order by created_at desc`,
    [userId]
  );

  if (sessions.length <= SESSION_MAX_PER_USER) return;

  const toRevoke = sessions
    .filter((s) => s.id !== newSessionId)
    .slice(SESSION_MAX_PER_USER - 1);

  if (toRevoke.length === 0) return;

  await exec(
    `update auth_sessions set revoked_at = now()
     where id = any($1::uuid[])`,
    [toRevoke.map((s) => s.id)]
  );
}

async function handleFailedLogin(
  userId: string,
  email: string,
  ip?: string | null,
  userAgent?: string | null
) {
  await recordLoginAttempt(userId, email, ip ?? null, userAgent ?? null, false, 'invalid_password');

  const row = await queryOne<{ failed_login_count: number }>(
    `update auth_users
     set failed_login_count = failed_login_count + 1, updated_at = now()
     where id = $1
     returning failed_login_count`,
    [userId]
  );

  if (row && row.failed_login_count >= LOGIN_FAILURE_LIMIT) {
    const lockedUntil = new Date(Date.now() + ACCOUNT_LOCK_MINUTES * 60 * 1000);
    await exec(
      `update auth_users
       set locked_until = $2, updated_at = now()
       where id = $1`,
      [userId, lockedUntil]
    );
  }
}

async function handleSuccessfulLogin(
  userId: string,
  email: string,
  ip?: string | null,
  userAgent?: string | null
) {
  await recordLoginAttempt(userId, email, ip ?? null, userAgent ?? null, true, null);
  await exec(
    `update auth_users
     set failed_login_count = 0, locked_until = null, last_login_at = now(), updated_at = now()
     where id = $1`,
    [userId]
  );
}

async function recordLoginAttempt(
  userId: string | null,
  email: string,
  ip: string | null,
  userAgent: string | null,
  success: boolean,
  failureReason: string | null
) {
  await exec(
    `insert into auth_login_attempts
      (user_id, email, ip_address, user_agent, success, failure_reason, created_at)
     values ($1,$2,$3,$4,$5,$6,now())`,
    [userId, email, ip, userAgent, success, failureReason]
  );
}

async function checkLoginRateLimit(email: string, ip: string | null) {
  const windowStart = new Date(Date.now() - LOGIN_FAILURE_WINDOW_MINUTES * 60 * 1000);
  const params: unknown[] = [windowStart.toISOString(), email];
  let sql =
    `select count(*)::int as count
     from auth_login_attempts
     where (success = false and created_at > $1 and email = $2)`;

  if (ip) {
    params.push(ip);
    sql += ` or (success = false and created_at > $1 and ip_address = $3)`;
  }

  const row = await queryOne<{ count: number }>(sql, params);
  const count = row?.count ?? 0;
  if (count >= LOGIN_RATE_LIMIT) {
    const retryAfter = LOGIN_FAILURE_WINDOW_MINUTES * 60;
    return { allowed: false, retryAfter };
  }
  return { allowed: true };
}
