create table if not exists studio_callback_outbox (
  id uuid primary key default gen_random_uuid(),
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  attempt_count int not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists studio_callback_outbox_pending_idx
  on studio_callback_outbox (status, next_attempt_at, created_at);
