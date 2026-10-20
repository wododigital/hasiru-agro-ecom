import type { PatchSpec, ViewerSource } from '../domain';
import { planting3dMessages, type Planting3dMessages } from '../messages';

/** What the viewer asks the host for: a plan's layout (or a model's sample layout when `planId` is null). */
export type LayoutSource = (input: { modelSlug: string; planId: string | null }) => Promise<ViewerSource | null>;

export interface Planting3dRuntimeInput {
  /** Bound at boot to the planting module's layout API. Without it the 3D route answers 404. */
  layout?: LayoutSource | null;
  /** Patch size and display scale per model slug (defaults: DEFAULT_PATCHES). */
  patches?: Readonly<Record<string, PatchSpec>>;
  messages?: Partial<Planting3dMessages>;
}

export interface Planting3dRuntime {
  layout: LayoutSource | null;
  patches: Readonly<Record<string, PatchSpec>>;
  messages: Planting3dMessages;
}

const KEY = Symbol.for('ecomkit.planting-3d.runtime');
type Holder = { [KEY]?: Planting3dRuntime };

export function configurePlanting3d(input: Planting3dRuntimeInput): void {
  (globalThis as Holder)[KEY] = { layout: input.layout ?? null, patches: input.patches ?? {}, messages: { ...planting3dMessages, ...input.messages } };
}

export function planting3dRuntime(): Planting3dRuntime {
  return (globalThis as Holder)[KEY] ?? { layout: null, patches: {}, messages: planting3dMessages };
}
