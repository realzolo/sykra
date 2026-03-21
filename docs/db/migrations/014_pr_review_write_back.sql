-- 014_pr_review_write_back.sql
-- Persist the external PR/MR comment id so review write-back updates the same thread.

begin;

alter table review_runs
  add column if not exists comment_id text;

commit;
