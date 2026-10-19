import type { Lazy, Logger } from './common';

export interface JobContext {
  jobId: string;
  queue: string;
  attempt: number;
  log: Logger;
}
export type JobHandler<T = unknown> = (data: T, ctx: JobContext) => Promise<void>;

/** Defaults (core/jobs): retryLimit 5, retryDelaySec 30, retryBackoff true, retryDelayMaxSec 3600, dead-letter queue `<name>.dead`. */
export interface JobOptions {
  policy?: 'standard' | 'short' | 'singleton' | 'stately';
  retryLimit?: number;
  retryDelaySec?: number;
  retryBackoff?: boolean;
  retryDelayMaxSec?: number;
  expireInSec?: number;
  deadLetter?: boolean;
}

export interface JobDef<T = unknown> {
  handler: Lazy<JobHandler<T>>;
  options?: JobOptions;
}

/** Cron schedule for a job declared in the same manifest. `tz` defaults to Asia/Kolkata. */
export interface ScheduleDef {
  job: string;
  cron: string;
  tz?: string;
  data?: Record<string, unknown>;
}
