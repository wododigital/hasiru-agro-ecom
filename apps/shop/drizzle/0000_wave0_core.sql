CREATE TYPE "public"."core_actor_type" AS ENUM('staff', 'customer', 'system');--> statement-breakpoint
CREATE TYPE "public"."core_error_level" AS ENUM('error', 'warning');--> statement-breakpoint
CREATE TYPE "public"."core_integration_status" AS ENUM('ok', 'failed', 'skipped_not_configured');--> statement-breakpoint
CREATE TYPE "public"."core_issue_status" AS ENUM('open', 'resolved', 'ignored');--> statement-breakpoint
CREATE TABLE "core_audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid,
	"actor_type" "core_actor_type" NOT NULL,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core_error_event" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"issue_id" uuid NOT NULL,
	"message" text NOT NULL,
	"stack" text,
	"route" text,
	"method" text,
	"url" text,
	"request_id" text,
	"viewer_role" text,
	"release" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core_error_issue" (
	"id" uuid PRIMARY KEY NOT NULL,
	"fingerprint" text NOT NULL,
	"title" text NOT NULL,
	"level" "core_error_level" DEFAULT 'error' NOT NULL,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"status" "core_issue_status" DEFAULT 'open' NOT NULL,
	"release" text,
	CONSTRAINT "core_error_issue_fingerprint_unique" UNIQUE("fingerprint")
);
--> statement-breakpoint
CREATE TABLE "core_integration_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"op" text NOT NULL,
	"status" "core_integration_status" NOT NULL,
	"duration_ms" integer NOT NULL,
	"http_status" integer,
	"error" text,
	"ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core_job_heartbeat" (
	"worker" text PRIMARY KEY NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"queues" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core_rate_limit" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"window_start" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core_sequence" (
	"name" text PRIMARY KEY NOT NULL,
	"value" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core_settings" (
	"module" text NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"is_secret" boolean DEFAULT false NOT NULL,
	"key_version" integer,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "core_settings_module_key_pk" PRIMARY KEY("module","key")
);
--> statement-breakpoint
ALTER TABLE "core_error_event" ADD CONSTRAINT "core_error_event_issue_id_core_error_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."core_error_issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "core_audit_log_entity_idx" ON "core_audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "core_audit_log_actor_idx" ON "core_audit_log" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "core_audit_log_list_idx" ON "core_audit_log" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "core_error_event_issue_idx" ON "core_error_event" USING btree ("issue_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "core_error_event_created_idx" ON "core_error_event" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "core_error_issue_list_idx" ON "core_error_issue" USING btree ("status","last_seen" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "core_integration_log_provider_idx" ON "core_integration_log" USING btree ("provider","created_at" DESC NULLS LAST);