// Worker job and health check.
import { randomBytes } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { HealthResult, JobHandler } from '@ecomkit/core/contracts';
import { deriveAsset, staleProcessing } from './assets';
import { mediaRoot } from './storage';

/**
 * `media.warm`: with `{ assetId }` (queued after an upload) generates that asset's derivatives ahead of the
 * first visitor; with no assetId (the schedule) sweeps assets stuck in `processing` because a queue write failed.
 */
export const warmJob: JobHandler<{ assetId?: string }> = async (data, ctx) => {
  if (data.assetId) {
    await deriveAsset(data.assetId);
    return;
  }
  for (const id of await staleProcessing()) {
    try {
      await deriveAsset(id);
    } catch (err) {
      ctx.log.error('derivative generation failed', { assetId: id, error: String(err) });
    }
  }
};

/** Storage is writable (uploads and derivatives fail otherwise: disk full, wrong owner after a deploy). */
export async function storageHealth(): Promise<HealthResult> {
  const started = Date.now();
  const probe = join(mediaRoot(), '.health', randomBytes(6).toString('hex'));
  try {
    await mkdir(join(mediaRoot(), '.health'), { recursive: true });
    await writeFile(probe, 'ok');
    await rm(probe, { force: true });
    return { status: 'ok', latencyMs: Date.now() - started };
  } catch (err) {
    return { status: 'down', detail: `media storage not writable: ${(err as Error).message}`, latencyMs: Date.now() - started };
  }
}
