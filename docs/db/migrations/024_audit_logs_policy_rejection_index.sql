-- Accelerate pipeline policy rejection history queries by pipeline and recent time window.
create index if not exists idx_audit_logs_pipeline_policy_reject
  on audit_logs(entity_type, entity_id, created_at desc)
  where action = 'reject' and changes->>'scope' = 'pipeline_policy_reject';

