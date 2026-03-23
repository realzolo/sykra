import type { PipelineRunStatus } from '@/services/pipelineTypes';

export const ANALYSIS_REPORT_STATUSES = [
  'pending',
  'running',
  'partial_done',
  'done',
  'partial_failed',
  'failed',
  'canceled',
] as const;
export type AnalysisReportStatus = (typeof ANALYSIS_REPORT_STATUSES)[number];

export const ANALYSIS_ACTIVE_STATUSES = ['pending', 'running'] as const;
export type AnalysisActiveStatus = (typeof ANALYSIS_ACTIVE_STATUSES)[number];

export const ANALYSIS_TERMINAL_STATUSES = [
  'done',
  'partial_done',
  'partial_failed',
  'failed',
  'canceled',
] as const;
export type AnalysisTerminalStatus = (typeof ANALYSIS_TERMINAL_STATUSES)[number];

export const ANALYSIS_RESULT_READY_STATUSES = ['done', 'partial_failed'] as const;
export type AnalysisResultReadyStatus = (typeof ANALYSIS_RESULT_READY_STATUSES)[number];

export const PIPELINE_TERMINAL_STATUSES = ['success', 'failed', 'canceled', 'timed_out'] as const;
export const PIPELINE_FAILURE_STATUSES = ['failed', 'canceled', 'timed_out'] as const;
export const PIPELINE_ACTIVE_STATUSES = ['queued', 'running', 'waiting_manual'] as const;
export const PIPELINE_RUNNING_STATUSES = ['queued', 'running'] as const;

export const ANALYSIS_ACTIVE_STATUSES_SQL = ANALYSIS_ACTIVE_STATUSES.map((status) => `'${status}'`).join(', ');
export const ANALYSIS_RESULT_READY_STATUSES_SQL = ANALYSIS_RESULT_READY_STATUSES
  .map((status) => `'${status}'`)
  .join(', ');
export const PIPELINE_ACTIVE_STATUSES_SQL = PIPELINE_ACTIVE_STATUSES.map((status) => `'${status}'`).join(', ');
export const PIPELINE_RUNNING_STATUSES_SQL = PIPELINE_RUNNING_STATUSES.map((status) => `'${status}'`).join(', ');

const analysisTerminalStatusSet = new Set<string>(ANALYSIS_TERMINAL_STATUSES);
const analysisResultReadyStatusSet = new Set<string>(ANALYSIS_RESULT_READY_STATUSES);
const pipelineTerminalStatusSet = new Set<string>(PIPELINE_TERMINAL_STATUSES);
const pipelineFailureStatusSet = new Set<string>(PIPELINE_FAILURE_STATUSES);

export function isAnalysisTerminalStatus(status: string | null | undefined): status is AnalysisTerminalStatus {
  return typeof status === 'string' && analysisTerminalStatusSet.has(status);
}

export function isAnalysisResultReadyStatus(status: string | null | undefined): status is AnalysisResultReadyStatus {
  return typeof status === 'string' && analysisResultReadyStatusSet.has(status);
}

export function isPipelineTerminalStatus(status: string | null | undefined): status is (typeof PIPELINE_TERMINAL_STATUSES)[number] {
  return typeof status === 'string' && pipelineTerminalStatusSet.has(status);
}

export function isPipelineFailureStatus(status: string | null | undefined): status is (typeof PIPELINE_FAILURE_STATUSES)[number] {
  return typeof status === 'string' && pipelineFailureStatusSet.has(status);
}

export function isPipelineTerminalRunStatus(status: PipelineRunStatus): boolean {
  return pipelineTerminalStatusSet.has(status);
}
