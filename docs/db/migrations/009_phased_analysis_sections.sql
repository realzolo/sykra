alter table analysis_reports
  add column if not exists analysis_snapshot jsonb not null default '{}',
  add column if not exists sse_seq bigint not null default 0;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'analysis_reports_status_check'
      and conrelid = 'analysis_reports'::regclass
  ) then
    alter table analysis_reports drop constraint analysis_reports_status_check;
  end if;
end
$$;

alter table analysis_reports
  alter column status type text using status::text;

update analysis_reports
   set status = 'running'
 where status = 'analyzing';

alter table analysis_reports
  add constraint analysis_reports_status_check
  check (status in ('pending','running','partial_done','done','partial_failed','failed','canceled'));

create table if not exists analysis_report_sections (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references analysis_reports(id) on delete cascade,
  phase text not null check (phase in ('core','security_performance','quality','suggestions')),
  attempt int not null default 1 check (attempt > 0),
  status text not null check (status in ('pending','running','done','failed','canceled')),
  payload jsonb,
  error_message text,
  duration_ms int,
  tokens_used int,
  token_usage jsonb,
  estimated_cost_usd numeric(12,6),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (report_id, phase, attempt)
);

create index if not exists idx_analysis_reports_status on analysis_reports(status);
create index if not exists idx_analysis_report_sections_report_id on analysis_report_sections(report_id);
create index if not exists idx_analysis_report_sections_report_phase on analysis_report_sections(report_id, phase, updated_at desc);
create index if not exists idx_analysis_report_sections_phase_status on analysis_report_sections(phase, status);

create or replace function notify_analysis_report_update() returns trigger as $$
declare
  payload json;
begin
  if TG_TABLE_NAME = 'analysis_reports' then
    payload := json_build_object(
      'reportId', NEW.id::text,
      'source', 'analysis_reports'
    );
  elsif TG_TABLE_NAME = 'analysis_report_sections' then
    payload := json_build_object(
      'reportId', NEW.report_id::text,
      'source', 'analysis_report_sections'
    );
  else
    return NEW;
  end if;

  perform pg_notify('analysis_report_updates', payload::text);
  return NEW;
end;
$$ language plpgsql;

drop trigger if exists trg_notify_analysis_reports on analysis_reports;
create trigger trg_notify_analysis_reports
after insert or update on analysis_reports
for each row execute function notify_analysis_report_update();

drop trigger if exists trg_notify_analysis_report_sections on analysis_report_sections;
create trigger trg_notify_analysis_report_sections
after insert or update on analysis_report_sections
for each row execute function notify_analysis_report_update();
