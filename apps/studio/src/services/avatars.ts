import { createHash } from 'crypto';
import { exec, query, queryOne } from '@/lib/db';
import type { JsonObject } from '@/lib/json';

const GRAVATAR_BASE_URL = 'https://www.gravatar.com/avatar';
const AVATAR_SIZE = 160;
const AVATAR_CACHE_REVALIDATE_MS = 30 * 24 * 60 * 60 * 1000;

type AvatarIdentityRow = {
  provider: string;
  profile: JsonObject | null;
  created_at: string;
};

type AvatarUserRow = {
  email: string | null;
  avatar_url: string | null;
  avatar_checked_at: string | null;
};

function gravatarHash(email: string) {
  return createHash('md5').update(email.trim().toLowerCase()).digest('hex');
}

export function buildGravatarAvatarUrl(email: string, size = AVATAR_SIZE) {
  return `${GRAVATAR_BASE_URL}/${gravatarHash(email)}?s=${size}&d=404`;
}

function extractProfileAvatar(provider: string, profile: JsonObject | null) {
  if (!profile) return null;

  const keysByProvider: Record<string, string[]> = {
    github: ['avatar_url'],
    google: ['picture', 'avatar_url'],
    gitlab: ['avatar_url', 'picture'],
  };

  const preferredKeys = [...(keysByProvider[provider] ?? []), 'avatar_url', 'picture', 'image', 'avatar', 'photo_url'];
  for (const key of preferredKeys) {
    const value = profile[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function isAvatarCacheFresh(checkedAt: string | null) {
  if (!checkedAt) return false;
  return Date.now() - new Date(checkedAt).getTime() < AVATAR_CACHE_REVALIDATE_MS;
}

async function hasGravatar(email: string) {
  const url = buildGravatarAvatarUrl(email);

  const headResponse = await fetch(url, { method: 'HEAD', cache: 'no-store' }).catch(() => null);
  if (headResponse) {
    if (headResponse.ok) return true;
    if (headResponse.status !== 405) return false;
  }

  const getResponse = await fetch(url, { method: 'GET', cache: 'no-store' }).catch(() => null);
  return !!getResponse?.ok;
}

async function resolveBestAvatarUrl(userId: string, email: string | null): Promise<string | null> {
  if (email && (await hasGravatar(email))) {
    return buildGravatarAvatarUrl(email);
  }

  const identities = await query<AvatarIdentityRow>(
    `select provider, profile, created_at
     from auth_identities
     where user_id = $1
     order by
       case provider
         when 'github' then 1
         when 'google' then 2
         when 'gitlab' then 3
         else 100
       end,
       created_at asc`,
    [userId]
  );

  for (const identity of identities) {
    const avatar = extractProfileAvatar(identity.provider, identity.profile);
    if (avatar) return avatar;
  }

  return null;
}

export async function syncUserAvatar(userId: string, options?: { force?: boolean }): Promise<string | null> {
  const user = await queryOne<AvatarUserRow>(
    `select email, avatar_url, avatar_checked_at
     from auth_users
     where id = $1`,
    [userId]
  );
  if (!user) return null;

  const currentAvatar = user.avatar_url?.trim() || null;
  const shouldRefresh = options?.force || !isAvatarCacheFresh(user.avatar_checked_at) || !currentAvatar;
  if (!shouldRefresh) {
    return currentAvatar;
  }

  const resolved = await resolveBestAvatarUrl(userId, user.email?.trim().toLowerCase() || null);
  const nextAvatar = resolved ?? currentAvatar;

  if (resolved !== currentAvatar) {
    await exec(
      `update auth_users
       set avatar_url = $2,
           avatar_checked_at = now(),
           updated_at = now()
       where id = $1`,
      [userId, nextAvatar]
    );
  } else {
    await exec(
      `update auth_users
       set avatar_checked_at = now(),
           updated_at = now()
       where id = $1`,
      [userId]
    );
  }

  return nextAvatar;
}
