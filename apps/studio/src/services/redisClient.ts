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

export function getRedisClient(): Redis {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) {
    throw new Error('REDIS_URL is required for analyze admission control');
  }

  if (!globalThis.__studioRedisClient) {
    try {
      const client = new Redis(redisUrl, {
        maxRetriesPerRequest: 1,
        enableReadyCheck: false,
        lazyConnect: false,
      });

      client.on('error', (err) => {
        warnOnce('Redis connection error; analyze admission control is unavailable', err);
      });

      globalThis.__studioRedisClient = client;
    } catch (err) {
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  if (!globalThis.__studioRedisClient) {
    throw new Error('Failed to initialize Redis client');
  }
  return globalThis.__studioRedisClient;
}
