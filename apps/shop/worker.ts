// pg-boss worker entry (second PM2 process, same code as the web app): binds the module ports, then starts the
// enabled modules' jobs, schedules and event subscribers from the generated registry.
import { startWorker } from '@ecomkit/core/jobs';
import { boot } from './src/boot';
import { registry } from './src/generated/registry';

await boot();
const worker = await startWorker(registry);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void worker.stop().then(() => process.exit(0));
  });
}
