import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getPipelineRun, getPipelineRunEvents } from '@/services/conductorGateway';
import { logger } from '@/services/logger';
import type { JsonObject } from '@/lib/json';
import { isPipelineTerminalStatus } from '@/services/statuses';
import { hydrateRunActor, type HydratedPipelineRunDetail } from '@/services/pipelineRunHydration';

interface SnapshotSignature {
  full: string;
  run: string;
  jobs: string;
  steps: string;
}

interface RunStreamSubscriber {
  id: string;
  emit: (payload: JsonObject) => void;
  close: () => void;
}

interface RunStreamWatcher {
  runId: string;
  subscribers: Map<string, RunStreamSubscriber>;
  active: boolean;
  polling: boolean;
  seeded: boolean;
  idlePolls: number;
  lastSequence: number;
  lastSnapshot: SnapshotSignature | null;
  timer: ReturnType<typeof setTimeout> | null;
}

const runWatchers = new Map<string, RunStreamWatcher>();
let nextSubscriberId = 1;

function encodeSse(data: JsonObject) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function buildSnapshotSignature(detail: HydratedPipelineRunDetail): SnapshotSignature {
  return {
    full: JSON.stringify(detail),
    run: JSON.stringify(detail.run),
    jobs: JSON.stringify(detail.jobs),
    steps: JSON.stringify(detail.steps),
  };
}

function scheduleWatcherPoll(watcher: RunStreamWatcher) {
  if (!watcher.active) {
    return;
  }
  if (watcher.timer) {
    clearTimeout(watcher.timer);
    watcher.timer = null;
  }
  const baseDelayMs = watcher.idlePolls >= 12 ? 5000 : watcher.idlePolls >= 4 ? 2000 : 1000;
  const jitterMs = Math.floor(Math.random() * 250);
  watcher.timer = setTimeout(() => {
    void pollWatcher(watcher);
  }, baseDelayMs + jitterMs);
}

function stopWatcher(runId: string) {
  const watcher = runWatchers.get(runId);
  if (!watcher) {
    return;
  }
  watcher.active = false;
  if (watcher.timer) {
    clearTimeout(watcher.timer);
    watcher.timer = null;
  }
  watcher.subscribers.clear();
  runWatchers.delete(runId);
}

function closeWatcherSubscribers(watcher: RunStreamWatcher) {
  const subscribers = Array.from(watcher.subscribers.values());
  for (const subscriber of subscribers) {
    try {
      subscriber.close();
    } catch {
      // Ignore close errors.
    }
  }
}

function broadcastToSubscribers(watcher: RunStreamWatcher, payload: JsonObject) {
  for (const subscriber of watcher.subscribers.values()) {
    try {
      subscriber.emit(payload);
    } catch (err) {
      logger.warn(`Pipeline run stream subscriber emit failed: ${watcher.runId}`, err instanceof Error ? err : undefined);
      try {
        subscriber.close();
      } catch {
        // Ignore close errors on failed subscriber.
      }
    }
  }
}

async function seedWatcherSequence(watcher: RunStreamWatcher) {
  if (watcher.seeded) {
    return;
  }
  watcher.seeded = true;
  try {
    const events = await getPipelineRunEvents(watcher.runId, 0, 500);
    watcher.lastSequence = events[events.length - 1]?.seq ?? 0;
  } catch (err) {
    logger.warn(`Pipeline run stream seed failed: ${watcher.runId}`, err instanceof Error ? err : undefined);
  }
}

async function pollWatcher(watcher: RunStreamWatcher) {
  if (!watcher.active) {
    return;
  }
  if (watcher.polling) {
    return;
  }
  if (watcher.subscribers.size === 0) {
    stopWatcher(watcher.runId);
    return;
  }

  watcher.polling = true;
  try {
    await seedWatcherSequence(watcher);
    const events = await getPipelineRunEvents(watcher.runId, watcher.lastSequence, 200);
    if (events.length === 0) {
      watcher.idlePolls += 1;
      return;
    }
    watcher.idlePolls = 0;
    watcher.lastSequence = events[events.length - 1]?.seq ?? watcher.lastSequence;

    const detail = await hydrateRunActor(await getPipelineRun(watcher.runId));
    if (!watcher.active) {
      return;
    }

    const nextSignature = buildSnapshotSignature(detail);
    const previousSignature = watcher.lastSnapshot;
    const runChanged = previousSignature ? previousSignature.run !== nextSignature.run : true;
    const jobsChanged = previousSignature ? previousSignature.jobs !== nextSignature.jobs : true;
    const stepsChanged = previousSignature ? previousSignature.steps !== nextSignature.steps : true;

    if (!previousSignature || previousSignature.full !== nextSignature.full) {
      watcher.lastSnapshot = nextSignature;
      broadcastToSubscribers(watcher, {
        type: 'run_update',
        sequence: watcher.lastSequence,
        runDetail: detail,
        snapshot: {
          runChanged,
          jobsChanged,
          stepsChanged,
        },
        timestamp: new Date().toISOString(),
      });
    }

    if (isPipelineTerminalStatus(detail.run.status)) {
      closeWatcherSubscribers(watcher);
      stopWatcher(watcher.runId);
      return;
    }
  } catch (err) {
    logger.warn(`Pipeline run stream poll failed: ${watcher.runId}`, err instanceof Error ? err : undefined);
    watcher.idlePolls = Math.max(watcher.idlePolls, 2);
  } finally {
    watcher.polling = false;
    if (watcher.active && watcher.subscribers.size > 0) {
      scheduleWatcherPoll(watcher);
    } else {
      stopWatcher(watcher.runId);
    }
  }
}

function getOrCreateWatcher(runId: string, initialDetail: HydratedPipelineRunDetail): RunStreamWatcher {
  const existing = runWatchers.get(runId);
  if (existing) {
    if (!existing.lastSnapshot) {
      existing.lastSnapshot = buildSnapshotSignature(initialDetail);
    }
    return existing;
  }

  const watcher: RunStreamWatcher = {
    runId,
    subscribers: new Map<string, RunStreamSubscriber>(),
    active: true,
    polling: false,
    seeded: false,
    idlePolls: 0,
    lastSequence: 0,
    lastSnapshot: buildSnapshotSignature(initialDetail),
    timer: null,
  };
  runWatchers.set(runId, watcher);
  scheduleWatcherPoll(watcher);
  return watcher;
}

function subscribeWatcher(
  runId: string,
  initialDetail: HydratedPipelineRunDetail,
  emit: (payload: JsonObject) => void,
  close: () => void
): () => void {
  const watcher = getOrCreateWatcher(runId, initialDetail);
  const subscriberId = `sub-${nextSubscriberId++}`;
  watcher.subscribers.set(subscriberId, {
    id: subscriberId,
    emit,
    close,
  });
  if (!watcher.timer) {
    scheduleWatcherPoll(watcher);
  }
  return () => {
    const current = runWatchers.get(runId);
    if (!current) {
      return;
    }
    current.subscribers.delete(subscriberId);
    if (current.subscribers.size === 0) {
      stopWatcher(runId);
    }
  };
}

export function createPipelineRunStreamResponse(
  request: NextRequest,
  runId: string,
  initialDetail: HydratedPipelineRunDetail
) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      let active = true;
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      let unsubscribe: (() => void) | null = null;

      const cleanup = () => {
        if (!active) return;
        active = false;
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
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

      send({ type: 'connected' });
      send({
        type: 'run_update',
        sequence: 0,
        runDetail: initialDetail,
        snapshot: {
          runChanged: true,
          jobsChanged: true,
          stepsChanged: true,
        },
        timestamp: new Date().toISOString(),
      });

      if (isPipelineTerminalStatus(initialDetail.run.status)) {
        cleanup();
        return;
      }

      unsubscribe = subscribeWatcher(runId, initialDetail, send, cleanup);
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        } catch {
          cleanup();
        }
      }, 30000);

      const abortHandler = () => cleanup();
      if (request.signal.aborted) {
        cleanup();
        return;
      }
      request.signal.addEventListener('abort', abortHandler, { once: true });
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
}
