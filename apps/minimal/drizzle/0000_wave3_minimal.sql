CREATE TYPE "public"."core_actor_type" AS ENUM('staff', 'customer', 'system');--> statement-breakpoint
CREATE TYPE "public"."core_error_level" AS ENUM('error', 'warning');--> statement-breakpoint
CREATE TYPE "public"."core_integration_status" AS ENUM('ok', 'failed', 'skipped_not_configured');--> statement-breakpoint
CREATE TYPE "public"."core_issue_status" AS ENUM('open', 'resolved', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."media_format" AS ENUM('avif', 'webp', 'jpeg');--> statement-breakpoint
CREATE TYPE "public"."media_kind" AS ENUM('image', 'video', 'document');--> statement-breakpoint
CREATE TYPE "public"."media_source" AS ENUM('upload', 'woo_import', 'site_import', 'stock', 'wikimedia', 'client');--> statement-breakpoint
CREATE TYPE "public"."media_status" AS ENUM('ready', 'processing', 'failed');--> statement-breakpoint
CREATE TYPE "public"."catalog_availability_override" AS ENUM('available', 'out_of_stock', 'temporarily_unavailable', 'coming_soon', 'hidden');--> statement-breakpoint
CREATE TYPE "public"."catalog_canopy" AS ENUM('large_tree', 'medium_tree', 'small_tree', 'shrub', 'climber');--> statement-breakpoint
CREATE TYPE "public"."catalog_exposure" AS ENUM('full_sun', 'partial_shade', 'shade');--> statement-breakpoint
CREATE TYPE "public"."catalog_faq_status" AS ENUM('answered', 'ai_draft', 'client_only', 'published');--> statement-breakpoint
CREATE TYPE "public"."catalog_kind" AS ENUM('plant', 'input');--> statement-breakpoint
CREATE TYPE "public"."catalog_level" AS ENUM('low', 'moderate', 'high');--> statement-breakpoint
CREATE TYPE "public"."catalog_media_role" AS ENUM('main', 'gallery', 'fruit', 'plant', 'as_delivered', 'video_poster');--> statement-breakpoint
CREATE TYPE "public"."catalog_propagation" AS ENUM('seeded', 'grafted', 'air_layered', 'cuttings', 'suckers', 'tissue_culture', 'other');--> statement-breakpoint
CREATE TYPE "public"."catalog_relation" AS ENUM('companion', 'alternative', 'input_for');--> statement-breakpoint
CREATE TYPE "public"."catalog_size_class" AS ENUM('L', 'M', 'S');--> statement-breakpoint
CREATE TYPE "public"."catalog_status" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."catalog_tag_kind" AS ENUM('trait', 'use', 'filter');--> statement-breakpoint
CREATE TYPE "public"."catalog_water_need" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."inventory_movement_reason" AS ENUM('order', 'cancel', 'adjust', 'erp_sync', 'seed');--> statement-breakpoint
CREATE TYPE "public"."inventory_reservation_status" AS ENUM('held', 'committed', 'released');--> statement-breakpoint
CREATE TYPE "public"."inventory_source" AS ENUM('manual', 'erp', 'seed');--> statement-breakpoint
CREATE TYPE "public"."cart_line_kind" AS ENUM('product', 'package');--> statement-breakpoint
CREATE TYPE "public"."cart_status" AS ENUM('active', 'abandoned', 'converted', 'merged');--> statement-breakpoint
CREATE TYPE "public"."customers_consent_purpose" AS ENUM('order_updates', 'marketing', 'analytics_identity');--> statement-breakpoint
CREATE TYPE "public"."customers_consent_status" AS ENUM('granted', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."customers_lead_source" AS ENUM('wizard', 'notify_me', 'enquiry', 'chat', 'checkout');--> statement-breakpoint
CREATE TYPE "public"."customers_lead_status" AS ENUM('new', 'contacted', 'converted', 'closed');--> statement-breakpoint
CREATE TYPE "public"."customers_type" AS ENUM('farmer', 'business', 'individual');--> statement-breakpoint
CREATE TYPE "public"."orders_invoice_kind" AS ENUM('b2c', 'b2b');--> statement-breakpoint
CREATE TYPE "public"."orders_line_kind" AS ENUM('product', 'package');--> statement-breakpoint
CREATE TYPE "public"."orders_payment_mode" AS ENUM('online', 'partial_advance', 'pay_at_nursery', 'offline', 'none');--> statement-breakpoint
CREATE TYPE "public"."orders_payment_status" AS ENUM('unpaid', 'partially_paid', 'paid', 'refunded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."orders_source" AS ENUM('web', 'manual', 'wizard', 'replacement');--> statement-breakpoint
CREATE TYPE "public"."orders_status" AS ENUM('pending_payment', 'paid', 'confirmed', 'packed', 'dispatched', 'delivered', 'cancelled', 'refunded', 'partially_refunded');--> statement-breakpoint
CREATE TYPE "public"."payments_attempt_state" AS ENUM('pending', 'completed', 'failed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."payments_method" AS ENUM('online', 'cod_partial', 'bank_transfer');--> statement-breakpoint
CREATE TYPE "public"."payments_provider" AS ENUM('phonepe', 'mock', 'bank_transfer');--> statement-breakpoint
CREATE TYPE "public"."payments_refund_state" AS ENUM('task', 'pending', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."seo_redirect_source" AS ENUM('manual', 'slug_change', 'legacy_import', 'not_found_fix');--> statement-breakpoint
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
CREATE TABLE "auth_account" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_role_permission" (
	"role" text NOT NULL,
	"permission" text NOT NULL,
	CONSTRAINT "auth_role_permission_role_permission_pk" PRIMARY KEY("role","permission")
);
--> statement-breakpoint
CREATE TABLE "auth_session" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"impersonated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "auth_two_factor" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"verified" boolean DEFAULT true,
	"failed_verification_count" integer DEFAULT 0,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "auth_user" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"phone_number" text,
	"phone_number_verified" boolean,
	"role" text DEFAULT 'customer' NOT NULL,
	"banned" boolean DEFAULT false,
	"ban_reason" text,
	"ban_expires" timestamp with time zone,
	"two_factor_enabled" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_user_email_unique" UNIQUE("email"),
	CONSTRAINT "auth_user_phone_number_unique" UNIQUE("phone_number")
);
--> statement-breakpoint
CREATE TABLE "auth_verification" (
	"id" uuid PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_asset" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" "media_kind" NOT NULL,
	"storage_key" text NOT NULL,
	"original_name" text NOT NULL,
	"mime" text NOT NULL,
	"width" integer,
	"height" integer,
	"bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"blur_data_url" text,
	"alt" text DEFAULT '' NOT NULL,
	"caption" text,
	"source" "media_source" DEFAULT 'upload' NOT NULL,
	"licence" text,
	"author" text,
	"source_url" text,
	"credit_required" boolean DEFAULT false NOT NULL,
	"is_private" boolean DEFAULT false NOT NULL,
	"status" "media_status" DEFAULT 'processing' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_asset_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "media_asset_sha256_unique" UNIQUE("sha256")
);
--> statement-breakpoint
CREATE TABLE "media_derivative" (
	"asset_id" uuid NOT NULL,
	"format" "media_format" NOT NULL,
	"width" integer NOT NULL,
	"storage_key" text NOT NULL,
	"bytes" integer NOT NULL,
	CONSTRAINT "media_derivative_asset_id_format_width_pk" PRIMARY KEY("asset_id","format","width")
);
--> statement-breakpoint
CREATE TABLE "media_usage" (
	"asset_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	CONSTRAINT "media_usage_asset_id_entity_entity_id_pk" PRIMARY KEY("asset_id","entity","entity_id")
);
--> statement-breakpoint
CREATE TABLE "catalog_collection" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"name_kn" text,
	"kind" "catalog_kind" NOT NULL,
	"parent_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"description_html" text,
	"intro_html" text,
	"seo_title" text,
	"seo_description" text,
	"hero_media_id" uuid,
	"is_indexable" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_collection_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "catalog_faq" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text,
	"product_id" uuid,
	"question" text NOT NULL,
	"answer_html" text,
	"status" "catalog_faq_status" DEFAULT 'answered' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_faq_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "catalog_product" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sku" text NOT NULL,
	"legacy_sku" text,
	"legacy_woo_id" integer,
	"erp_item_id" text,
	"kind" "catalog_kind" NOT NULL,
	"slug" text NOT NULL,
	"previous_slugs" text[] DEFAULT '{}'::text[] NOT NULL,
	"name" text NOT NULL,
	"name_kn" text,
	"scientific_name" text,
	"base_name" text,
	"variety" text,
	"collection_id" uuid,
	"subcategory" text,
	"size_class" "catalog_size_class",
	"canopy" "catalog_canopy",
	"propagation" "catalog_propagation",
	"nitrogen_fixer" boolean DEFAULT false NOT NULL,
	"drought_tolerance" "catalog_level",
	"water_need" "catalog_water_need",
	"exposure" "catalog_exposure",
	"temp_min" numeric,
	"temp_opt" numeric,
	"temp_max" numeric,
	"humidity_min" numeric,
	"humidity_opt" numeric,
	"humidity_max" numeric,
	"rainfall_min" integer,
	"rainfall_max" integer,
	"soil_tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"mature_height_min_ft" numeric,
	"mature_height_max_ft" numeric,
	"bearing_years_min" numeric,
	"bearing_years_max" numeric,
	"timber_rotation_years" numeric,
	"yield_text" text,
	"harvest_season" text,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"spacing_ft" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"compost_kg" jsonb,
	"input_type" text,
	"pack_size" text,
	"dosage_rules" jsonb,
	"short_description" text,
	"description_html" text,
	"care_html" text,
	"status" "catalog_status" DEFAULT 'draft' NOT NULL,
	"availability_override" "catalog_availability_override",
	"is_featured" boolean DEFAULT false NOT NULL,
	"is_best_seller" boolean DEFAULT false NOT NULL,
	"weight_kg" numeric,
	"packing_fee_paise" integer,
	"hsn" text,
	"gst_rate" numeric,
	"tax_class" text,
	"bag_size" text,
	"height_at_dispatch_ft" numeric,
	"seo_title" text,
	"seo_description" text,
	"focus_keyword" text,
	"noindex" boolean DEFAULT false NOT NULL,
	"og_media_id" uuid,
	"data_source" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"review_notes" text[] DEFAULT '{}'::text[] NOT NULL,
	"image_needed" boolean DEFAULT false NOT NULL,
	"search_aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "catalog_product_sku_unique" UNIQUE("sku"),
	CONSTRAINT "catalog_product_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "catalog_product_collection" (
	"product_id" uuid NOT NULL,
	"collection_id" uuid NOT NULL,
	CONSTRAINT "catalog_product_collection_product_id_collection_id_pk" PRIMARY KEY("product_id","collection_id")
);
--> statement-breakpoint
CREATE TABLE "catalog_product_media" (
	"product_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"role" "catalog_media_role" DEFAULT 'gallery' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "catalog_product_media_product_id_media_id_pk" PRIMARY KEY("product_id","media_id")
);
--> statement-breakpoint
CREATE TABLE "catalog_product_tag" (
	"product_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "catalog_product_tag_product_id_tag_id_pk" PRIMARY KEY("product_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "catalog_related" (
	"product_id" uuid NOT NULL,
	"related_id" uuid NOT NULL,
	"relation" "catalog_relation" NOT NULL,
	CONSTRAINT "catalog_related_product_id_related_id_relation_pk" PRIMARY KEY("product_id","related_id","relation")
);
--> statement-breakpoint
CREATE TABLE "catalog_tag" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"name_kn" text,
	"kind" "catalog_tag_kind" DEFAULT 'filter' NOT NULL,
	"show_on_card" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"intro_html" text,
	CONSTRAINT "catalog_tag_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "catalog_variant" (
	"id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"label" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"sku_suffix" text NOT NULL,
	"height_ft" numeric,
	"bag_size" text,
	"weight_kg" numeric,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pricing_price" (
	"variant_id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"price_paise" integer NOT NULL,
	"compare_at_paise" integer,
	"offline_price_paise" integer,
	"cost_paise" integer,
	"currency" char(3) DEFAULT 'INR' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pricing_price_amounts_ck" CHECK ("pricing_price"."price_paise" >= 0 and coalesce("pricing_price"."offline_price_paise", 0) >= 0 and coalesce("pricing_price"."cost_paise", 0) >= 0),
	CONSTRAINT "pricing_price_compare_at_ck" CHECK ("pricing_price"."compare_at_paise" is null or "pricing_price"."compare_at_paise" > "pricing_price"."price_paise")
);
--> statement-breakpoint
CREATE TABLE "pricing_tier" (
	"id" uuid PRIMARY KEY NOT NULL,
	"variant_id" uuid NOT NULL,
	"min_qty" integer NOT NULL,
	"unit_price_paise" integer NOT NULL,
	CONSTRAINT "pricing_tier_variant_min_qty_uq" UNIQUE("variant_id","min_qty"),
	CONSTRAINT "pricing_tier_values_ck" CHECK ("pricing_tier"."min_qty" >= 2 and "pricing_tier"."unit_price_paise" >= 0)
);
--> statement-breakpoint
CREATE TABLE "inventory_level" (
	"variant_id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"sku" text,
	"on_hand" integer DEFAULT 0 NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	"ready_in_days" integer,
	"low_stock_threshold" integer,
	"source" "inventory_source" DEFAULT 'seed' NOT NULL,
	"erp_on_hand" integer,
	"erp_updated_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_level_on_hand_check" CHECK ("inventory_level"."on_hand" >= 0),
	CONSTRAINT "inventory_level_reserved_check" CHECK ("inventory_level"."reserved" >= 0)
);
--> statement-breakpoint
CREATE TABLE "inventory_movement" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"variant_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"reason" "inventory_movement_reason" NOT NULL,
	"ref" text,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_reservation" (
	"id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"reference" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" "inventory_reservation_status" DEFAULT 'held' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_reservation_id_variant_id_pk" PRIMARY KEY("id","variant_id"),
	CONSTRAINT "inventory_reservation_qty_check" CHECK ("inventory_reservation"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "inventory_subscription" (
	"id" uuid PRIMARY KEY NOT NULL,
	"variant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"phone" text,
	"email" text,
	"consent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified_at" timestamp with time zone,
	CONSTRAINT "inventory_subscription_contact_check" CHECK ("inventory_subscription"."phone" is not null or "inventory_subscription"."email" is not null)
);
--> statement-breakpoint
CREATE TABLE "cart_cart" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cookie_token_hash" text NOT NULL,
	"customer_id" uuid,
	"status" "cart_status" DEFAULT 'active' NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"coupon_code" text,
	"delivery_method_snapshot" jsonb,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"abandoned_at" timestamp with time zone,
	"contact_at" timestamp with time zone,
	"converted_order_id" uuid,
	"merged_into_id" uuid,
	"land_sqft" numeric,
	"plan_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cart_cart_cookie_token_hash_unique" UNIQUE("cookie_token_hash")
);
--> statement-breakpoint
CREATE TABLE "cart_line" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cart_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"kind" "cart_line_kind" DEFAULT 'product' NOT NULL,
	"origin" jsonb,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cart_line_qty_check" CHECK ("cart_line"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "customers_address" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"label" text,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"line1" text NOT NULL,
	"line2" text,
	"landmark" text,
	"village_town" text,
	"pincode" text NOT NULL,
	"district_id" uuid,
	"district_text" text NOT NULL,
	"state" text NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers_consent" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"phone_hash" text,
	"email_hash" text,
	"purpose" "customers_consent_purpose" NOT NULL,
	"status" "customers_consent_status" NOT NULL,
	"text_shown" text NOT NULL,
	"source" text NOT NULL,
	"ip_hash" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers_land_profile" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"label" text NOT NULL,
	"sqft" numeric NOT NULL,
	"district_id" uuid,
	"purpose" text,
	"plan_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers_lead" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"name" text NOT NULL,
	"phone_e164" text NOT NULL,
	"phone_hash" text NOT NULL,
	"phone_verified" boolean DEFAULT false NOT NULL,
	"source" "customers_lead_source" NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "customers_lead_status" DEFAULT 'new' NOT NULL,
	"assigned_to" uuid,
	"erp_pushed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers_profile" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"display_name" text,
	"phone_e164" text,
	"phone_hash" text,
	"email" text,
	"email_hash" text,
	"customer_type" "customers_type" DEFAULT 'individual' NOT NULL,
	"gstin" text,
	"legal_name" text,
	"notes" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"first_order_at" timestamp with time zone,
	"last_order_at" timestamp with time zone,
	"orders_count" integer DEFAULT 0 NOT NULL,
	"lifetime_paise" integer DEFAULT 0 NOT NULL,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders_event" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"type" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders_fulfilment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"status" text NOT NULL,
	"dispatched_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"vehicle" text,
	"driver_note" text,
	"tracking_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders_invoice" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"number" text NOT NULL,
	"kind" "orders_invoice_kind" NOT NULL,
	"place_of_supply" text,
	"is_inter_state" boolean NOT NULL,
	"taxable_paise" integer DEFAULT 0 NOT NULL,
	"cgst_paise" integer DEFAULT 0 NOT NULL,
	"sgst_paise" integer DEFAULT 0 NOT NULL,
	"igst_paise" integer DEFAULT 0 NOT NULL,
	"total_paise" integer DEFAULT 0 NOT NULL,
	"document" jsonb NOT NULL,
	"pdf_media_id" uuid,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders_line" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"product_snapshot" jsonb NOT NULL,
	"qty" integer NOT NULL,
	"list_unit_paise" integer DEFAULT 0 NOT NULL,
	"unit_price_paise" integer DEFAULT 0 NOT NULL,
	"tier_applied" boolean DEFAULT false NOT NULL,
	"line_discount_paise" integer DEFAULT 0 NOT NULL,
	"line_tax_paise" integer DEFAULT 0 NOT NULL,
	"line_total_paise" integer DEFAULT 0 NOT NULL,
	"kind" "orders_line_kind" DEFAULT 'product' NOT NULL,
	"origin" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders_order" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"customer_id" uuid,
	"guest_token_hash" text,
	"status" "orders_status" NOT NULL,
	"payment_status" "orders_payment_status" DEFAULT 'unpaid' NOT NULL,
	"payment_mode" "orders_payment_mode" DEFAULT 'online' NOT NULL,
	"contact" jsonb NOT NULL,
	"shipping_address" jsonb,
	"billing" jsonb,
	"delivery" jsonb NOT NULL,
	"subtotal_paise" integer DEFAULT 0 NOT NULL,
	"tier_savings_paise" integer DEFAULT 0 NOT NULL,
	"promo_paise" integer DEFAULT 0 NOT NULL,
	"coupon_paise" integer DEFAULT 0 NOT NULL,
	"packing_paise" integer DEFAULT 0 NOT NULL,
	"shipping_paise" integer DEFAULT 0 NOT NULL,
	"tax_paise" integer DEFAULT 0 NOT NULL,
	"total_paise" integer DEFAULT 0 NOT NULL,
	"paid_paise" integer DEFAULT 0 NOT NULL,
	"refunded_paise" integer DEFAULT 0 NOT NULL,
	"balance_due_paise" integer DEFAULT 0 NOT NULL,
	"advance_paise" integer DEFAULT 0 NOT NULL,
	"totals" jsonb NOT NULL,
	"weight_kg" numeric DEFAULT 0 NOT NULL,
	"is_test" boolean DEFAULT false NOT NULL,
	"source" "orders_source" DEFAULT 'web' NOT NULL,
	"parent_order_id" uuid,
	"plan_id" uuid,
	"reservation_id" text,
	"attribution" jsonb,
	"notes" text,
	"erp_order_ref" text,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checkout_session" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cart_id" uuid NOT NULL,
	"customer_id" uuid,
	"contact" jsonb,
	"address_id" uuid,
	"address_draft" jsonb,
	"method_id" text,
	"slot_date" text,
	"quote" jsonb,
	"idempotency_key" text,
	"order_id" uuid,
	"step" text DEFAULT 'contact' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments_attempt" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"attempt_no" integer NOT NULL,
	"provider" "payments_provider" NOT NULL,
	"method" "payments_method" NOT NULL,
	"merchant_order_id" text NOT NULL,
	"provider_order_id" text,
	"amount_paise" integer NOT NULL,
	"state" "payments_attempt_state" DEFAULT 'pending' NOT NULL,
	"redirect_url" text,
	"raw_create" jsonb,
	"raw_status" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"applied_at" timestamp with time zone,
	"anomaly" text,
	"error" text,
	"next_poll_at" timestamp with time zone,
	"poll_count" integer DEFAULT 0 NOT NULL,
	"swept_at" timestamp with time zone,
	"is_test" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_attempt_merchant_order_id_uq" UNIQUE("merchant_order_id"),
	CONSTRAINT "payments_attempt_order_no_uq" UNIQUE("order_id","attempt_no"),
	CONSTRAINT "payments_attempt_amount_ck" CHECK ("payments_attempt"."amount_paise" > 0)
);
--> statement-breakpoint
CREATE TABLE "payments_refund" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"attempt_id" uuid NOT NULL,
	"merchant_refund_id" text NOT NULL,
	"provider_refund_id" text,
	"amount_paise" integer NOT NULL,
	"state" "payments_refund_state" NOT NULL,
	"reason" text,
	"raw" jsonb,
	"actor_id" uuid,
	"next_poll_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_refund_merchant_refund_id_uq" UNIQUE("merchant_refund_id"),
	CONSTRAINT "payments_refund_amount_ck" CHECK ("payments_refund"."amount_paise" > 0)
);
--> statement-breakpoint
CREATE TABLE "payments_webhook_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"event" text,
	"dedupe_key" text NOT NULL,
	"payload" jsonb,
	"signature_ok" boolean NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_webhook_event_dedupe_uq" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "seo_not_found" (
	"path" text PRIMARY KEY NOT NULL,
	"hits" integer DEFAULT 1 NOT NULL,
	"first_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_at" timestamp with time zone DEFAULT now() NOT NULL,
	"referrers" text[] DEFAULT '{}'::text[] NOT NULL,
	"fixed_redirect_id" uuid
);
--> statement-breakpoint
CREATE TABLE "seo_page_meta" (
	"path" text PRIMARY KEY NOT NULL,
	"title" text,
	"description" text,
	"noindex" boolean DEFAULT false NOT NULL,
	"canonical" text,
	"og_media_id" uuid,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seo_redirect" (
	"id" uuid PRIMARY KEY NOT NULL,
	"from_path" text NOT NULL,
	"to_path" text NOT NULL,
	"status_code" integer DEFAULT 301 NOT NULL,
	"source" "seo_redirect_source" DEFAULT 'manual' NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	"last_hit_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seo_redirect_from_path_unique" UNIQUE("from_path"),
	CONSTRAINT "seo_redirect_status_check" CHECK ("seo_redirect"."status_code" in (301, 302, 307, 308)),
	CONSTRAINT "seo_redirect_not_self" CHECK ("seo_redirect"."from_path" <> "seo_redirect"."to_path")
);
--> statement-breakpoint
ALTER TABLE "core_error_event" ADD CONSTRAINT "core_error_event_issue_id_core_error_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."core_error_issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_account" ADD CONSTRAINT "auth_account_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_two_factor" ADD CONSTRAINT "auth_two_factor_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_derivative" ADD CONSTRAINT "media_derivative_asset_id_media_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_usage" ADD CONSTRAINT "media_usage_asset_id_media_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_collection" ADD CONSTRAINT "catalog_collection_parent_id_catalog_collection_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."catalog_collection"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_faq" ADD CONSTRAINT "catalog_faq_product_id_catalog_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."catalog_product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_product" ADD CONSTRAINT "catalog_product_collection_id_catalog_collection_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."catalog_collection"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_product_collection" ADD CONSTRAINT "catalog_product_collection_product_id_catalog_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."catalog_product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_product_collection" ADD CONSTRAINT "catalog_product_collection_collection_id_catalog_collection_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."catalog_collection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_product_media" ADD CONSTRAINT "catalog_product_media_product_id_catalog_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."catalog_product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_product_tag" ADD CONSTRAINT "catalog_product_tag_product_id_catalog_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."catalog_product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_product_tag" ADD CONSTRAINT "catalog_product_tag_tag_id_catalog_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."catalog_tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_related" ADD CONSTRAINT "catalog_related_product_id_catalog_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."catalog_product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_related" ADD CONSTRAINT "catalog_related_related_id_catalog_product_id_fk" FOREIGN KEY ("related_id") REFERENCES "public"."catalog_product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_variant" ADD CONSTRAINT "catalog_variant_product_id_catalog_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."catalog_product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_tier" ADD CONSTRAINT "pricing_tier_variant_id_pricing_price_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."pricing_price"("variant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_line" ADD CONSTRAINT "cart_line_cart_id_cart_cart_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."cart_cart"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders_event" ADD CONSTRAINT "orders_event_order_id_orders_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders_fulfilment" ADD CONSTRAINT "orders_fulfilment_order_id_orders_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders_invoice" ADD CONSTRAINT "orders_invoice_order_id_orders_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders_line" ADD CONSTRAINT "orders_line_order_id_orders_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders_order" ADD CONSTRAINT "orders_order_parent_order_id_orders_order_id_fk" FOREIGN KEY ("parent_order_id") REFERENCES "public"."orders_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments_refund" ADD CONSTRAINT "payments_refund_attempt_id_payments_attempt_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."payments_attempt"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_not_found" ADD CONSTRAINT "seo_not_found_fixed_redirect_id_seo_redirect_id_fk" FOREIGN KEY ("fixed_redirect_id") REFERENCES "public"."seo_redirect"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "core_audit_log_entity_idx" ON "core_audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "core_audit_log_actor_idx" ON "core_audit_log" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "core_audit_log_list_idx" ON "core_audit_log" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "core_error_event_issue_idx" ON "core_error_event" USING btree ("issue_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "core_error_event_created_idx" ON "core_error_event" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "core_error_issue_list_idx" ON "core_error_issue" USING btree ("status","last_seen" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "core_integration_log_provider_idx" ON "core_integration_log" USING btree ("provider","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "auth_account_user_idx" ON "auth_account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_session_user_idx" ON "auth_session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_two_factor_user_idx" ON "auth_two_factor" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_two_factor_secret_idx" ON "auth_two_factor" USING btree ("secret");--> statement-breakpoint
CREATE INDEX "auth_user_role_idx" ON "auth_user" USING btree ("role");--> statement-breakpoint
CREATE INDEX "auth_user_list_idx" ON "auth_user" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "auth_verification_identifier_idx" ON "auth_verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "media_asset_list_idx" ON "media_asset" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "media_asset_status_idx" ON "media_asset" USING btree ("status");--> statement-breakpoint
CREATE INDEX "media_usage_entity_idx" ON "media_usage" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "catalog_collection_parent_idx" ON "catalog_collection" USING btree ("parent_id","position");--> statement-breakpoint
CREATE INDEX "catalog_faq_product_idx" ON "catalog_faq" USING btree ("product_id","status","position");--> statement-breakpoint
CREATE INDEX "catalog_product_collection_idx" ON "catalog_product" USING btree ("collection_id","status");--> statement-breakpoint
CREATE INDEX "catalog_product_best_idx" ON "catalog_product" USING btree ("status","is_best_seller");--> statement-breakpoint
CREATE INDEX "catalog_product_kind_idx" ON "catalog_product" USING btree ("kind","status");--> statement-breakpoint
CREATE INDEX "catalog_product_aliases_idx" ON "catalog_product" USING gin ("search_aliases");--> statement-breakpoint
CREATE INDEX "catalog_product_prev_slugs_idx" ON "catalog_product" USING gin ("previous_slugs");--> statement-breakpoint
CREATE INDEX "catalog_product_list_idx" ON "catalog_product" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "catalog_product_collection_coll_idx" ON "catalog_product_collection" USING btree ("collection_id");--> statement-breakpoint
CREATE INDEX "catalog_product_media_media_idx" ON "catalog_product_media" USING btree ("media_id");--> statement-breakpoint
CREATE INDEX "catalog_product_tag_tag_idx" ON "catalog_product_tag" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "catalog_related_related_idx" ON "catalog_related" USING btree ("related_id");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_variant_label_uq" ON "catalog_variant" USING btree ("product_id","label");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_variant_suffix_uq" ON "catalog_variant" USING btree ("product_id","sku_suffix");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_variant_default_uq" ON "catalog_variant" USING btree ("product_id") WHERE "catalog_variant"."is_default";--> statement-breakpoint
CREATE INDEX "pricing_price_product_idx" ON "pricing_price" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "inventory_level_product_idx" ON "inventory_level" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "inventory_level_sku_idx" ON "inventory_level" USING btree ("sku");--> statement-breakpoint
CREATE INDEX "inventory_movement_variant_idx" ON "inventory_movement" USING btree ("variant_id","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "inventory_reservation_status_expires_idx" ON "inventory_reservation" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "inventory_reservation_reference_idx" ON "inventory_reservation" USING btree ("reference");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_subscription_contact_uq" ON "inventory_subscription" USING btree ("variant_id",coalesce("phone", ''),coalesce("email", ''));--> statement-breakpoint
CREATE INDEX "inventory_subscription_pending_idx" ON "inventory_subscription" USING btree ("variant_id") WHERE "inventory_subscription"."notified_at" is null;--> statement-breakpoint
CREATE INDEX "cart_cart_customer_idx" ON "cart_cart" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "cart_cart_status_activity_idx" ON "cart_cart" USING btree ("status","last_activity_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cart_line_variant_kind_uq" ON "cart_line" USING btree ("cart_id","variant_id","kind");--> statement-breakpoint
CREATE INDEX "customers_address_user_idx" ON "customers_address" USING btree ("user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "customers_address_district_idx" ON "customers_address" USING btree ("district_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_address_one_default" ON "customers_address" USING btree ("user_id") WHERE is_default;--> statement-breakpoint
CREATE INDEX "customers_consent_phone_idx" ON "customers_consent" USING btree ("phone_hash","purpose");--> statement-breakpoint
CREATE INDEX "customers_consent_email_idx" ON "customers_consent" USING btree ("email_hash","purpose");--> statement-breakpoint
CREATE INDEX "customers_consent_user_idx" ON "customers_consent" USING btree ("user_id","purpose");--> statement-breakpoint
CREATE INDEX "customers_consent_list_idx" ON "customers_consent" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "customers_land_profile_user_idx" ON "customers_land_profile" USING btree ("user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "customers_lead_status_idx" ON "customers_lead" USING btree ("status","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "customers_lead_phone_idx" ON "customers_lead" USING btree ("phone_hash","source");--> statement-breakpoint
CREATE INDEX "customers_lead_list_idx" ON "customers_lead" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "customers_profile_phone_hash_idx" ON "customers_profile" USING btree ("phone_hash");--> statement-breakpoint
CREATE INDEX "customers_profile_email_hash_idx" ON "customers_profile" USING btree ("email_hash");--> statement-breakpoint
CREATE INDEX "customers_profile_list_idx" ON "customers_profile" USING btree ("created_at" DESC NULLS LAST,"user_id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "orders_event_order_idx" ON "orders_event" USING btree ("order_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_fulfilment_order_key" ON "orders_fulfilment" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_invoice_number_key" ON "orders_invoice" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_invoice_order_key" ON "orders_invoice" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "orders_line_order_idx" ON "orders_line" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "orders_line_variant_idx" ON "orders_line" USING btree ("variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_order_number_key" ON "orders_order" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_order_guest_token_key" ON "orders_order" USING btree ("guest_token_hash");--> statement-breakpoint
CREATE INDEX "orders_order_status_idx" ON "orders_order" USING btree ("status","placed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "orders_order_customer_idx" ON "orders_order" USING btree ("customer_id","placed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "orders_order_payment_status_idx" ON "orders_order" USING btree ("payment_status");--> statement-breakpoint
CREATE INDEX "orders_order_is_test_idx" ON "orders_order" USING btree ("is_test");--> statement-breakpoint
CREATE INDEX "orders_order_parent_idx" ON "orders_order" USING btree ("parent_order_id");--> statement-breakpoint
CREATE INDEX "orders_order_list_idx" ON "orders_order" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "orders_order_slot_idx" ON "orders_order" USING btree (((delivery ->> 'slotDate')));--> statement-breakpoint
CREATE UNIQUE INDEX "checkout_session_cart_key" ON "checkout_session" USING btree ("cart_id");--> statement-breakpoint
CREATE UNIQUE INDEX "checkout_session_idempotency_key" ON "checkout_session" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "checkout_session_customer_idx" ON "checkout_session" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "checkout_session_list_idx" ON "checkout_session" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "payments_attempt_order_idx" ON "payments_attempt" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "payments_attempt_poll_idx" ON "payments_attempt" USING btree ("next_poll_at") WHERE "payments_attempt"."state" = 'pending';--> statement-breakpoint
CREATE INDEX "payments_attempt_sweep_idx" ON "payments_attempt" USING btree ("expires_at") WHERE "payments_attempt"."swept_at" is null;--> statement-breakpoint
CREATE INDEX "payments_attempt_list_idx" ON "payments_attempt" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "payments_refund_order_idx" ON "payments_refund" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "payments_refund_attempt_idx" ON "payments_refund" USING btree ("attempt_id");--> statement-breakpoint
CREATE INDEX "payments_refund_list_idx" ON "payments_refund" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "payments_webhook_event_received_idx" ON "payments_webhook_event" USING btree ("provider","signature_ok","received_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "seo_not_found_hits_idx" ON "seo_not_found" USING btree ("hits" DESC NULLS LAST,"path");--> statement-breakpoint
CREATE INDEX "seo_not_found_fixed_idx" ON "seo_not_found" USING btree ("fixed_redirect_id");--> statement-breakpoint
CREATE INDEX "seo_not_found_last_idx" ON "seo_not_found" USING btree ("last_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "seo_page_meta_updated_idx" ON "seo_page_meta" USING btree ("updated_at" DESC NULLS LAST,"path");--> statement-breakpoint
CREATE INDEX "seo_redirect_to_idx" ON "seo_redirect" USING btree ("to_path");--> statement-breakpoint
CREATE INDEX "seo_redirect_list_idx" ON "seo_redirect" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE VIEW "public"."customers_v_segment_bulk_buyer" AS (select user_id, display_name, phone_e164, email, orders_count, lifetime_paise, created_at from customers_profile where lifetime_paise >= 2500000 or 'bulk' = any(tags));--> statement-breakpoint
CREATE VIEW "public"."customers_v_segment_by_district" AS (select p.user_id, p.display_name, p.phone_e164, p.email, p.orders_count, p.lifetime_paise, p.created_at, a.district_id, a.district_text
      from customers_profile p
      join lateral (
        select district_id, district_text from customers_address a
        where a.user_id = p.user_id order by a.is_default desc, a.created_at desc, a.id desc limit 1
      ) a on true);--> statement-breakpoint
CREATE VIEW "public"."customers_v_segment_first_order" AS (select user_id, display_name, phone_e164, email, orders_count, lifetime_paise, created_at from customers_profile where orders_count = 1);--> statement-breakpoint
CREATE VIEW "public"."customers_v_segment_wizard_lead_no_order" AS (select l.id as lead_id, l.name, l.phone_e164, l.phone_verified, l.status::text as status, l.created_at
      from customers_lead l
      where l.source = 'wizard' and l.status <> 'converted'
        and not exists (select 1 from customers_profile p where p.phone_hash = l.phone_hash and p.orders_count > 0));