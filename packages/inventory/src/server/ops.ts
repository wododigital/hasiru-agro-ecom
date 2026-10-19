import type { InventoryOps } from '@ecomkit/core/contracts';
import { commit, getStock, getStocks, release, reserve } from './stock';

/** The `inventory` service (inventory-ops contract), provided through the manifest. */
export const inventoryOps: InventoryOps = { getStock, getStocks, reserve, commit, release };
