-- Five generic products with one default variant, a price and stock each. Idempotent (safe to rerun).
-- Run: psql "$DATABASE_URL" -f seed/seed.sql
BEGIN;
INSERT INTO catalog_collection (id, slug, name, kind, position)
VALUES (gen_random_uuid(), 'all', 'All products', 'plant', 0)
ON CONFLICT (slug) DO NOTHING;

WITH items(sku, slug, name, price) AS (VALUES
  ('MIN-001', 'canvas-tote',   'Canvas Tote',   49900),
  ('MIN-002', 'steel-bottle',  'Steel Bottle',  79900),
  ('MIN-003', 'notebook-set',  'Notebook Set',  29900),
  ('MIN-004', 'desk-lamp',     'Desk Lamp',    129900),
  ('MIN-005', 'ceramic-mug',   'Ceramic Mug',   34900)
), p AS (
  INSERT INTO catalog_product (id, sku, kind, slug, name, status)
  SELECT gen_random_uuid(), sku, 'plant', slug, name, 'active' FROM items
  ON CONFLICT (slug) DO NOTHING RETURNING id, slug
), v AS (
  INSERT INTO catalog_variant (id, product_id, label, is_default, sku_suffix)
  SELECT gen_random_uuid(), p.id, 'Standard', true, 'STD' FROM p
  RETURNING id, product_id
), pr AS (
  INSERT INTO pricing_price (variant_id, product_id, price_paise)
  SELECT v.id, v.product_id, i.price FROM v JOIN p ON p.id = v.product_id JOIN items i ON i.slug = p.slug
  RETURNING variant_id
), inv AS (
  INSERT INTO inventory_level (variant_id, product_id, on_hand)
  SELECT v.id, v.product_id, 100 FROM v
  RETURNING variant_id
)
INSERT INTO catalog_product_collection (product_id, collection_id)
SELECT p.id, (SELECT id FROM catalog_collection WHERE slug = 'all') FROM p
ON CONFLICT DO NOTHING;
COMMIT;
