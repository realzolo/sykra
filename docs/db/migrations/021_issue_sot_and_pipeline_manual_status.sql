alter table pipeline_runs
  drop constraint if exists pipeline_runs_status_check;

alter table pipeline_runs
  add constraint pipeline_runs_status_check
  check (status in ('queued','running','waiting_manual','success','failed','canceled','timed_out','skipped'));

alter table pipeline_jobs
  drop constraint if exists pipeline_jobs_status_check;

alter table pipeline_jobs
  add constraint pipeline_jobs_status_check
  check (status in ('queued','running','waiting_manual','success','failed','canceled','timed_out','skipped'));

alter table pipeline_steps
  drop constraint if exists pipeline_steps_status_check;

alter table pipeline_steps
  add constraint pipeline_steps_status_check
  check (status in ('queued','running','waiting_manual','success','failed','canceled','timed_out','skipped'));

create or replace function create_quality_snapshot()
returns trigger as $$
begin
  if new.status = 'done' and old.status != 'done' then
    insert into analysis_quality_snapshots (
      project_id,
      report_id,
      score,
      category_scores,
      total_issues,
      critical_issues,
      high_issues,
      medium_issues,
      low_issues
    )
    values (
      new.project_id,
      new.id,
      new.score,
      new.category_scores,
      (select count(*) from analysis_issues i where i.report_id = new.id),
      (select count(*) from analysis_issues i where i.report_id = new.id and i.severity = 'critical'),
      (select count(*) from analysis_issues i where i.report_id = new.id and i.severity = 'high'),
      (select count(*) from analysis_issues i where i.report_id = new.id and i.severity = 'medium'),
      (select count(*) from analysis_issues i where i.report_id = new.id and i.severity = 'low')
    )
    on conflict (project_id, snapshot_date) do update
    set
      report_id = excluded.report_id,
      score = excluded.score,
      category_scores = excluded.category_scores,
      total_issues = excluded.total_issues,
      critical_issues = excluded.critical_issues,
      high_issues = excluded.high_issues,
      medium_issues = excluded.medium_issues,
      low_issues = excluded.low_issues;
  end if;
  return new;
end;
$$ language plpgsql;

alter table analysis_reports
  drop column if exists issues;

alter table analysis_reports
  drop column if exists priority_issues;

create index if not exists idx_analysis_reports_org_status_created_at
  on analysis_reports (org_id, status, created_at desc);

create index if not exists idx_analysis_reports_project_status_created_at
  on analysis_reports (project_id, status, created_at desc);

create index if not exists idx_analysis_issues_report_status
  on analysis_issues (report_id, status);

create index if not exists idx_analysis_issues_report_severity
  on analysis_issues (report_id, severity);
