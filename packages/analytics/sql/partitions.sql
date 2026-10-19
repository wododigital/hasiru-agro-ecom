-- analytics_event as a monthly range-partitioned table (on server_ts, UTC months).
-- Goes into a `drizzle-kit generate --custom --name analytics_event_partitions` migration placed after the migration
-- that creates the analytics tables. Idempotent: safe to run again.
-- 1. If analytics_event exists as a plain table (what the generated migration creates), it must be empty; it is
--    dropped and recreated as the partitioned parent with the same columns, keys and index names as src/schema.ts.
-- 2. Creates the partitions for the current month and the next two, and a DEFAULT partition.
-- The analytics.create-partition job (25th of each month) keeps month+2 ahead and drops months past retention.
DO $$
DECLARE
  kind "char";
  m date;
  i int;
BEGIN
  SELECT c.relkind INTO kind FROM pg_class c WHERE c.oid = to_regclass('analytics_event');

  IF kind = 'r' THEN
    IF EXISTS (SELECT 1 FROM analytics_event LIMIT 1) THEN
      RAISE EXCEPTION 'analytics_event has rows and is not partitioned; move them out before running this';
    END IF;
    DROP TABLE analytics_event;
    kind := NULL;
  END IF;

  IF kind IS NULL THEN
    CREATE TABLE analytics_event (
      id bigserial NOT NULL,
      client_event_id uuid NOT NULL,
      session_id uuid NOT NULL,
      visitor_id uuid NOT NULL,
      name text NOT NULL,
      path text NOT NULL,
      props jsonb NOT NULL DEFAULT '{}'::jsonb,
      client_ts timestamptz,
      server_ts timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT analytics_event_pkey PRIMARY KEY (id, server_ts),
      CONSTRAINT analytics_event_client_event_uq UNIQUE (client_event_id, server_ts)
    ) PARTITION BY RANGE (server_ts);
    CREATE INDEX analytics_event_session_idx ON analytics_event (session_id, server_ts);
    CREATE INDEX analytics_event_name_idx ON analytics_event (name, server_ts);
  END IF;

  FOR i IN 0..2 LOOP
    m := (date_trunc('month', now() AT TIME ZONE 'UTC') + make_interval(months => i))::date;
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF analytics_event FOR VALUES FROM (%L) TO (%L)',
      'analytics_event_' || to_char(m, 'YYYY_MM'),
      m::text || ' 00:00:00+00',
      (m + interval '1 month')::date::text || ' 00:00:00+00'
    );
  END LOOP;

  CREATE TABLE IF NOT EXISTS analytics_event_default PARTITION OF analytics_event DEFAULT;
END
$$;
