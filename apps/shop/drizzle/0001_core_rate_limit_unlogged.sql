-- Hand-written (Drizzle cannot express UNLOGGED). The rate limiter is a hot atomic upsert whose rows are
-- disposable; UNLOGGED skips WAL for it. Idempotent: ALTER ... SET UNLOGGED on an already-unlogged table is a no-op.
ALTER TABLE "core_rate_limit" SET UNLOGGED;
