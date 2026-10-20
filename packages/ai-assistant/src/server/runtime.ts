import type { ModuleId, ServiceKey, ServiceMap } from '@ecomkit/core/contracts';
import { mergeAssistantMessages, type AssistantMessages, type AssistantMessagesOverride } from '../messages';

/** The part of the app registry the assistant reads. */
export interface AssistantRegistry {
  has(id: ModuleId): boolean;
  service<K extends ServiceKey>(key: K): Promise<ServiceMap[K] | null>;
}

/** Companion suggestions for products a visitor already grows (planting provides these; catalog relations are the default). */
export type CompanionSource = (productIds: readonly string[]) => Promise<Record<string, readonly string[]>>;

export interface AssistantRuntimeInput {
  registry?: AssistantRegistry | null;
  /** Overrides the default companions (catalog `companion` relations), e.g. planting's model-role companions. */
  companions?: CompanionSource | null;
  /** One or two sentences about the store, appended to the system prompt (what it sells, where it delivers). */
  storeContext?: string | null;
  messages?: AssistantMessagesOverride;
  /** The visitor's district slug; default reads the `district` cookie (the one places and catalog use). */
  readDistrict?: (() => Promise<string | null>) | null;
  /** HTTP transport for the model client (tests route it to the mock handler). Default: safeFetch (live) or fetch (mock). */
  transport?: typeof fetch | null;
}

export interface AssistantRuntime {
  registry: AssistantRegistry | null;
  companions: CompanionSource | null;
  storeContext: string | null;
  messages: AssistantMessages;
  readDistrict: () => Promise<string | null>;
  transport: typeof fetch | null;
}

async function districtFromCookie(): Promise<string | null> {
  try {
    const { cookies } = await import('next/headers');
    const v = (await cookies()).get('district')?.value ?? null;
    return v && /^[a-z0-9-]{2,60}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

const KEY = Symbol.for('ecomkit.ai-assistant.runtime');
type Holder = { [KEY]?: AssistantRuntime };

function build(input: AssistantRuntimeInput): AssistantRuntime {
  return {
    registry: input.registry ?? null,
    companions: input.companions ?? null,
    storeContext: input.storeContext ?? null,
    messages: mergeAssistantMessages(input.messages),
    readDistrict: input.readDistrict ?? districtFromCookie,
    transport: input.transport ?? null,
  };
}

/** Binds the host's capabilities once at boot (instrumentation and worker). Kept on globalThis so every bundle sees it. */
export function configureAssistant(input: AssistantRuntimeInput): void {
  (globalThis as Holder)[KEY] = build(input);
}

export function assistantRuntime(): AssistantRuntime {
  return ((globalThis as Holder)[KEY] ??= build({}));
}

export async function optionalService<K extends ServiceKey>(key: K): Promise<ServiceMap[K] | null> {
  const r = assistantRuntime().registry;
  return r ? r.service(key) : null;
}
