import { exec, queryOne } from '@/lib/db';

const LOGIN_FAILURE_LIMIT = 5;
const LOGIN_FAILURE_WINDOW_MINUTES = 15;
const LOGIN_RATE_LIMIT = 10;
const ACCOUNT_LOCK_MINUTES = 15;

export async function recordLoginAttempt(
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

export async function checkLoginRateLimit(email: string, ip: string | null) {
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

export async function handleFailedLogin(
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

export async function handleSuccessfulLogin(
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
