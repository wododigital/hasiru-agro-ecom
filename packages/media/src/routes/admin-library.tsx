// /admin/media
import type { Metadata } from 'next';

export { LibraryPage as default } from '../admin/LibraryPage';

export function generateMetadata(): Metadata {
  return { title: 'Media library', robots: { index: false } };
}
