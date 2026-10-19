import { headers } from 'next/headers';
import { Suspense } from 'react';
import { background, logNotFound, seoRuntime } from '../server';
import { NotFoundView } from '../ui';

/** Logs the 404 when the proxy passed the request path along (`x-pathname`); renders nothing. */
async function NotFoundLogger() {
  const h = await headers();
  const path = h.get('x-pathname');
  if (path) await background(() => logNotFound(path, h.get('referer')));
  return null;
}

/** app/not-found.tsx: the 404 page (status 404 comes from Next). */
export default function NotFound() {
  const rt = seoRuntime();
  return (
    <>
      <NotFoundView messages={rt.messages.notFound} searchPath={rt.site.searchPath} links={rt.notFoundLinks} />
      <Suspense fallback={null}>
        <NotFoundLogger />
      </Suspense>
    </>
  );
}
