/**
 * Structured logging service
 * Supports log levels and contextual metadata
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  requestId?: string;
  userId?: string;
  projectId?: string;
  reportId?: string;
  [key: string]: string | number | boolean | undefined;
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: LogContext;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
  duration?: number;
}

class Logger {
  private readonly contextStorage = new AsyncLocalStorage<LogContext>();
  private fallbackContext: LogContext = {};

  private currentContext(): LogContext {
    return this.contextStorage.getStore() ?? this.fallbackContext;
  }

  setContext(ctx: LogContext) {
    const merged = { ...this.currentContext(), ...ctx };
    // Bind context to the current async execution chain to avoid cross-request context leakage.
    this.contextStorage.enterWith(merged);
  }

  clearContext() {
    if (this.contextStorage.getStore()) {
      this.contextStorage.enterWith({});
      return;
    }
    this.fallbackContext = {};
  }

  private formatEntry(level: LogLevel, message: string, error?: Error, duration?: number): LogEntry {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
    };

    const context = this.currentContext();
    if (Object.keys(context).length > 0) {
      entry.context = context;
    }

    if (error) {
      const errorEntry: { name: string; message: string; stack?: string } = {
        name: error.name,
        message: error.message,
      };
      if (error.stack) {
        errorEntry.stack = error.stack;
      }
      entry.error = errorEntry;
    }

    if (typeof duration === 'number') {
      entry.duration = duration;
    }

    return entry;
  }

  private log(entry: LogEntry) {
    // In production, this could be sent to a log aggregation service
    const output = JSON.stringify(entry);

    if (entry.level === 'error') {
      console.error(output);
    } else if (entry.level === 'warn') {
      console.warn(output);
    } else {
      console.log(output);
    }
  }

  debug(message: string, duration?: number) {
    this.log(this.formatEntry('debug', message, undefined, duration));
  }

  info(message: string, duration?: number) {
    this.log(this.formatEntry('info', message, undefined, duration));
  }

  warn(message: string, error?: Error) {
    this.log(this.formatEntry('warn', message, error));
  }

  error(message: string, error?: Error) {
    this.log(this.formatEntry('error', message, error));
  }

  async measure<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const start = Date.now();
    try {
      const result = await fn();
      const elapsed = Date.now() - start;
      this.info(`${label} completed`, elapsed);
      return result;
    } catch (err) {
      this.error(`${label} failed`, err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }
}

export const logger = new Logger();
