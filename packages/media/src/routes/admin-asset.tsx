// /admin/media/[id]
import type { Metadata } from 'next';

export { AssetPage as default } from '../admin/AssetPage';

export function generateMetadata(): Metadata {
  return { title: 'Media file', robots: { index: false } };
}
