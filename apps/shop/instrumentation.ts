import type { Instrumentation } from 'next';

// Server errors from every route. The core observability adapter (fingerprint, core_error_issue, alerts)
// replaces this console fallback once it exists; keep the export name.
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  console.error('[request-error]', { method: request.method, path: request.path, routeType: context.routeType, routePath: context.routePath }, error);
};
