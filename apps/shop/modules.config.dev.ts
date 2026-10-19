import { defineAppConfig } from '@ecomkit/core/manifest';
import { modules } from './modules.config';

// Mock routes (/api/_mock/*) are generated for this config.
export default defineAppConfig({ app: 'shop', modules, mocks: true });
