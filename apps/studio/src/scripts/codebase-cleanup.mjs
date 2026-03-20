#!/usr/bin/env node
 

const args = process.argv.slice(2);
const baseUrl = (process.env.STUDIO_BASE_URL || 'http://localhost:8109').replace(/\/+$/, '');
const token = process.env.TASK_SCHEDULER_TOKEN;

const maxAgeHours = getArgValue(args, '--max-age-hours');
const maxAgeMs = getArgValue(args, '--max-age-ms');

if (!token) {
  console.error('TASK_SCHEDULER_TOKEN is required to run codebase cleanup via API.');
  process.exit(1);
}

const params = new URLSearchParams();
if (maxAgeHours) params.set('max_age_hours', maxAgeHours);
if (maxAgeMs) params.set('max_age_ms', maxAgeMs);

const url = `${baseUrl}/api/codebase/cleanup${params.toString() ? `?${params}` : ''}`;

try {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'x-task-token': token,
    },
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`Cleanup failed (${res.status}):`, body.error || 'unknown_error');
    process.exit(1);
  }

  console.log(`Cleanup complete. Removed workspaces: ${body.removed ?? 0}`);
} catch (err) {
  console.error('Cleanup failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
}

function getArgValue(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) return null;
  return value;
}
