import { NextResponse } from 'next/server';
import { Client as PgClient } from 'pg';
import { queryOne } from '@/lib/db';
import { logger } from './logger';

interface SSEClient {
  runId: string;
  controller: ReadableStreamDefaultController<Uint8Array>;
}

const clients = new Map<string, SSEClient[]>();
const lastSnapshots = new Map<string, string>();
let listenerClient: PgClient | null = null;
let listenerConnected = false;

export function createCodeReviewSSEResponse(runId: string) {
  let clientRef: SSEClient | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let cleaned = false;

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    if (clientRef) {
      const list = clients.get(runId);
      if (list) {
        const index = list.indexOf(clientRef);
        if (index >= 0) {
          list.splice(index, 1);
        }
        if (list.length === 0) {
          clients.delete(runId);
          lastSnapshots.delete(runId);
        }
      }
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const client: SSEClient = { runId, controller };
      clientRef = client;
      if (!clients.has(runId)) {
        clients.set(runId, []);
      }
      clients.get(runId)!.push(client);

      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode('data: {"type":"connected"}\n\n'));

      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        } catch {
          cleanup();
        }
      }, 30_000);
    },
    cancel() {
      cleanup();
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export async function watchCodeReviewRun(runId: string) {
  await ensureListener();
  await emitSnapshot(runId);
}

function broadcast(runId: string, payload: Record<string, unknown>) {
  const list = clients.get(runId);
  if (!list || list.length === 0) return;
  const message = `data: ${JSON.stringify(payload)}\n\n`;
  const encoded = new TextEncoder().encode(message);
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const client = list[i];
    if (!client) {
      list.splice(i, 1);
      continue;
    }
    try {
      client.controller.enqueue(encoded);
    } catch {
      list.splice(i, 1);
    }
  }
  if (list.length === 0) {
    clients.delete(runId);
    lastSnapshots.delete(runId);
  }
}

async function ensureListener() {
  if (listenerConnected) return;
  if (listenerClient) {
    try {
      await listenerClient.end();
    } catch {
      // ignore cleanup error
    }
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not configured');
  }
  const pg = new PgClient({ connectionString });
  await pg.connect();
  await pg.query('LISTEN code_review_run_updates');
  pg.on('notification', (msg) => {
    if (!msg.payload) return;
    void handleNotification(msg.payload);
  });
  pg.on('error', (err) => {
    logger.error('Code review LISTEN client error', err);
    listenerConnected = false;
  });
  listenerClient = pg;
  listenerConnected = true;
}

async function handleNotification(payloadRaw: string) {
  try {
    const payload = JSON.parse(payloadRaw) as { runId?: string };
    const runId = typeof payload.runId === 'string' ? payload.runId : '';
    if (!runId || !clients.has(runId)) return;
    await emitSnapshot(runId);
  } catch {
    // ignore malformed payload
  }
}

async function emitSnapshot(runId: string) {
  const row = await queryOne<{
    status: string | null;
    gate_status: string | null;
    score: number | null;
    risk_level: string | null;
    summary: string | null;
    result: unknown;
    progress: unknown;
    sse_seq: number | null;
    stages: unknown;
    tool_runs: unknown;
  }>(
    `select r.status,
            r.gate_status,
            r.score,
            r.risk_level,
            r.summary,
            r.result,
            r.progress,
            r.sse_seq,
            coalesce((
              select jsonb_agg(
                       jsonb_build_object(
                         'stage', s.stage,
                         'status', s.status,
                         'payload', s.payload,
                         'errorMessage', s.error_message,
                         'startedAt', s.started_at,
                         'completedAt', s.completed_at,
                         'updatedAt', s.updated_at
                       )
                       order by s.started_at asc
                     )
              from code_review_stages s
              where s.run_id = r.id
            ), '[]'::jsonb) as stages,
            coalesce((
              select jsonb_agg(
                       jsonb_build_object(
                         'tool', t.tool,
                         'status', t.status,
                         'command', t.command,
                         'exitCode', t.exit_code,
                         'durationMs', t.duration_ms,
                         'artifactPath', t.artifact_path,
                         'stdoutExcerpt', t.stdout_excerpt,
                         'stderrExcerpt', t.stderr_excerpt,
                         'startedAt', t.started_at,
                         'completedAt', t.completed_at
                       )
                       order by t.started_at asc
                     )
              from code_review_tool_runs t
              where t.run_id = r.id
            ), '[]'::jsonb) as tool_runs
     from code_review_runs r
     where r.id = $1`,
    [runId]
  );
  if (!row) return;

  const snapshot = JSON.stringify(row);
  const previous = lastSnapshots.get(runId);
  if (snapshot !== previous) {
    lastSnapshots.set(runId, snapshot);
    broadcast(runId, {
      type: 'status_update',
      status: row.status,
      gateStatus: row.gate_status,
      score: row.score,
      riskLevel: row.risk_level,
      summary: row.summary,
      result: row.result,
      progress: row.progress,
      sequence: row.sse_seq,
      stages: row.stages,
      toolRuns: row.tool_runs,
      timestamp: new Date().toISOString(),
    });
  }
}
