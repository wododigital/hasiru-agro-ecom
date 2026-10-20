'use cache';
// Cached storefront reads of the models (tags `model:all` and `model:<slug>`; admin saves expire them).
import { cacheFor, tags } from '@ecomkit/core/cache-tags';
import type { PlanLayout } from '@ecomkit/core/contracts';
import type { ModelWithMembers } from '../domain';
import { ALL_MODELS_TAG, loadModel, loadModels } from './models';
import { modelLayout } from './plans';
import { orElse, plantingRuntime, type ModelVideo } from './runtime';

export async function activeModels(): Promise<ModelWithMembers[]> {
  const models = await loadModels({ activeOnly: true });
  cacheFor([ALL_MODELS_TAG, ...models.map((m) => tags.model(m.slug))]);
  return models;
}

export async function activeModel(slug: string): Promise<ModelWithMembers | null> {
  cacheFor([tags.model(slug)]);
  const model = await loadModel(slug);
  return model?.isActive ? model : null;
}

export interface ModelPageData {
  model: ModelWithMembers;
  layout: PlanLayout;
  videos: ModelVideo[];
}

/** /models/[model]: the model, its pattern drawn with the default picks on one acre, and its videos. */
export async function modelPage(slug: string): Promise<ModelPageData | null> {
  cacheFor([tags.model(slug), tags.catalog]);
  const model = await loadModel(slug);
  if (!model?.isActive) return null;
  const layout = await modelLayout(slug);
  const videos = plantingRuntime().videos;
  return layout ? { model, layout, videos: videos ? await orElse(() => videos(slug), []) : [] } : null;
}
