import { query, queryOne } from '@/lib/db';
import { getActiveOrgId } from '@/services/orgs';
import { getSession, listOAuthProviders, listSessions } from '@/services/auth';

export type AccountSession = {
  id: string;
  createdAt: string;
  lastUsedAt?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  expiresAt: string;
  isCurrent: boolean;
};

export type AccountToken = {
  id: string;
  name: string;
  token_prefix: string;
  scopes: string[];
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
};

export type AccountOrg = {
  id: string;
  name: string;
  slug: string;
  is_personal: boolean;
};

export type AccountPageData = {
  user: {
    id: string;
    email: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  };
  activeOrg: AccountOrg | null;
  sessions: AccountSession[];
  tokens: AccountToken[];
  providers: string[];
};

export async function loadAccountPageData(): Promise<AccountPageData | null> {
  const session = await getSession();
  if (!session) return null;

  const activeOrgId = await getActiveOrgId(session.user.id, session.user.email ?? undefined);
  const [sessions, providers, org] = await Promise.all([
    listSessions(session.user.id),
    listOAuthProviders(session.user.id),
    queryOne<AccountOrg>(
      `select id, name, slug, is_personal
       from organizations
       where id = $1`,
      [activeOrgId]
    ),
  ]);

  const tokenRows = await query<AccountToken>(
    `select id, name, token_prefix, scopes, last_used_at, expires_at, created_at
     from api_tokens
     where user_id = $1 and org_id = $2
     order by created_at desc`,
    [session.user.id, activeOrgId]
  );

  return {
    user: {
      id: session.user.id,
      email: session.user.email ?? null,
      displayName: session.user.displayName ?? null,
      avatarUrl: session.user.avatarUrl ?? null,
    },
    activeOrg: org ?? null,
    sessions: sessions.map((item) => ({
      id: item.id,
      createdAt: item.createdAt.toISOString(),
      lastUsedAt: item.lastUsedAt?.toISOString() ?? null,
      ipAddress: item.ipAddress ?? null,
      userAgent: item.userAgent ?? null,
      expiresAt: item.expiresAt.toISOString(),
      isCurrent: item.id === session.session.id,
    })),
    tokens: tokenRows,
    providers,
  };
}
