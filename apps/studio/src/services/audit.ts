/**
 * Audit log service
 * Tracks important actions for traceability and compliance
 */

import { exec, query } from '@/lib/db';
import type { JsonObject } from '@/lib/json';
import { logger } from './logger';

const auditLogColumnList = [
  'id',
  'action',
  'entity_type',
  'entity_id',
  'user_id',
  'changes',
  'ip_address',
  'user_agent',
  'created_at',
].join(', ');

export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'reject'
  | 'analyze'
  | 'export'
  | 'share'
  | 'login'
  | 'logout';

export type AuditEntityType = 'project' | 'pipeline' | 'report' | 'issue' | 'rule' | 'ruleset' | 'user' | 'org';

export interface AuditLogEntry {
  action: AuditAction;
  entityType: AuditEntityType;
  entityId?: string;
  userId?: string;
  changes?: JsonObject;
  ipAddress?: string | null;
  userAgent?: string | null;
}

type AuditLogRow = {
  id: string;
  action: AuditAction;
  entity_type: AuditEntityType;
  entity_id: string | null;
  user_id: string | null;
  changes: JsonObject | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
};

class AuditLogger {
  /**
   * Write an audit log entry
   */
  async log(entry: AuditLogEntry) {
    try {
      await exec(
        `insert into audit_logs (action, entity_type, entity_id, user_id, changes, ip_address, user_agent, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,now())`,
        [
          entry.action,
          entry.entityType,
          entry.entityId ?? null,
          entry.userId ?? null,
          entry.changes ? JSON.stringify(entry.changes) : null,
          entry.ipAddress ?? null,
          entry.userAgent ?? null,
        ]
      );

      logger.debug(
        `Audit logged: ${entry.action} ${entry.entityType}${entry.entityId ? ` (${entry.entityId})` : ''}`
      );
    } catch (err) {
      logger.error('Failed to log audit entry', err instanceof Error ? err : undefined);
    }
  }

  /**
   * Fetch audit logs
   */
  async getLogs(
    entityType?: AuditEntityType,
    entityId?: string,
    limit: number = 100
  ) {
    try {
      const params: unknown[] = [];
      const where: string[] = [];
      if (entityType) {
        params.push(entityType);
        where.push(`entity_type = $${params.length}`);
      }
      if (entityId) {
        params.push(entityId);
        where.push(`entity_id = $${params.length}`);
      }

      const rows = await query<AuditLogRow>(
        `select ${auditLogColumnList}
         from audit_logs
         ${where.length ? `where ${where.join(' and ')}` : ''}
         order by created_at desc
         limit ${limit}`,
        params
      );

      return rows || [];
    } catch (err) {
      logger.error('Failed to fetch audit logs', err instanceof Error ? err : undefined);
      return [];
    }
  }

  /**
   * Fetch user activity
   */
  async getUserActivity(userId: string, limit: number = 50) {
    try {
      const rows = await query<AuditLogRow>(
        `select ${auditLogColumnList}
         from audit_logs
         where user_id = $1
         order by created_at desc
         limit ${limit}`,
        [userId]
      );
      return rows || [];
    } catch (err) {
      logger.error('Failed to fetch user activity', err instanceof Error ? err : undefined);
      return [];
    }
  }

  /**
   * Cleanup old logs (keep 90 days)
   */
  async cleanup() {
    try {
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      await exec(
        `delete from audit_logs where created_at < $1`,
        [ninetyDaysAgo.toISOString()]
      );

      logger.info('Audit logs cleaned up');
    } catch (err) {
      logger.error('Failed to cleanup audit logs', err instanceof Error ? err : undefined);
    }
  }
}

export const auditLogger = new AuditLogger();

/**
 * Extract client info from request
 */
export function extractClientInfo(request: Request) {
  return {
    ipAddress: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip'),
    userAgent: request.headers.get('user-agent'),
  };
}
