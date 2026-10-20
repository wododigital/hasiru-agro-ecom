// pg-boss worker entry (second PM2 process, same code as the web app): starts the enabled modules'
// jobs, schedules and event subscribers from the generated registry.
// Contract for @ecomkit/core/jobs: export startWorker(registry) -> { stop() }.
import type { Registry } from '@ecomkit/core/manifest';
import { configureErpSync } from '@ecomkit/erp-sync/server';
import { opsAdapter } from '@ecomkit/hasiru-ops-adapter/server';
import { registry } from './src/generated/registry';

// Worker-side port bindings (the web process binds its own in instrumentation; WP-28 boot wiring).
// ponytail: only the ERP adapter so far; flows/marketing ports still unbound here (see BUILD-STATUS/verify-jobs.md).
configureErpSync({ adapter: opsAdapter });

interface WorkerEntry {
  startWorker(registry: Registry): Promise<{ stop(): Promise<void> }>;
}

const jobsEntry = '@ecomkit/core/jobs';
const { startWorker } = (await import(jobsEntry)) as WorkerEntry;
const worker = await startWorker(registry);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void worker.stop().then(() => process.exit(0));
  });
}
