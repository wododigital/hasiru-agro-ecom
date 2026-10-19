import { defineAppConfig } from '@ecomkit/core/manifest';
import { modules } from './modules.config';

// Production build: run `pnpm modules:sync --config prod` before `next build`; no mock route stubs exist.
export default defineAppConfig({ app: 'shop', modules, mocks: false });
