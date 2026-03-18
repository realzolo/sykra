import Redis from 'ioredis';
import { logger } from '@/services/logger';

declare global {
  var __studioRedisClient: Redis | undefined;
  var __studioRedisWarned: boolean | undefined;
}

function warnOnce(message: string, error?: Error) {
  if (globalThis.__studioRedisWarned) {
    return;
  }
  globalThis.__studioRedisWarned = true;
  logger.warn(message, error);
}

export function getRedisClient(): Redis | null {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) {
    return null;
  }

  if (!globalThis.__studioRedisClient) {
    try {
      const client = new Redis(redisUrl, {
        maxRetriesPerRequest: 1,
        enableReadyCheck: false,
        lazyConnect: false,
      });

      client.on('error', (err) => {
        warnOnce('Redis connection error; falling back to in-memory admission control', err);
      });

      globalThis.__studioRedisClient = client;
    } catch (err) {
      warnOnce(
        'Failed to initialize Redis client; falling back to in-memory admission control',
        err instanceof Error ? err : new Error(String(err))
      );
      return null;
    }
  }

  return globalThis.__studioRedisClient ?? null;
}

