import type { Role } from '@ecomkit/core/contracts';

/** Role colours from the semantic tokens (`--color-role-main/host/biomass`). */
export const ROLE_FILL: Record<Role, string> = { M: 'fill-role-main', X: 'fill-role-host', O: 'fill-role-biomass' };
export const ROLE_BG: Record<Role, string> = { M: 'bg-role-main', X: 'bg-role-host', O: 'bg-role-biomass' };
