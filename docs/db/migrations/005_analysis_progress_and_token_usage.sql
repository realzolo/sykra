alter table analysis_reports
  add column if not exists analysis_progress jsonb,
  add column if not exists token_usage jsonb;
