alter table auth_users
  add column if not exists avatar_checked_at timestamptz;
