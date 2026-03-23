import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireUser, unauthorized } from '@/services/auth';
import { getActiveOrgId } from '@/services/orgs';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { formatErrorResponse } from '@/services/retry';
import { getPipelineRun, getPipelineRunEvents } from '@/services/conductorGateway';
import { logger } from '@/services/logger';
import type { JsonObject } from '@/lib/json';
import { isPipelineTerminalStatus } from '@/services/statuses';

export const dynamic = 'force-dynamic';

const rateLimiter = createInMemoryRateLimiter(RATE_LIMITS.general);

function encodeSse(data: JsonObject) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) return rateLimitResponse;

  const user = await requireUser();
  if (!user) return unauthorized();

  try {
    const { runId } = await params;
    const orgId = await getActiveOrgId(user.id, user.email ?? undefined, request);
    if (!orgId) return unauthorized();

    const initialDetail = await getPipelineRun(runId);
    if (initialDetail.run.org_id && initialDetail.run.org_id !== orgId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        let active = true;
        let heartbeat: ReturnType<typeof setInterval> | null = null;
        let poller: ReturnType<typeof setInterval> | null = null;
        let lastSequence = 0;
        let lastSnapshot = '';

        const cleanup = () => {
          if (!active) return;
          active = false;
          if (heartbeat) {
            clearInterval(heartbeat);
            heartbeat = null;
          }
          if (poller) {
            clearInterval(poller);
            poller = null;
          }
          try {
            controller.close();
          } catch {
            // Ignore close errors on disconnect.
          }
          logger.info(`Pipeline run stream disconnected: ${runId}`);
        };

        const send = (payload: JsonObject) => {
          if (!active) return;
          controller.enqueue(encoder.encode(encodeSse(payload)));
        };

        const emitSnapshot = async () => {
          const detail = await getPipelineRun(runId);
          if (!active) {
            return;
          }
          const snapshot = JSON.stringify(detail);
          if (snapshot !== lastSnapshot) {
            lastSnapshot = snapshot;
            send({
              type: 'run_update',
              runDetail: detail,
              timestamp: new Date().toISOString(),
            });
          }
          if (isPipelineTerminalStatus(detail.run.status)) {
            cleanup();
          }
        };

        const pollEvents = async () => {
          if (!active) {
            return;
          }
          try {
            const events = await getPipelineRunEvents(runId, lastSequence, 200);
            if (!events.length) {
              return;
            }

            await emitSnapshot();
            if (!active) {
              return;
            }
            lastSequence = events[events.length - 1]?.seq ?? lastSequence;
          } catch (err) {
            logger.warn(`Pipeline run stream poll failed: ${runId}`, err instanceof Error ? err : undefined);
          }
        };

        const bootstrap = async () => {
          try {
            controller.enqueue(encoder.encode(encodeSse({ type: 'connected' })));
            lastSnapshot = JSON.stringify(initialDetail);
            send({
              type: 'run_update',
              runDetail: initialDetail,
              timestamp: new Date().toISOString(),
            });

            if (isPipelineTerminalStatus(initialDetail.run.status)) {
              cleanup();
              return;
            }

            try {
              const events = await getPipelineRunEvents(runId, 0, 500);
              lastSequence = events[events.length - 1]?.seq ?? 0;
            } catch (err) {
              logger.warn(`Pipeline run stream seed failed: ${runId}`, err instanceof Error ? err : undefined);
            }

            heartbeat = setInterval(() => {
              try {
                controller.enqueue(encoder.encode(': heartbeat\n\n'));
              } catch {
                cleanup();
              }
            }, 30000);

            poller = setInterval(() => {
              void pollEvents();
            }, 1000);
          } catch (err) {
            logger.error(`Pipeline run stream bootstrap failed: ${runId}`, err instanceof Error ? err : undefined);
            cleanup();
          }
        };

        const abortHandler = () => cleanup();
        if (request.signal.aborted) {
          cleanup();
          return;
        }
        request.signal.addEventListener('abort', abortHandler, { once: true });
        void bootstrap();
      },
      cancel() {
        // Cleanup is driven by the request abort handler.
      },
    });

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    return NextResponse.json({ error }, { status: statusCode });
  }
}
