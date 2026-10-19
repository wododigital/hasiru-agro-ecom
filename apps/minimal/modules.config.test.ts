import { defineAppConfig } from '@ecomkit/core/manifest';
import { modules } from './modules.config';

export default defineAppConfig({ app: 'minimal', modules, mocks: true });
