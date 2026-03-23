/**
 * Server-Sent Events (SSE) service
 * Streams analysis progress updates
 */

import { NextResponse } from 'next/server';
import { Client as PgClient } from 'pg';
import { queryOne } from '@/lib/db';
import type { NoResultRow } from '@/lib/db';
import type { JsonObject } from '@/lib/json';
import { logger } from './logger';
import { failTimedOutReport } from './reportTimeout';
import { isAnalysisTerminalStatus } from './statuses';

interface SSEClient {
  reportId: string;
  controller: ReadableStreamDefaultController<Uint8Array>;
}

const clients = new Map<string, SSEClient[]>();
const timeoutWatchers = new Map<string, NodeJS.Timeout>();
let pgListenerClient: PgClient | null = null;
let pgListenerConnected = false;
const lastSnapshots = new Map<string, {
  status: string | null;
  score: number | null;
  sseSeq: number | null;
  analysisProgressJson: string;
  analysisSectionsJson: string;
  tokenUsageJson: string;
  tokensUsed: number | null;
  errorMessage: string | null;
}>();

/**
 * Create SSE response
 */
export function createSSEResponse(reportId: string) {
  let clientRef: SSEClient | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let cleanedUp = false;

  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    if (clientRef) {
      const clientList = clients.get(reportId);
      if (clientList) {
        const index = clientList.indexOf(clientRef);
        if (index > -1) {
          clientList.splice(index, 1);
        }
        if (clientList.length === 0) {
          clients.delete(reportId);
          stopWatchingReport(reportId);
        }
      }
    }
    logger.info(`SSE client disconnected: ${reportId}`);
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const client: SSEClient = { reportId, controller };
      clientRef = client;

      // Add client to list
      if (!clients.has(reportId)) {
        clients.set(reportId, []);
      }
      clients.get(reportId)!.push(client);

      logger.info(`SSE client connected: ${reportId}`);

      // Send initial connection message
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode('data: {"type":"connected"}\n\n'));

      // Heartbeat to keep connection alive
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        } catch (err) {
          logger.warn(`Failed to send heartbeat to ${reportId}`, err instanceof Error ? err : undefined);
          cleanup();
        }
      }, 30000);

      // Handle client disconnect
      const abortHandler = () => cleanup();
      try {
        // Try abort event if supported
        const controllerWithSignal = controller as ReadableStreamDefaultController<Uint8Array> & {
          signal?: { addEventListener?: (event: string, handler: () => void) => void };
        };
        controllerWithSignal.signal?.addEventListener?.('abort', abortHandler);
      } catch {
        // Ignore if not supported
      }
    },
    cancel() {
      cleanup();
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

/**
 * Broadcast updates to all connected clients
 */
export function broadcastUpdate(reportId: string, data: JsonObject) {
  const clientList = clients.get(reportId);
  if (!clientList || clientList.length === 0) {
    return;
  }

  const encoder = new TextEncoder();
  const message = `data: ${JSON.stringify(data)}\n\n`;
  const encoded = encoder.encode(message);

  for (let i = clientList.length - 1; i >= 0; i -= 1) {
    const client = clientList[i];
    if (!client) {
      clientList.splice(i, 1);
      continue;
    }
    try {
      client.controller.enqueue(encoded);
    } catch (err) {
      logger.warn(`Failed to send SSE message to ${reportId}`, err instanceof Error ? err : undefined);
      clientList.splice(i, 1);
    }
  }

  if (clientList.length === 0) {
    clients.delete(reportId);
    stopWatchingReport(reportId);
  }
}

/**
 * Watch report status updates and broadcast changes
 */
export async function watchReportStatus(reportId: string) {
  await ensureReportNotifyListener();
  await emitReportSnapshot(reportId);

  if (!timeoutWatchers.has(reportId)) {
    const timer = setInterval(() => {
      if (!clients.has(reportId)) {
        stopWatchingReport(reportId);
        return;
      }
      void failTimedOutReport(reportId)
        .then(() => emitReportSnapshot(reportId))
        .catch((err) => logger.warn(`Failed timeout sweep for ${reportId}`, err instanceof Error ? err : undefined));
    }, 15_000);
    timeoutWatchers.set(reportId, timer);
  }

  return null;
}

/**
 * Cleanup all SSE connections
 */
export function cleanupSSEConnections() {
  clients.forEach((clientList) => {
    clientList.forEach((client) => {
      try {
        client.controller.close();
      } catch {
        // Ignore close errors
      }
    });
  });
  clients.clear();
  timeoutWatchers.forEach((timer) => clearInterval(timer));
  timeoutWatchers.clear();
  if (pgListenerClient) {
    void pgListenerClient.end().catch(() => undefined);
  }
  pgListenerClient = null;
  pgListenerConnected = false;
}

function stopPolling(reportId: string) {
  const interval = timeoutWatchers.get(reportId);
  if (interval) {
    clearInterval(interval);
  }
  timeoutWatchers.delete(reportId);
  lastSnapshots.delete(reportId);
}

function stopWatchingReport(reportId: string) {
  stopPolling(reportId);
}

async function ensureReportNotifyListener() {
  if (pgListenerConnected) {
    return;
  }
  if (pgListenerClient) {
    try {
      await pgListenerClient.end();
    } catch {
      // ignore previous client shutdown errors
    }
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not configured');
  }
  const listener = new PgClient({ connectionString });
  await listener.connect();
  await listener.query<NoResultRow>('LISTEN analysis_report_updates');
  listener.on('notification', (msg) => {
    if (!msg.payload) return;
    void handleReportNotification(msg.payload);
  });
  listener.on('error', (err) => {
    logger.error('Postgres LISTEN client error', err);
    pgListenerConnected = false;
  });

  pgListenerClient = listener;
  pgListenerConnected = true;
}

async function handleReportNotification(payloadRaw: string) {
  let reportId: string | null = null;
  try {
    const payload = JSON.parse(payloadRaw) as { reportId?: string };
    reportId = typeof payload.reportId === 'string' ? payload.reportId : null;
  } catch {
    // ignore malformed payload
  }
  if (!reportId) return;
  if (!clients.has(reportId)) return;
  await emitReportSnapshot(reportId);
}

async function emitReportSnapshot(reportId: string) {
  const row = await queryOne<{
    status: string | null;
    score: number | null;
    sse_seq: number | null;
    analysis_progress: unknown;
    sections: unknown;
    token_usage: unknown;
    tokens_used: number | null;
    error_message: string | null;
  }>(
    `select r.status,
            r.score,
            r.sse_seq,
            r.analysis_progress,
            r.token_usage,
            r.tokens_used,
            r.error_message,
            coalesce((
              select jsonb_agg(
                       jsonb_build_object(
                         'phase', s.phase,
                         'attempt', s.attempt,
                         'status', s.status,
                         'payload', s.payload,
                         'errorMessage', s.error_message,
                         'durationMs', s.duration_ms,
                         'tokensUsed', s.tokens_used,
                         'tokenUsage', s.token_usage,
                         'estimatedCostUsd', s.estimated_cost_usd,
                         'startedAt', s.started_at,
                         'completedAt', s.completed_at,
                         'updatedAt', s.updated_at
                       )
                       order by case s.phase
                         when 'core' then 1
                         when 'quality' then 2
                         when 'security_performance' then 3
                         when 'suggestions' then 4
                         else 99
                       end,
                       s.attempt desc
                     )
              from (
                select distinct on (phase)
                       phase,
                       attempt,
                       status,
                       payload,
                       error_message,
                       duration_ms,
                       tokens_used,
                       token_usage,
                       estimated_cost_usd,
                       started_at,
                       completed_at,
                       updated_at
                  from analysis_report_sections
                 where report_id = r.id
                 order by phase, attempt desc
              ) s
            ), '[]'::jsonb) as sections
     from analysis_reports r
     where r.id = $1`,
    [reportId]
  );

  if (!row) return;

  const analysisProgressJson = JSON.stringify(row.analysis_progress ?? null);
  const analysisSectionsJson = JSON.stringify(row.sections ?? []);
  const tokenUsageJson = JSON.stringify(row.token_usage ?? null);
  const previous = lastSnapshots.get(reportId);
  if (
    !previous ||
    previous.sseSeq !== row.sse_seq ||
    previous.status !== row.status ||
    previous.score !== row.score ||
    previous.analysisProgressJson !== analysisProgressJson ||
    previous.analysisSectionsJson !== analysisSectionsJson ||
    previous.tokenUsageJson !== tokenUsageJson ||
    previous.tokensUsed !== row.tokens_used ||
    previous.errorMessage !== row.error_message
  ) {
    lastSnapshots.set(reportId, {
      status: row.status,
      score: row.score,
      sseSeq: row.sse_seq,
      analysisProgressJson,
      analysisSectionsJson,
      tokenUsageJson,
      tokensUsed: row.tokens_used,
      errorMessage: row.error_message,
    });
    broadcastUpdate(reportId, {
      type: 'status_update',
      status: row.status,
      score: row.score,
      sequence: row.sse_seq,
      analysisProgress: row.analysis_progress ?? null,
      analysisSections: row.sections ?? [],
      tokenUsage: row.token_usage ?? null,
      tokensUsed: row.tokens_used ?? null,
      errorMessage: row.error_message ?? null,
      timestamp: new Date().toISOString(),
    });
    logger.info(`Report status updated: ${reportId} -> ${row.status}`);
  }

  if (isAnalysisTerminalStatus(row.status)) {
    stopWatchingReport(reportId);
  }
}
