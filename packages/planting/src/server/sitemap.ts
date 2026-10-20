import 'server-only';
import type { SitemapEntry } from '@ecomkit/core/contracts';
import { loadModels } from './models';

/** Model explainer pages and their curated plant listings (only models with plants). */
export async function modelSitemapEntries(): Promise<SitemapEntry[]> {
  const models = (await loadModels({ activeOnly: true })).filter((m) => m.members.length);
  return models.flatMap((m) => [
    { path: `/models/${m.slug}`, changeFrequency: 'monthly' as const },
    { path: `/plants/for/${m.slug}`, changeFrequency: 'weekly' as const },
  ]);
}
