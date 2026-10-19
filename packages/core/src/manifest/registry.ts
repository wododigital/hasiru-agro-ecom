import type {
  AdminNavItem,
  EventHandler,
  EventName,
  JobDef,
  Lazy,
  ModuleId,
  ModuleManifest,
  ModuleSettings,
  Permission,
  ScheduleDef,
  ServiceKey,
  ServiceMap,
} from '../contracts';
import { resolveModules } from './resolve';

type WithModule<T> = T & { readonly moduleId: ModuleId };
type ListKey =
  | 'productFormTabs'
  | 'cartBlocks'
  | 'pdpSections'
  | 'productCardChips'
  | 'checkoutSections'
  | 'dashboardWidgets'
  | 'reports'
  | 'healthChecks'
  | 'sitemapSources'
  | 'seedHooks';
type ListItem<K extends ListKey> = NonNullable<ModuleManifest[K]>[number];

export interface Registry {
  readonly mocks: boolean;
  /** Enabled manifests in dependency order. */
  readonly modules: readonly ModuleManifest[];
  has(id: ModuleId): boolean;
  get(id: ModuleId): ModuleManifest | undefined;
  /** Sorted by order, then label. */
  readonly nav: readonly WithModule<AdminNavItem>[];
  readonly settings: readonly { moduleId: ModuleId; settings: ModuleSettings }[];
  readonly permissions: readonly Permission[];
  readonly jobs: readonly { name: string; moduleId: ModuleId; def: JobDef<never> }[];
  readonly schedules: readonly WithModule<ScheduleDef>[];
  /** Extension points sorted by `order` (seed hooks keep module dependency order first). */
  list<K extends ListKey>(key: K): readonly WithModule<ListItem<K>>[];
  subscribers<E extends EventName>(event: E): readonly { moduleId: ModuleId; handler: Lazy<EventHandler<E>> }[];
  /** Null when no enabled module provides the service: optional features render nothing. */
  service<K extends ServiceKey>(key: K): Promise<ServiceMap[K] | null>;
}

export function createRegistry(modules: readonly ModuleManifest[], options: { mocks: boolean }): Registry {
  const ordered = resolveModules(modules, modules.map((m) => m.id));
  const byId = new Map(ordered.map((m) => [m.id, m]));
  const tag = <T extends object>(moduleId: ModuleId, item: T): WithModule<T> => ({ ...item, moduleId });

  const nav = ordered
    .flatMap((m) => (m.admin?.nav ?? []).map((n) => tag(m.id, n)))
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));

  const lists = new Map<ListKey, readonly WithModule<{ order?: number }>[]>();
  const list = <K extends ListKey>(key: K): readonly WithModule<ListItem<K>>[] => {
    let cached = lists.get(key);
    if (!cached) {
      const items = ordered.flatMap((m, moduleIndex) =>
        ((m[key] ?? []) as readonly { order?: number }[]).map((item) => ({ item: tag(m.id, item), moduleIndex })),
      );
      if (key === 'seedHooks') items.sort((a, b) => a.moduleIndex - b.moduleIndex || (a.item.order ?? 0) - (b.item.order ?? 0));
      else items.sort((a, b) => (a.item.order ?? 0) - (b.item.order ?? 0) || a.moduleIndex - b.moduleIndex);
      cached = items.map((x) => x.item);
      lists.set(key, cached);
    }
    return cached as readonly WithModule<ListItem<K>>[];
  };

  const services = new Map<ServiceKey, Promise<unknown>>();

  return {
    mocks: options.mocks,
    modules: ordered,
    has: (id) => byId.has(id),
    get: (id) => byId.get(id),
    nav,
    settings: ordered.flatMap((m) => (m.settings ? [{ moduleId: m.id, settings: m.settings }] : [])),
    permissions: [...new Set(ordered.flatMap((m) => m.permissions ?? []))],
    jobs: ordered.flatMap((m) => Object.entries(m.jobs ?? {}).map(([name, def]) => ({ name, moduleId: m.id, def }))),
    schedules: ordered.flatMap((m) => (m.schedules ?? []).map((s) => tag(m.id, s))),
    list,
    subscribers: (event) =>
      ordered.flatMap((m) => {
        const handler = m.on?.[event];
        return handler ? [{ moduleId: m.id, handler }] : [];
      }),
    service: async (key) => {
      let pending = services.get(key);
      if (!pending) {
        const provider = ordered.find((m) => m.provides?.[key])?.provides?.[key];
        pending = provider ? provider() : Promise.resolve(null);
        services.set(key, pending);
      }
      return (await pending) as never;
    },
  };
}
