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
CREATE TYPE "public"."discounts_applies_to" AS ENUM('order', 'collection', 'products', 'tags');--> statement-breakpoint
CREATE TYPE "public"."discounts_eligibility" AS ENUM('all', 'segment', 'first_order');--> statement-breakpoint
CREATE TYPE "public"."discounts_kind" AS ENUM('automatic', 'code');--> statement-breakpoint
CREATE TYPE "public"."discounts_status" AS ENUM('draft', 'active', 'paused', 'archived');--> statement-breakpoint
CREATE TYPE "public"."discounts_value_type" AS ENUM('percent', 'fixed');--> statement-breakpoint
CREATE TYPE "public"."inventory_movement_reason" AS ENUM('order', 'cancel', 'adjust', 'erp_sync', 'seed');--> statement-breakpoint
CREATE TYPE "public"."inventory_reservation_status" AS ENUM('held', 'committed', 'released');--> statement-breakpoint
CREATE TYPE "public"."inventory_source" AS ENUM('manual', 'erp', 'seed');--> statement-breakpoint
CREATE TYPE "public"."seo_redirect_source" AS ENUM('manual', 'slug_change', 'legacy_import', 'not_found_fix');--> statement-breakpoint
CREATE TYPE "public"."cms_page_template" AS ENUM('default', 'landing', 'policy', 'service');--> statement-breakpoint
CREATE TYPE "public"."cms_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TYPE "public"."cms_video_kind" AS ENUM('youtube', 'whatsapp', 'file');--> statement-breakpoint
CREATE TYPE "public"."notifications_category" AS ENUM('utility', 'marketing', 'authentication');--> statement-breakpoint
CREATE TYPE "public"."notifications_channel" AS ENUM('email', 'whatsapp', 'sms', 'log');--> statement-breakpoint
CREATE TYPE "public"."notifications_message_status" AS ENUM('queued', 'sent', 'delivered', 'read', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."notifications_wa_template_status" AS ENUM('draft', 'pending', 'approved', 'rejected', 'paused', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."monitoring_alert_status" AS ENUM('open', 'acked', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."monitoring_severity" AS ENUM('critical', 'high', 'low');--> statement-breakpoint
CREATE TYPE "public"."analytics_device" AS ENUM('mobile', 'tablet', 'desktop');--> statement-breakpoint
CREATE TYPE "public"."analytics_vital_metric" AS ENUM('LCP', 'INP', 'CLS', 'TTFB');--> statement-breakpoint
CREATE TYPE "public"."customers_consent_purpose" AS ENUM('order_updates', 'marketing', 'analytics_identity');--> statement-breakpoint
CREATE TYPE "public"."customers_consent_status" AS ENUM('granted', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."customers_lead_source" AS ENUM('wizard', 'notify_me', 'enquiry', 'chat', 'checkout');--> statement-breakpoint
CREATE TYPE "public"."customers_lead_status" AS ENUM('new', 'contacted', 'converted', 'closed');--> statement-breakpoint
CREATE TYPE "public"."customers_type" AS ENUM('farmer', 'business', 'individual');--> statement-breakpoint
CREATE TYPE "public"."enquiries_kind" AS ENUM('farm_development', 'bulk_quote', 'general', 'contact');--> statement-breakpoint
CREATE TYPE "public"."enquiries_status" AS ENUM('new', 'contacted', 'site_assessment', 'design', 'quotation', 'project', 'closed_won', 'closed_lost');--> statement-breakpoint
CREATE TYPE "public"."reviews_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
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
CREATE TABLE "discounts_code" (
	"id" uuid PRIMARY KEY NOT NULL,
	"rule_id" uuid NOT NULL,
	"code" text NOT NULL,
	"single_use_phone_hash" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discounts_code_code_uq" UNIQUE("code"),
	CONSTRAINT "discounts_code_upper_ck" CHECK ("discounts_code"."code" = upper("discounts_code"."code") and length("discounts_code"."code") between 3 and 40)
);
--> statement-breakpoint
CREATE TABLE "discounts_redemption" (
	"id" uuid PRIMARY KEY NOT NULL,
	"rule_id" uuid NOT NULL,
	"code_id" uuid,
	"order_id" uuid NOT NULL,
	"customer_id" uuid,
	"phone_hash" text,
	"amount_paise" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discounts_redemption_order_rule_uq" UNIQUE("order_id","rule_id")
);
--> statement-breakpoint
CREATE TABLE "discounts_rule" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" "discounts_kind" NOT NULL,
	"status" "discounts_status" DEFAULT 'draft' NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"value_type" "discounts_value_type" NOT NULL,
	"value" integer NOT NULL,
	"applies_to" "discounts_applies_to" DEFAULT 'order' NOT NULL,
	"target_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"min_qty" integer,
	"min_subtotal_paise" integer,
	"customer_eligibility" "discounts_eligibility" DEFAULT 'all' NOT NULL,
	"segment_id" text,
	"usage_limit_total" integer,
	"usage_limit_per_customer" integer,
	"stackable" boolean DEFAULT false NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"description_public" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discounts_rule_value_ck" CHECK ("discounts_rule"."value" > 0 and ("discounts_rule"."value_type" = 'fixed' or "discounts_rule"."value" <= 100)),
	CONSTRAINT "discounts_rule_window_ck" CHECK ("discounts_rule"."starts_at" is null or "discounts_rule"."ends_at" is null or "discounts_rule"."ends_at" > "discounts_rule"."starts_at")
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
CREATE TABLE "search_query_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"q" text NOT NULL,
	"results" integer NOT NULL,
	"filters" jsonb,
	"session_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
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
CREATE TABLE "cms_block" (
	"id" uuid PRIMARY KEY NOT NULL,
	"page_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"type" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_client" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"project_type" text,
	"location" text,
	"acreage" numeric,
	"work_done" text,
	"logo_media_id" uuid,
	"status" "cms_status" DEFAULT 'draft' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_counter" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	"suffix" text,
	"verified" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_menu" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_menu_item" (
	"id" uuid PRIMARY KEY NOT NULL,
	"menu_key" text NOT NULL,
	"parent_id" uuid,
	"label" text NOT NULL,
	"href" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"is_external" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_page" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"title_kn" text,
	"status" "cms_status" DEFAULT 'draft' NOT NULL,
	"seo_title" text,
	"seo_description" text,
	"noindex" boolean DEFAULT false NOT NULL,
	"template" "cms_page_template" DEFAULT 'default' NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cms_page_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "cms_portfolio_item" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"location" text,
	"land_size_acres" numeric,
	"scope" text,
	"before_media_id" uuid,
	"after_media_id" uuid,
	"gallery" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"body_html" text DEFAULT '' NOT NULL,
	"status" "cms_status" DEFAULT 'draft' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cms_portfolio_item_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "cms_post" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"excerpt" text,
	"body_html" text DEFAULT '' NOT NULL,
	"cover_media_id" uuid,
	"author" text,
	"published_at" timestamp with time zone,
	"status" "cms_status" DEFAULT 'draft' NOT NULL,
	"seo_title" text,
	"seo_description" text,
	"noindex" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cms_post_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "cms_team_member" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text,
	"name" text NOT NULL,
	"role" text,
	"bio" text,
	"photo_media_id" uuid,
	"status" "cms_status" DEFAULT 'draft' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cms_team_member_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "cms_testimonial" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text,
	"name" text NOT NULL,
	"location" text,
	"photo_media_id" uuid,
	"body" text NOT NULL,
	"rating" integer,
	"project_type" text,
	"source" text,
	"status" "cms_status" DEFAULT 'draft' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cms_testimonial_key_unique" UNIQUE("key"),
	CONSTRAINT "cms_testimonial_rating_check" CHECK ("cms_testimonial"."rating" is null or "cms_testimonial"."rating" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "cms_trust_claim" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"value" text,
	"logo_media_id" uuid,
	"show" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_video" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"url" text NOT NULL,
	"kind" "cms_video_kind" DEFAULT 'youtube' NOT NULL,
	"poster_media_id" uuid,
	"category" text,
	"product_id" uuid,
	"model_slug" text,
	"position" integer DEFAULT 0 NOT NULL,
	"status" "cms_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications_message" (
	"id" uuid PRIMARY KEY NOT NULL,
	"channel" "notifications_channel" NOT NULL,
	"template_key" text NOT NULL,
	"category" "notifications_category" NOT NULL,
	"to_hash" text NOT NULL,
	"to_masked" text NOT NULL,
	"rendered" jsonb,
	"provider_message_id" text,
	"status" "notifications_message_status" DEFAULT 'queued' NOT NULL,
	"error_code" text,
	"error" text,
	"pricing" jsonb,
	"order_id" uuid,
	"flow_run_id" uuid,
	"is_test" boolean DEFAULT false NOT NULL,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications_optout" (
	"phone_hash" text PRIMARY KEY NOT NULL,
	"channel" "notifications_channel" NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications_template" (
	"key" text NOT NULL,
	"channel" "notifications_channel" NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"meta_template_name" text,
	"category" "notifications_category" NOT NULL,
	"variables" text[] NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_template_key_channel_locale_pk" PRIMARY KEY("key","channel","locale")
);
--> statement-breakpoint
CREATE TABLE "notifications_webhook_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"kind" text NOT NULL,
	"phone_hash" text,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "notifications_webhook_event_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "notifications_whatsapp_template" (
	"name" text PRIMARY KEY NOT NULL,
	"category" "notifications_category" NOT NULL,
	"language" text NOT NULL,
	"status" "notifications_wa_template_status" DEFAULT 'draft' NOT NULL,
	"components" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"meta_id" text,
	"last_synced_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "monitoring_alert" (
	"id" uuid PRIMARY KEY NOT NULL,
	"rule_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"severity" "monitoring_severity" NOT NULL,
	"status" "monitoring_alert_status" DEFAULT 'open' NOT NULL,
	"first_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_at" timestamp with time zone DEFAULT now() NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"acked_by" uuid,
	"acked_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"notified_at" timestamp with time zone,
	"next_repeat_at" timestamp with time zone,
	"delivery" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monitoring_alert_rule" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"severity" "monitoring_severity" NOT NULL,
	"channels" text[] DEFAULT '{}'::text[] NOT NULL,
	"dedupe_minutes" integer NOT NULL,
	"repeat_minutes" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monitoring_alert_rule_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "monitoring_check_result" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"check" text NOT NULL,
	"ok" boolean NOT NULL,
	"latency_ms" integer,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_daily_rollup" (
	"day" date NOT NULL,
	"metric" text NOT NULL,
	"dimension" text DEFAULT '' NOT NULL,
	"value" numeric NOT NULL,
	CONSTRAINT "analytics_daily_rollup_pkey" PRIMARY KEY("day","metric","dimension")
);
--> statement-breakpoint
CREATE TABLE "analytics_event" (
	"id" bigserial NOT NULL,
	"client_event_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"visitor_id" uuid NOT NULL,
	"name" text NOT NULL,
	"path" text NOT NULL,
	"props" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"client_ts" timestamp with time zone,
	"server_ts" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_event_pkey" PRIMARY KEY("id","server_ts"),
	CONSTRAINT "analytics_event_client_event_uq" UNIQUE("client_event_id","server_ts")
);
--> statement-breakpoint
CREATE TABLE "analytics_session" (
	"id" uuid PRIMARY KEY NOT NULL,
	"visitor_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"last_event_at" timestamp with time zone NOT NULL,
	"landing_path" text NOT NULL,
	"referrer_host" text,
	"utm" jsonb,
	"device" "analytics_device" NOT NULL,
	"channel" text DEFAULT 'direct' NOT NULL,
	"is_bot" boolean DEFAULT false NOT NULL,
	"bot_name" text,
	"is_test" boolean DEFAULT false NOT NULL,
	"country" text
);
--> statement-breakpoint
CREATE TABLE "analytics_visitor" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cookie_hash" text NOT NULL,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"customer_id" uuid,
	"is_bot" boolean DEFAULT false NOT NULL,
	CONSTRAINT "analytics_visitor_cookie_hash_unique" UNIQUE("cookie_hash")
);
--> statement-breakpoint
CREATE TABLE "analytics_web_vital" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"path" text NOT NULL,
	"metric" "analytics_vital_metric" NOT NULL,
	"value" numeric NOT NULL,
	"device" "analytics_device" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "places_district" (
	"id" uuid PRIMARY KEY NOT NULL,
	"state_code" char(2) NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"hq_lat" double precision,
	"hq_lng" double precision,
	"distance_km_from_nursery" double precision,
	"soil_text" text DEFAULT '' NOT NULL,
	"soil_tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"temp_min" double precision NOT NULL,
	"temp_max" double precision NOT NULL,
	"humidity_min" double precision NOT NULL,
	"humidity_max" double precision NOT NULL,
	"rainfall_mm" double precision NOT NULL,
	"rivers" text[] DEFAULT '{}'::text[] NOT NULL,
	"native_crops" text[] DEFAULT '{}'::text[] NOT NULL,
	"taluks" integer,
	"hoblis" integer,
	"villages" integer,
	"page_enabled" boolean DEFAULT false NOT NULL,
	"page_intro_html" text,
	"data_source" text DEFAULT 'client_sheet' NOT NULL,
	"review_notes" text[] DEFAULT '{}'::text[] NOT NULL,
	"admin_locked" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "places_district_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "places_pincode" (
	"pincode" char(6) PRIMARY KEY NOT NULL,
	"office_name" text NOT NULL,
	"district_id" uuid,
	"state_code" char(2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "places_state" (
	"code" char(2) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"gst_code" char(2) NOT NULL
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
CREATE TABLE "enquiries_attachment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"enquiry_id" uuid NOT NULL,
	"media_id" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enquiries_enquiry" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" "enquiries_kind" NOT NULL,
	"name" text NOT NULL,
	"phone_e164" text NOT NULL,
	"phone_hash" text,
	"email" text,
	"customer_type" text,
	"acres" numeric,
	"location_text" text,
	"district_id" uuid,
	"timeline" text,
	"requirement" text,
	"customer_notes" text,
	"status" "enquiries_status" DEFAULT 'new' NOT NULL,
	"assigned_to" uuid,
	"source_path" text,
	"utm" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"lead_id" uuid,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enquiries_note" (
	"id" uuid PRIMARY KEY NOT NULL,
	"enquiry_id" uuid NOT NULL,
	"author_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews_aggregate" (
	"product_id" uuid PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"avg" numeric(3, 2),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews_media" (
	"review_id" uuid NOT NULL,
	"media_id" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "reviews_media_review_id_media_id_pk" PRIMARY KEY("review_id","media_id")
);
--> statement-breakpoint
CREATE TABLE "reviews_review" (
	"id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"customer_id" uuid,
	"order_id" uuid,
	"rating" smallint NOT NULL,
	"title" text,
	"body" text NOT NULL,
	"author_name" text,
	"district_text" text,
	"is_verified_buyer" boolean DEFAULT false NOT NULL,
	"status" "reviews_status" DEFAULT 'pending' NOT NULL,
	"admin_reply" text,
	"is_sample" boolean DEFAULT false NOT NULL,
	"data_source" text DEFAULT 'customer' NOT NULL,
	"moderated_by" uuid,
	"moderated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_review_rating_range" CHECK ("reviews_review"."rating" between 1 and 5)
);
--> statement-breakpoint
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
ALTER TABLE "discounts_code" ADD CONSTRAINT "discounts_code_rule_id_discounts_rule_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."discounts_rule"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discounts_redemption" ADD CONSTRAINT "discounts_redemption_rule_id_discounts_rule_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."discounts_rule"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discounts_redemption" ADD CONSTRAINT "discounts_redemption_code_id_discounts_code_id_fk" FOREIGN KEY ("code_id") REFERENCES "public"."discounts_code"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_not_found" ADD CONSTRAINT "seo_not_found_fixed_redirect_id_seo_redirect_id_fk" FOREIGN KEY ("fixed_redirect_id") REFERENCES "public"."seo_redirect"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_block" ADD CONSTRAINT "cms_block_page_id_cms_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."cms_page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_menu_item" ADD CONSTRAINT "cms_menu_item_menu_key_cms_menu_key_fk" FOREIGN KEY ("menu_key") REFERENCES "public"."cms_menu"("key") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "cms_menu_item" ADD CONSTRAINT "cms_menu_item_parent_id_cms_menu_item_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."cms_menu_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_session" ADD CONSTRAINT "analytics_session_visitor_id_analytics_visitor_id_fk" FOREIGN KEY ("visitor_id") REFERENCES "public"."analytics_visitor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "places_district" ADD CONSTRAINT "places_district_state_code_places_state_code_fk" FOREIGN KEY ("state_code") REFERENCES "public"."places_state"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "places_pincode" ADD CONSTRAINT "places_pincode_district_id_places_district_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."places_district"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "places_pincode" ADD CONSTRAINT "places_pincode_state_code_places_state_code_fk" FOREIGN KEY ("state_code") REFERENCES "public"."places_state"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries_attachment" ADD CONSTRAINT "enquiries_attachment_enquiry_id_enquiries_enquiry_id_fk" FOREIGN KEY ("enquiry_id") REFERENCES "public"."enquiries_enquiry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries_note" ADD CONSTRAINT "enquiries_note_enquiry_id_enquiries_enquiry_id_fk" FOREIGN KEY ("enquiry_id") REFERENCES "public"."enquiries_enquiry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews_media" ADD CONSTRAINT "reviews_media_review_id_reviews_review_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews_review"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
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
CREATE INDEX "discounts_code_rule_idx" ON "discounts_code" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "discounts_redemption_rule_phone_idx" ON "discounts_redemption" USING btree ("rule_id","phone_hash");--> statement-breakpoint
CREATE INDEX "discounts_redemption_code_idx" ON "discounts_redemption" USING btree ("code_id");--> statement-breakpoint
CREATE INDEX "discounts_redemption_list_idx" ON "discounts_redemption" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "discounts_rule_live_idx" ON "discounts_rule" USING btree ("status","starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "discounts_rule_list_idx" ON "discounts_rule" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "inventory_level_product_idx" ON "inventory_level" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "inventory_level_sku_idx" ON "inventory_level" USING btree ("sku");--> statement-breakpoint
CREATE INDEX "inventory_movement_variant_idx" ON "inventory_movement" USING btree ("variant_id","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "inventory_reservation_status_expires_idx" ON "inventory_reservation" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "inventory_reservation_reference_idx" ON "inventory_reservation" USING btree ("reference");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_subscription_contact_uq" ON "inventory_subscription" USING btree ("variant_id",coalesce("phone", ''),coalesce("email", ''));--> statement-breakpoint
CREATE INDEX "inventory_subscription_pending_idx" ON "inventory_subscription" USING btree ("variant_id") WHERE "inventory_subscription"."notified_at" is null;--> statement-breakpoint
CREATE INDEX "search_query_log_results_created_idx" ON "search_query_log" USING btree ("results","created_at");--> statement-breakpoint
CREATE INDEX "seo_not_found_hits_idx" ON "seo_not_found" USING btree ("hits" DESC NULLS LAST,"path");--> statement-breakpoint
CREATE INDEX "seo_not_found_fixed_idx" ON "seo_not_found" USING btree ("fixed_redirect_id");--> statement-breakpoint
CREATE INDEX "seo_not_found_last_idx" ON "seo_not_found" USING btree ("last_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "seo_page_meta_updated_idx" ON "seo_page_meta" USING btree ("updated_at" DESC NULLS LAST,"path");--> statement-breakpoint
CREATE INDEX "seo_redirect_to_idx" ON "seo_redirect" USING btree ("to_path");--> statement-breakpoint
CREATE INDEX "seo_redirect_list_idx" ON "seo_redirect" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "cms_block_page_idx" ON "cms_block" USING btree ("page_id","position");--> statement-breakpoint
CREATE INDEX "cms_client_status_idx" ON "cms_client" USING btree ("status","position");--> statement-breakpoint
CREATE INDEX "cms_client_list_idx" ON "cms_client" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "cms_menu_item_menu_idx" ON "cms_menu_item" USING btree ("menu_key","position");--> statement-breakpoint
CREATE INDEX "cms_menu_item_parent_idx" ON "cms_menu_item" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "cms_page_status_idx" ON "cms_page" USING btree ("status","template");--> statement-breakpoint
CREATE INDEX "cms_page_list_idx" ON "cms_page" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "cms_portfolio_status_idx" ON "cms_portfolio_item" USING btree ("status","position");--> statement-breakpoint
CREATE INDEX "cms_portfolio_list_idx" ON "cms_portfolio_item" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "cms_post_status_idx" ON "cms_post" USING btree ("status","published_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "cms_post_list_idx" ON "cms_post" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "cms_team_status_idx" ON "cms_team_member" USING btree ("status","position");--> statement-breakpoint
CREATE INDEX "cms_team_list_idx" ON "cms_team_member" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "cms_testimonial_status_idx" ON "cms_testimonial" USING btree ("status","position");--> statement-breakpoint
CREATE INDEX "cms_testimonial_list_idx" ON "cms_testimonial" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "cms_video_product_idx" ON "cms_video" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "cms_video_model_idx" ON "cms_video" USING btree ("model_slug");--> statement-breakpoint
CREATE INDEX "cms_video_status_idx" ON "cms_video" USING btree ("status","category","position");--> statement-breakpoint
CREATE INDEX "cms_video_list_idx" ON "cms_video" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notifications_message_status_idx" ON "notifications_message" USING btree ("status","queued_at");--> statement-breakpoint
CREATE INDEX "notifications_message_provider_idx" ON "notifications_message" USING btree ("provider_message_id");--> statement-breakpoint
CREATE INDEX "notifications_message_to_idx" ON "notifications_message" USING btree ("to_hash","queued_at");--> statement-breakpoint
CREATE INDEX "notifications_webhook_inbound_idx" ON "notifications_webhook_event" USING btree ("phone_hash","received_at");--> statement-breakpoint
CREATE INDEX "notifications_webhook_pending_idx" ON "notifications_webhook_event" USING btree ("processed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "monitoring_alert_open_uq" ON "monitoring_alert" USING btree ("rule_key","fingerprint") WHERE "monitoring_alert"."status" <> 'resolved';--> statement-breakpoint
CREATE INDEX "monitoring_alert_status_idx" ON "monitoring_alert" USING btree ("status","last_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "monitoring_alert_repeat_idx" ON "monitoring_alert" USING btree ("next_repeat_at");--> statement-breakpoint
CREATE INDEX "monitoring_alert_list_idx" ON "monitoring_alert" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "monitoring_check_result_check_idx" ON "monitoring_check_result" USING btree ("check","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "monitoring_check_result_created_idx" ON "monitoring_check_result" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "analytics_event_session_idx" ON "analytics_event" USING btree ("session_id","server_ts");--> statement-breakpoint
CREATE INDEX "analytics_event_name_idx" ON "analytics_event" USING btree ("name","server_ts");--> statement-breakpoint
CREATE INDEX "analytics_session_started_idx" ON "analytics_session" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "analytics_session_visitor_idx" ON "analytics_session" USING btree ("visitor_id","last_event_at");--> statement-breakpoint
CREATE INDEX "analytics_web_vital_created_idx" ON "analytics_web_vital" USING btree ("created_at","metric");--> statement-breakpoint
CREATE INDEX "places_district_state_idx" ON "places_district" USING btree ("state_code");--> statement-breakpoint
CREATE INDEX "places_pincode_district_idx" ON "places_pincode" USING btree ("district_id");--> statement-breakpoint
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
CREATE INDEX "enquiries_attachment_enquiry_idx" ON "enquiries_attachment" USING btree ("enquiry_id");--> statement-breakpoint
CREATE INDEX "enquiries_enquiry_status_idx" ON "enquiries_enquiry" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "enquiries_enquiry_list_idx" ON "enquiries_enquiry" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "enquiries_enquiry_phone_idx" ON "enquiries_enquiry" USING btree ("phone_hash");--> statement-breakpoint
CREATE INDEX "enquiries_enquiry_lead_idx" ON "enquiries_enquiry" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "enquiries_note_enquiry_idx" ON "enquiries_note" USING btree ("enquiry_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "reviews_review_product_idx" ON "reviews_review" USING btree ("product_id","status","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "reviews_review_list_idx" ON "reviews_review" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "reviews_review_status_idx" ON "reviews_review" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "reviews_review_customer_idx" ON "reviews_review" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_review_one_per_customer" ON "reviews_review" USING btree ("product_id","customer_id");--> statement-breakpoint
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