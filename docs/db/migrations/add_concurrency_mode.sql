-- Migration: add concurrency_mode to pipelines
-- Run this against your existing database to add the concurrency mode feature.

ALTER TABLE pipelines
  ADD COLUMN IF NOT EXISTS concurrency_mode TEXT NOT NULL DEFAULT 'allow'
    CHECK (concurrency_mode IN ('allow', 'queue', 'cancel_previous'));
