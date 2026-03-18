-- Migration 004: API Tokens
-- External API tokens for programmatic access to Spec-Axis

create table if not exists api_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth_users(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  token_hash text not null unique,   -- SHA-256 hex hash; plaintext shown once at creation
  token_prefix text not null,        -- First 8 chars of the plaintext token (for display)
  scopes text[] not null default '{}',
  last_used_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  constraint api_tokens_scopes_check check (
    scopes <@ array['read','write','pipeline:trigger']::text[]
  )
);

create index if not exists api_tokens_user_idx on api_tokens(user_id);
create index if not exists api_tokens_org_idx on api_tokens(org_id);
create index if not exists api_tokens_hash_idx on api_tokens(token_hash);
