-- Test-only stand-in for the catalog, pricing and inventory tables search reads (BUILD-PLAN section 3
-- column names, only the columns search touches). The real tables come from @ecomkit/catalog et al.
CREATE TABLE IF NOT EXISTS catalog_product (
  id uuid PRIMARY KEY,
  kind text NOT NULL,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  name_kn text,
  scientific_name text,
  collection_id uuid,
  subcategory text,
  size_class text,
  propagation text,
  nitrogen_fixer boolean,
  drought_tolerance text,
  water_need text,
  exposure text,
  temp_min numeric,
  temp_max numeric,
  rainfall_min int,
  rainfall_max int,
  bearing_years_min numeric,
  spacing_ft jsonb,
  status text NOT NULL DEFAULT 'active',
  availability_override text,
  is_featured boolean NOT NULL DEFAULT false,
  is_best_seller boolean NOT NULL DEFAULT false,
  search_aliases text[] NOT NULL DEFAULT '{}',
  published_at timestamptz,
  deleted_at timestamptz
);
CREATE TABLE IF NOT EXISTS catalog_collection (id uuid PRIMARY KEY, slug text NOT NULL UNIQUE, name text NOT NULL, parent_id uuid, position int NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS catalog_tag (id uuid PRIMARY KEY, slug text NOT NULL UNIQUE, name text NOT NULL, kind text NOT NULL);
CREATE TABLE IF NOT EXISTS catalog_product_tag (product_id uuid NOT NULL, tag_id uuid NOT NULL, PRIMARY KEY (product_id, tag_id));
CREATE TABLE IF NOT EXISTS catalog_variant (id uuid PRIMARY KEY, product_id uuid NOT NULL, label text NOT NULL, is_default boolean NOT NULL DEFAULT false, position int NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS pricing_price (variant_id uuid PRIMARY KEY, price_paise int NOT NULL);
CREATE TABLE IF NOT EXISTS inventory_level (variant_id uuid PRIMARY KEY, on_hand int NOT NULL, reserved int NOT NULL DEFAULT 0);
