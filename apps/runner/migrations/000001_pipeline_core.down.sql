drop table if exists pipeline_artifacts;
drop table if exists run_events;
drop sequence if exists run_events_seq;
drop table if exists pipeline_steps;
drop table if exists pipeline_jobs;
drop table if exists pipeline_runs;
alter table pipelines drop constraint if exists pipelines_current_version_fk;
drop table if exists pipeline_versions;
drop table if exists pipelines;
