alter table org_runtime_settings
  add column if not exists pipeline_environments jsonb not null default '["development","preview","production"]'::jsonb;

alter table org_runtime_settings
  drop constraint if exists org_runtime_settings_pipeline_environments_check;

alter table org_runtime_settings
  add constraint org_runtime_settings_pipeline_environments_check
  check (jsonb_typeof(pipeline_environments) = 'array' and jsonb_array_length(pipeline_environments) > 0);
