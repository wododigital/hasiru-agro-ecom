import { audit } from '@ecomkit/core/audit';
import { tags } from '@ecomkit/core/cache-tags';
import { db, withTx } from '@ecomkit/core/db';
import { newId } from '@ecomkit/core/ids';
import { asc, count, eq } from 'drizzle-orm';
import { isExternalHref, menuTree, type MenuInput, type MenuNode } from '../domain';
import { cmsMenu, cmsMenuItem } from '../schema';
import { cacheFor, expireTags } from '@ecomkit/core/cache-tags';

export const menuTag = (key: string) => tags.cms(`menu_${key}`);

/** A menu as a two-level tree (empty when the menu does not exist). */
export async function getMenu(key: string): Promise<MenuNode[]> {
  'use cache';
  cacheFor([tags.nav, menuTag(key)]);
  const rows = await db.select().from(cmsMenuItem).where(eq(cmsMenuItem.menuKey, key)).orderBy(asc(cmsMenuItem.position));
  return menuTree(rows);
}

export async function listMenus(): Promise<{ key: string; label: string; items: number }[]> {
  const menus = await db.select().from(cmsMenu).orderBy(asc(cmsMenu.key));
  const counts = await db.select({ key: cmsMenuItem.menuKey, n: count() }).from(cmsMenuItem).groupBy(cmsMenuItem.menuKey);
  const byKey = new Map(counts.map((c) => [c.key, c.n]));
  return menus.map((m) => ({ key: m.key, label: m.label, items: byKey.get(m.key) ?? 0 }));
}

/** The editor's shape: `{ label, href, external, children }` rows. */
export async function getMenuForEdit(key: string): Promise<{ key: string; label: string; items: MenuInput } | null> {
  const [menu] = await db.select().from(cmsMenu).where(eq(cmsMenu.key, key)).limit(1);
  if (!menu) return null;
  const tree = await getMenuUncached(key);
  return {
    key: menu.key,
    label: menu.label,
    items: tree.map((n) => ({ label: n.label, href: n.href, external: n.isExternal, children: n.children.map((c) => ({ label: c.label, href: c.href, external: c.isExternal })) })),
  };
}

async function getMenuUncached(key: string): Promise<MenuNode[]> {
  return menuTree(await db.select().from(cmsMenuItem).where(eq(cmsMenuItem.menuKey, key)));
}

/** Replaces a menu's items (creating the menu when new) in one transaction. */
export async function saveMenu(key: string, label: string, items: MenuInput, actorId: string | null): Promise<void> {
  await withTx(async (tx) => {
    await tx.insert(cmsMenu).values({ key, label }).onConflictDoUpdate({ target: cmsMenu.key, set: { label, updatedAt: new Date() } });
    await tx.delete(cmsMenuItem).where(eq(cmsMenuItem.menuKey, key));
    const rows = items.flatMap((item, i) => {
      const id = newId();
      return [
        { id, menuKey: key, parentId: null, label: item.label, href: item.href, position: i, isExternal: item.external ?? isExternalHref(item.href) },
        ...item.children.map((c, j) => ({ id: newId(), menuKey: key, parentId: id, label: c.label, href: c.href, position: j, isExternal: c.external ?? isExternalHref(c.href) })),
      ];
    });
    // Parents first: children reference them.
    if (rows.length) await tx.insert(cmsMenuItem).values(rows);
    await audit({ actorId, actorType: actorId ? 'staff' : 'system', action: 'menu.update', entity: 'cms_menu', entityId: key, after: items }, { tx });
  });
  await expireTags([tags.nav, menuTag(key)]);
}

export async function deleteMenu(key: string, actorId: string | null): Promise<void> {
  await db.delete(cmsMenu).where(eq(cmsMenu.key, key));
  await audit({ actorId, actorType: actorId ? 'staff' : 'system', action: 'menu.delete', entity: 'cms_menu', entityId: key });
  await expireTags([tags.nav, menuTag(key)]);
}
