import { defineModule } from '@ecomkit/core/manifest';

export default defineModule({
  id: 'planting-3d',
  dependsOn: ['core', 'planting'],
  routes: [{ path: '/models/[model]/3d', module: 'routes/model-3d', kind: 'page', exports: ['default', 'generateMetadata'] }],
});
