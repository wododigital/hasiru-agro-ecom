// Admin list query for /admin/inventory (DataTable: q, filters, sort and page all from the URL).
import { db } from '@ecomkit/core/db';
import { and, asc, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { inventoryLevel } from '../schema';
import { fallbackThreshold, toView, type LevelView } from './stock';

export const LEVEL_FILTERS = {
  source: ['manual', 'erp', 'seed'],
  state: ['in_stock', 'low', 'preorder', 'out_of_stock'],
} as const;
export const LEVEL_SORTS = ['sku', 'available', 'updated'] as const;

export interface LevelListParams {
  q: string;
  filters: Record<string, string>;
  sort: string | null;
  dir: 'asc' | 'desc';
  page: number;
}
export type LevelListRow = LevelView;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listLevels(params: LevelListParams, pageSize = 50): Promise<{ rows: LevelListRow[]; total: number }> {
  const fallback = await fallbackThreshold();
  const avail = sql`greatest(${inventoryLevel.onHand} - ${inventoryLevel.reserved}, 0)`;
  const threshold = sql`coalesce(${inventoryLevel.lowStockThreshold}, ${fallback})`;
  const where: SQL[] = [];
  const q = params.q.trim();
  if (q) {
    where.push(
      UUID_RE.test(q)
        ? or(eq(inventoryLevel.variantId, q), eq(inventoryLevel.productId, q))!
        : ilike(inventoryLevel.sku, `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`),
    );
  }
  const source = params.filters.source;
  if (source === 'manual' || source === 'erp' || source === 'seed') where.push(eq(inventoryLevel.source, source));
  switch (params.filters.state) {
    case 'in_stock':
      where.push(sql`${avail} > 0`);
      break;
    case 'low':
      where.push(sql`${avail} > 0 and ${avail} <= ${threshold}`);
      break;
    case 'preorder':
      where.push(sql`${avail} = 0 and ${inventoryLevel.readyInDays} is not null`);
      break;
    case 'out_of_stock':
      where.push(sql`${avail} = 0 and ${inventoryLevel.readyInDays} is null`);
      break;
  }
  const cond = where.length ? and(...where) : undefined;
  const dir = params.dir === 'desc' ? desc : asc;
  const order = params.sort === 'available' ? dir(avail) : params.sort === 'updated' ? dir(inventoryLevel.updatedAt) : dir(inventoryLevel.sku);
  const page = Math.max(1, params.page);

  const [rows, [count]] = await Promise.all([
    db
      .select()
      .from(inventoryLevel)
      .where(cond)
      .orderBy(order, asc(inventoryLevel.variantId))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ n: sql<number>`count(*)::int` }).from(inventoryLevel).where(cond),
  ]);
  return {
    total: count?.n ?? 0,
    rows: rows.map((r) => toView(r, fallback)),
  };
}
