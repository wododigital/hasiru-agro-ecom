-- Search over catalog_product: one immutable haystack function + one trgm GIN expression index.
-- Hand-written (Drizzle cannot express it). The orchestrator copies this into a
-- `drizzle-kit generate --custom --name search_trgm` migration after catalog_product exists.
-- Idempotent. Needs pg_trgm (the template database has it).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION search_haystack(name text, name_kn text, scientific_name text, aliases text[])
RETURNS text
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
AS $$
  SELECT lower(concat_ws(' ', name, name_kn, scientific_name, array_to_string(aliases, ' ')))
$$;

CREATE INDEX IF NOT EXISTS search_catalog_product_haystack_trgm
  ON catalog_product USING gin (search_haystack(name, name_kn, scientific_name, search_aliases) gin_trgm_ops);
