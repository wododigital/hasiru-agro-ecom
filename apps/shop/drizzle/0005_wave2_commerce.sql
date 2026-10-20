CREATE TYPE "public"."cart_line_kind" AS ENUM('product', 'package');--> statement-breakpoint
CREATE TYPE "public"."cart_status" AS ENUM('active', 'abandoned', 'converted', 'merged');--> statement-breakpoint
CREATE TYPE "public"."shipping_method_kind" AS ENUM('pickup', 'local_slot', 'outstation_distance');--> statement-breakpoint
CREATE TYPE "public"."shipping_packing_scope" AS ENUM('order', 'product', 'size_class', 'qty_band');--> statement-breakpoint
CREATE TYPE "public"."shipping_zone_kind" AS ENUM('local', 'outstation', 'enquiry');--> statement-breakpoint
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
CREATE TYPE "public"."flows_run_status" AS ENUM('running', 'completed', 'stopped', 'failed');--> statement-breakpoint
CREATE TYPE "public"."flows_status" AS ENUM('active', 'paused');--> statement-breakpoint
CREATE TYPE "public"."flows_step_kind" AS ENUM('send_email', 'send_whatsapp', 'wait', 'stop_if');--> statement-breakpoint
CREATE TYPE "public"."flows_trigger" AS ENUM('cart_abandoned', 'order_placed', 'order_paid', 'order_dispatched', 'order_delivered', 'slot_reminder', 'back_in_stock', 'wizard_lead_no_order', 'review_request');--> statement-breakpoint
CREATE TYPE "public"."marketing_conversion_status" AS ENUM('pending', 'sent', 'failed', 'skipped_test', 'skipped_consent', 'skipped_not_configured');--> statement-breakpoint
CREATE TYPE "public"."marketing_destination" AS ENUM('ga4', 'meta');--> statement-breakpoint
CREATE TYPE "public"."marketing_tag_placement" AS ENUM('head', 'body_end');--> statement-breakpoint
CREATE TYPE "public"."marketing_tag_scope" AS ENUM('all', 'paths');--> statement-breakpoint
CREATE TYPE "public"."marketing_tag_vendor" AS ENUM('ga4', 'meta_pixel', 'google_ads', 'custom');--> statement-breakpoint
CREATE TYPE "public"."feeds_destination" AS ENUM('google', 'meta');--> statement-breakpoint
CREATE TYPE "public"."feeds_run_kind" AS ENUM('full', 'delta');--> statement-breakpoint
CREATE TYPE "public"."planting_role" AS ENUM('M', 'X', 'O');--> statement-breakpoint
CREATE TYPE "public"."planting_unlock_mode" AS ENUM('otp', 'soft');--> statement-breakpoint
CREATE TYPE "public"."farmcalc_age_band" AS ENUM('at_planting', 'y0_2', 'y3_6', 'y7_plus');--> statement-breakpoint
CREATE TYPE "public"."farmcalc_basis" AS ENUM('per_plant', 'per_acre');--> statement-breakpoint
CREATE TYPE "public"."farmcalc_role" AS ENUM('M', 'X', 'O', 'any');--> statement-breakpoint
CREATE TYPE "public"."farmcalc_unit" AS ENUM('kg', 'L');--> statement-breakpoint
CREATE TYPE "public"."erp_mapped_by" AS ENUM('auto', 'manual');--> statement-breakpoint
CREATE TYPE "public"."erp_outbox_kind" AS ENUM('order', 'lead');--> statement-breakpoint
CREATE TYPE "public"."erp_outbox_status" AS ENUM('pending', 'sent', 'failed', 'dead');--> statement-breakpoint
CREATE TYPE "public"."erp_run_direction" AS ENUM('inventory_in', 'orders_out');--> statement-breakpoint
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
CREATE TABLE "shipping_distance_override" (
	"district_slug" text PRIMARY KEY NOT NULL,
	"km" numeric(8, 1) NOT NULL,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipping_method" (
	"id" uuid PRIMARY KEY NOT NULL,
	"zone_id" uuid,
	"kind" "shipping_method_kind" NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipping_packing_rule" (
	"id" uuid PRIMARY KEY NOT NULL,
	"scope" "shipping_packing_scope" NOT NULL,
	"match" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"fee_paise" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipping_slot" (
	"id" uuid PRIMARY KEY NOT NULL,
	"weekday" integer NOT NULL,
	"cutoff_hours" integer DEFAULT 24 NOT NULL,
	"capacity_kg" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipping_slot_weekday_check" CHECK ("shipping_slot"."weekday" between 0 and 6),
	CONSTRAINT "shipping_slot_cutoff_check" CHECK ("shipping_slot"."cutoff_hours" >= 0)
);
--> statement-breakpoint
CREATE TABLE "shipping_slot_booking" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slot_id" uuid NOT NULL,
	"slot_date" date NOT NULL,
	"order_id" uuid NOT NULL,
	"order_number" text NOT NULL,
	"weight_kg" numeric(10, 3) NOT NULL,
	"reminded_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipping_vehicle" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"capacity_kg" integer NOT NULL,
	"local_flat_paise" integer NOT NULL,
	"per_km_paise" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipping_vehicle_capacity_check" CHECK ("shipping_vehicle"."capacity_kg" > 0),
	CONSTRAINT "shipping_vehicle_rates_check" CHECK ("shipping_vehicle"."local_flat_paise" >= 0 and "shipping_vehicle"."per_km_paise" >= 0)
);
--> statement-breakpoint
CREATE TABLE "shipping_zone" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"kind" "shipping_zone_kind" NOT NULL,
	"district_slugs" text[] DEFAULT '{}'::text[] NOT NULL,
	"state_codes" text[] DEFAULT '{}'::text[] NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipping_zone_slug_unique" UNIQUE("slug")
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
CREATE TABLE "flows_flow" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"trigger" "flows_trigger" NOT NULL,
	"status" "flows_status" DEFAULT 'active' NOT NULL,
	"settings" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "flows_flow_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "flows_run" (
	"id" uuid PRIMARY KEY NOT NULL,
	"flow_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"contact_hash" text,
	"position" integer DEFAULT 0 NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "flows_run_status" DEFAULT 'running' NOT NULL,
	"stop_reason" text,
	"next_step_at" timestamp with time zone,
	"messages" integer DEFAULT 0 NOT NULL,
	"is_test" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flows_run_step" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"step_id" uuid,
	"executed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"result" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flows_step" (
	"id" uuid PRIMARY KEY NOT NULL,
	"flow_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"kind" "flows_step_kind" NOT NULL,
	"config" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_attribution" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"first_touch" jsonb,
	"last_touch" jsonb,
	"gclid" text,
	"fbclid" text,
	"fbp" text,
	"fbc" text,
	"ga_client_id" text,
	"consent_analytics" boolean DEFAULT false NOT NULL,
	"consent_marketing" boolean DEFAULT false NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_conversion_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"name" text NOT NULL,
	"order_id" uuid,
	"destination" "marketing_destination" NOT NULL,
	"status" "marketing_conversion_status" DEFAULT 'pending' NOT NULL,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_tag" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"vendor" "marketing_tag_vendor" DEFAULT 'custom' NOT NULL,
	"placement" "marketing_tag_placement" DEFAULT 'body_end' NOT NULL,
	"scope" "marketing_tag_scope" DEFAULT 'all' NOT NULL,
	"paths" text[] DEFAULT '{}'::text[] NOT NULL,
	"snippet" text NOT NULL,
	"csp_sources" text[] DEFAULT '{}'::text[] NOT NULL,
	"requires_consent" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feeds_file" (
	"destination" "feeds_destination" PRIMARY KEY NOT NULL,
	"body" text NOT NULL,
	"content_type" text NOT NULL,
	"etag" text NOT NULL,
	"items" integer NOT NULL,
	"generated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feeds_item_state" (
	"destination" "feeds_destination" NOT NULL,
	"variant_id" uuid NOT NULL,
	"hash" text,
	"last_pushed_at" timestamp with time zone,
	"last_error" text,
	CONSTRAINT "feeds_item_state_destination_variant_id_pk" PRIMARY KEY("destination","variant_id")
);
--> statement-breakpoint
CREATE TABLE "feeds_run" (
	"id" uuid PRIMARY KEY NOT NULL,
	"destination" "feeds_destination" NOT NULL,
	"kind" "feeds_run_kind" NOT NULL,
	"items" integer DEFAULT 0 NOT NULL,
	"errors" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"log" jsonb
);
--> statement-breakpoint
CREATE TABLE "planting_model" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"name_kn" text,
	"description_html" text,
	"block_w_ft" integer DEFAULT 36 NOT NULL,
	"block_h_ft" integer DEFAULT 36 NOT NULL,
	"col_spacing_ft" numeric NOT NULL,
	"row_spacing_ft" numeric NOT NULL,
	"pattern" jsonb NOT NULL,
	"legend" jsonb NOT NULL,
	"weight_override_kg" numeric,
	"position" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "planting_model_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "planting_model_plant" (
	"model_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"role" "planting_role" NOT NULL,
	"spacing_ft" jsonb,
	"position" integer DEFAULT 0 NOT NULL,
	"is_default_pick" boolean DEFAULT false NOT NULL,
	CONSTRAINT "planting_model_plant_model_id_product_id_pk" PRIMARY KEY("model_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "planting_plan" (
	"id" uuid PRIMARY KEY NOT NULL,
	"visitor_id" text NOT NULL,
	"customer_id" uuid,
	"lead_id" uuid,
	"district_slug" text NOT NULL,
	"district_label" jsonb NOT NULL,
	"sqft" numeric NOT NULL,
	"boundary_ft" numeric,
	"boundary_estimated" boolean DEFAULT false NOT NULL,
	"purpose" text NOT NULL,
	"inputs_included" boolean DEFAULT true NOT NULL,
	"unlock_mode" "planting_unlock_mode",
	"unlocked_at" timestamp with time zone,
	"selections" jsonb NOT NULL,
	"climate_fit" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "farmcalc_dosage_rule" (
	"id" uuid PRIMARY KEY NOT NULL,
	"input_product_id" uuid NOT NULL,
	"basis" "farmcalc_basis" DEFAULT 'per_plant' NOT NULL,
	"role" "farmcalc_role" DEFAULT 'any' NOT NULL,
	"age_band" "farmcalc_age_band" DEFAULT 'at_planting' NOT NULL,
	"amount" numeric NOT NULL,
	"pack_size" numeric NOT NULL,
	"unit" "farmcalc_unit" DEFAULT 'kg' NOT NULL,
	"min_packs" integer DEFAULT 0 NOT NULL,
	"use_plant_compost" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_conversation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"visitor_id" text,
	"customer_id" uuid,
	"mode" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_message" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"product_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"facts" jsonb,
	"model" text,
	"source" text,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_narration_cache" (
	"hash" text PRIMARY KEY NOT NULL,
	"model" text NOT NULL,
	"output" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "erp_item" (
	"erp_item_id" text PRIMARY KEY NOT NULL,
	"sku" text,
	"name" text NOT NULL,
	"variety" text,
	"available" integer NOT NULL,
	"ready_in_days" integer,
	"cost_paise" integer,
	"erp_updated_at" timestamp with time zone,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "erp_item_map" (
	"variant_id" uuid PRIMARY KEY NOT NULL,
	"erp_item_id" text NOT NULL,
	"erp_name" text,
	"mapped_by" "erp_mapped_by" NOT NULL,
	"confidence" numeric(3, 2) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "erp_item_map_confidence_check" CHECK ("erp_item_map"."confidence" between 0 and 1)
);
--> statement-breakpoint
CREATE TABLE "erp_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" "erp_outbox_kind" NOT NULL,
	"ref_id" uuid NOT NULL,
	"payload" jsonb,
	"status" "erp_outbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"external_ref" text,
	"invoice_number" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "erp_outbox_attempts_check" CHECK ("erp_outbox"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "erp_sync_run" (
	"id" uuid PRIMARY KEY NOT NULL,
	"direction" "erp_run_direction" NOT NULL,
	"transport" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"items" integer DEFAULT 0 NOT NULL,
	"changed" integer DEFAULT 0 NOT NULL,
	"errors" integer DEFAULT 0 NOT NULL,
	"log" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "erp_webhook_event" (
	"nonce" text PRIMARY KEY NOT NULL,
	"ecom_order_number" text NOT NULL,
	"status" text NOT NULL,
	"outcome" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cart_line" ADD CONSTRAINT "cart_line_cart_id_cart_cart_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."cart_cart"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_method" ADD CONSTRAINT "shipping_method_zone_id_shipping_zone_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."shipping_zone"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders_event" ADD CONSTRAINT "orders_event_order_id_orders_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders_fulfilment" ADD CONSTRAINT "orders_fulfilment_order_id_orders_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders_invoice" ADD CONSTRAINT "orders_invoice_order_id_orders_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders_line" ADD CONSTRAINT "orders_line_order_id_orders_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders_order" ADD CONSTRAINT "orders_order_parent_order_id_orders_order_id_fk" FOREIGN KEY ("parent_order_id") REFERENCES "public"."orders_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments_refund" ADD CONSTRAINT "payments_refund_attempt_id_payments_attempt_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."payments_attempt"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flows_run" ADD CONSTRAINT "flows_run_flow_id_flows_flow_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."flows_flow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flows_run_step" ADD CONSTRAINT "flows_run_step_run_id_flows_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."flows_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flows_run_step" ADD CONSTRAINT "flows_run_step_step_id_flows_step_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."flows_step"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flows_step" ADD CONSTRAINT "flows_step_flow_id_flows_flow_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."flows_flow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planting_model_plant" ADD CONSTRAINT "planting_model_plant_model_id_planting_model_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."planting_model"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_message" ADD CONSTRAINT "ai_message_conversation_id_ai_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cart_cart_customer_idx" ON "cart_cart" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "cart_cart_status_activity_idx" ON "cart_cart" USING btree ("status","last_activity_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cart_line_variant_kind_uq" ON "cart_line" USING btree ("cart_id","variant_id","kind");--> statement-breakpoint
CREATE INDEX "shipping_method_zone_idx" ON "shipping_method" USING btree ("zone_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shipping_slot_booking_order_uq" ON "shipping_slot_booking" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "shipping_slot_booking_date_idx" ON "shipping_slot_booking" USING btree ("slot_date");--> statement-breakpoint
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
CREATE UNIQUE INDEX "flows_run_running_subject_uq" ON "flows_run" USING btree ("flow_id","subject_type","subject_id") WHERE "flows_run"."status" = 'running';--> statement-breakpoint
CREATE INDEX "flows_run_due_idx" ON "flows_run" USING btree ("status","next_step_at");--> statement-breakpoint
CREATE INDEX "flows_run_flow_started_idx" ON "flows_run" USING btree ("flow_id","started_at");--> statement-breakpoint
CREATE INDEX "flows_run_contact_idx" ON "flows_run" USING btree ("contact_hash","started_at");--> statement-breakpoint
CREATE INDEX "flows_run_step_run_idx" ON "flows_run_step" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "flows_step_flow_position_uq" ON "flows_step" USING btree ("flow_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_conversion_event_uq" ON "marketing_conversion_event" USING btree ("destination","event_id");--> statement-breakpoint
CREATE INDEX "marketing_conversion_event_list_idx" ON "marketing_conversion_event" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "feeds_run_list_idx" ON "feeds_run" USING btree ("destination","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "planting_model_plant_product_idx" ON "planting_model_plant" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "planting_plan_list_idx" ON "planting_plan" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "planting_plan_lead_idx" ON "planting_plan" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "planting_plan_customer_idx" ON "planting_plan" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "farmcalc_dosage_rule_key" ON "farmcalc_dosage_rule" USING btree ("input_product_id","basis","role","age_band");--> statement-breakpoint
CREATE INDEX "farmcalc_dosage_rule_position_idx" ON "farmcalc_dosage_rule" USING btree ("is_active","position");--> statement-breakpoint
CREATE INDEX "ai_conversation_started_idx" ON "ai_conversation" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "ai_conversation_customer_idx" ON "ai_conversation" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "ai_message_conversation_idx" ON "ai_message" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_message_created_idx" ON "ai_message" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_narration_cache_created_idx" ON "ai_narration_cache" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "erp_item_seen_idx" ON "erp_item" USING btree ("seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "erp_item_map_erp_item_uq" ON "erp_item_map" USING btree ("erp_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "erp_outbox_kind_ref_uq" ON "erp_outbox" USING btree ("kind","ref_id");--> statement-breakpoint
CREATE INDEX "erp_outbox_status_next_idx" ON "erp_outbox" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "erp_sync_run_direction_started_idx" ON "erp_sync_run" USING btree ("direction","started_at" DESC NULLS LAST);