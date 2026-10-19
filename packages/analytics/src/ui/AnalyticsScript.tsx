import { BEACON_PATH, INGEST_PATH } from '../domain/beacon';

/** Put once in the storefront layout. Async, first-party, about 3 KB; posts to `endpoint`. */
export function AnalyticsScript({ src = BEACON_PATH, endpoint = INGEST_PATH }: { src?: string; endpoint?: string }) {
  return <script async src={src} data-e={endpoint} />;
}
