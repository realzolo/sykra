alter table pipelines
  add column if not exists trigger_schedule text,
  add column if not exists last_scheduled_at timestamptz,
  add column if not exists next_scheduled_at timestamptz;

create index if not exists pipelines_next_scheduled_idx
  on pipelines (is_active, next_scheduled_at)
  where trigger_schedule is not null and next_scheduled_at is not null;
