// Job handlers named in the manifest. Each is a thin call into the scans and alert senders.
import type { JobHandler } from '@ecomkit/core/contracts';
import { sendDigest } from './alerts';
import { daily, tick } from './scans';

export const tickJob: JobHandler = async () => tick();
export const digestHighJob: JobHandler = async () => void (await sendDigest('high'));
export const digestLowJob: JobHandler = async () => void (await sendDigest('low'));
export const dailyJob: JobHandler = async () => daily();
