import { hash } from '@node-rs/argon2';
import { exec, execTx, query, queryOne, withTransaction } from '@/lib/db';
import { createOpaqueToken, hashToken } from '@/services/authTokenHash';

const EMAIL_VERIFY_TTL_HOURS = 24;
const PASSWORD_RESET_TTL_HOURS = 2;

type PasswordResetUserRow = {
  id: string;
  email_verified_at?: string | null;
  status: string;
};

export async function createEmailVerification(userId: string) {
  const token = createOpaqueToken();
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
  const tokenHashValue = hashToken(token);
  const row = await queryOne<{ id: string; user_id: string }>(
    `select id, user_id
     from auth_email_verifications
     where token_hash = $1 and expires_at > now() and used_at is null`,
    [tokenHashValue]
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
  const user = await queryOne<PasswordResetUserRow>(
    `select id, email_verified_at, status from auth_users where email = $1`,
    [email]
  );
  if (!user || user.status === 'disabled') {
    return null;
  }
  if (!user.email_verified_at || user.status !== 'active') {
    return null;
  }

  const token = createOpaqueToken();
  const tokenHashValue = hashToken(token);
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_HOURS * 60 * 60 * 1000);

  await exec(`delete from auth_password_resets where user_id = $1 and used_at is null`, [user.id]);
  await exec(
    `insert into auth_password_resets (user_id, token_hash, expires_at, created_at)
     values ($1,$2,$3,now())`,
    [user.id, tokenHashValue, expiresAt]
  );

  return { token, expiresAt };
}

export async function resetPasswordWithToken(token: string, newPassword: string): Promise<boolean> {
  const tokenHashValue = hashToken(token);
  const row = await queryOne<{ id: string; user_id: string }>(
    `select id, user_id
     from auth_password_resets
     where token_hash = $1 and expires_at > now() and used_at is null`,
    [tokenHashValue]
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
