import type { AppConfig, ModuleManifest } from '../contracts';

/** Identity helper that keeps literal types; validation happens in `resolveModules`. */
export function defineModule<const M extends ModuleManifest>(manifest: M): M {
  return manifest;
}

export function defineAppConfig<const C extends AppConfig>(config: C): C {
  return config;
}
