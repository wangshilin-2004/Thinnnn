CREATE TABLE "daily_summary" (
	"user_id" uuid NOT NULL,
	"log_date" date NOT NULL,
	"intake_kcal" numeric(8, 1) DEFAULT '0' NOT NULL,
	"protein_g" numeric(7, 1) DEFAULT '0' NOT NULL,
	"fat_g" numeric(7, 1) DEFAULT '0' NOT NULL,
	"carb_g" numeric(7, 1) DEFAULT '0' NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL,
	"weight_kg" numeric(5, 2),
	"target_kcal" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_summary_user_id_log_date_pk" PRIMARY KEY("user_id","log_date"),
	CONSTRAINT "daily_summary_intake_kcal_check" CHECK ("daily_summary"."intake_kcal" >= 0)
);
--> statement-breakpoint
CREATE TABLE "food_favorites" (
	"user_id" uuid NOT NULL,
	"food_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "food_favorites_user_id_food_id_pk" PRIMARY KEY("user_id","food_id")
);
--> statement-breakpoint
CREATE TABLE "food_servings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"food_id" uuid NOT NULL,
	"label" text NOT NULL,
	"grams" numeric(7, 1) NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "food_servings_grams_check" CHECK ("food_servings"."grams" > 0)
);
--> statement-breakpoint
CREATE TABLE "foods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid,
	"name" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"pinyin" text,
	"pinyin_initials" text,
	"category" text NOT NULL,
	"kcal" numeric(6, 1) NOT NULL,
	"protein_g" numeric(5, 1) DEFAULT '0' NOT NULL,
	"fat_g" numeric(5, 1) DEFAULT '0' NOT NULL,
	"carb_g" numeric(5, 1) DEFAULT '0' NOT NULL,
	"fiber_g" numeric(5, 1),
	"sodium_mg" numeric(8, 1),
	"source" text DEFAULT 'user' NOT NULL,
	"source_ref" text,
	"is_verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "foods_kcal_check" CHECK ("foods"."kcal" >= 0 and "foods"."kcal" <= 900),
	CONSTRAINT "foods_protein_g_check" CHECK ("foods"."protein_g" >= 0 and "foods"."protein_g" <= 100),
	CONSTRAINT "foods_fat_g_check" CHECK ("foods"."fat_g" >= 0 and "foods"."fat_g" <= 100),
	CONSTRAINT "foods_carb_g_check" CHECK ("foods"."carb_g" >= 0 and "foods"."carb_g" <= 100),
	CONSTRAINT "foods_source_check" CHECK ("foods"."source" in ('builtin','user','usda','off'))
);
--> statement-breakpoint
CREATE TABLE "invite_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"note" text,
	"max_uses" integer DEFAULT 1 NOT NULL,
	"used_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invite_codes_max_uses_check" CHECK ("invite_codes"."max_uses" >= 1),
	CONSTRAINT "invite_codes_used_count_check" CHECK ("invite_codes"."used_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "meal_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"log_date" date NOT NULL,
	"meal_type" text NOT NULL,
	"logged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"food_id" uuid,
	"food_name" text NOT NULL,
	"quantity_g" numeric(7, 1) NOT NULL,
	"serving_id" uuid,
	"serving_label" text,
	"kcal" numeric(7, 1) NOT NULL,
	"protein_g" numeric(6, 1) DEFAULT '0' NOT NULL,
	"fat_g" numeric(6, 1) DEFAULT '0' NOT NULL,
	"carb_g" numeric(6, 1) DEFAULT '0' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meal_items_meal_type_check" CHECK ("meal_items"."meal_type" in ('breakfast','lunch','dinner','snack')),
	CONSTRAINT "meal_items_quantity_g_check" CHECK ("meal_items"."quantity_g" > 0 and "meal_items"."quantity_g" <= 5000),
	CONSTRAINT "meal_items_kcal_check" CHECK ("meal_items"."kcal" >= 0)
);
--> statement-breakpoint
CREATE TABLE "measurements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"metric" text NOT NULL,
	"measured_on" date NOT NULL,
	"value" numeric(7, 3) NOT NULL,
	"unit" text NOT NULL,
	"measured_at" timestamp with time zone,
	"source" text DEFAULT 'manual' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "measurements_metric_check" CHECK ("measurements"."metric" in ('weight','body_fat','waist','chest','hip','arm','thigh','neck','sleep_hours','steps')),
	CONSTRAINT "measurements_source_check" CHECK ("measurements"."source" in ('manual','calculated','imported')),
	CONSTRAINT "measurements_value_check" CHECK ("measurements"."value" > 0)
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"timezone" text DEFAULT 'Asia/Shanghai' NOT NULL,
	"sex" text,
	"birth_date" date,
	"height_cm" numeric(5, 1),
	"activity_level" text,
	"goal_type" text,
	"start_weight_kg" numeric(5, 2),
	"target_weight_kg" numeric(5, 2),
	"rate_kg_per_week" numeric(3, 2),
	"bmr_kcal" integer,
	"tdee_kcal" integer,
	"target_kcal" integer,
	"target_protein_g" numeric(5, 1),
	"target_carb_g" numeric(5, 1),
	"target_fat_g" numeric(5, 1),
	"calc_version" text DEFAULT 'v1' NOT NULL,
	"onboarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_sex_check" CHECK ("profiles"."sex" is null or "profiles"."sex" in ('male','female')),
	CONSTRAINT "profiles_activity_level_check" CHECK ("profiles"."activity_level" is null or "profiles"."activity_level" in ('sedentary','light','moderate','active','very_active')),
	CONSTRAINT "profiles_goal_type_check" CHECK ("profiles"."goal_type" is null or "profiles"."goal_type" in ('lose','maintain','gain')),
	CONSTRAINT "profiles_height_cm_check" CHECK ("profiles"."height_cm" is null or "profiles"."height_cm" between 50 and 260),
	CONSTRAINT "profiles_rate_kg_per_week_check" CHECK ("profiles"."rate_kg_per_week" is null or "profiles"."rate_kg_per_week" between 0 and 1.5)
);
--> statement-breakpoint
ALTER TABLE "food_favorites" ADD CONSTRAINT "food_favorites_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_servings" ADD CONSTRAINT "food_servings_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_items" ADD CONSTRAINT "meal_items_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_items" ADD CONSTRAINT "meal_items_serving_id_food_servings_id_fk" FOREIGN KEY ("serving_id") REFERENCES "public"."food_servings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "food_servings_one_default" ON "food_servings" USING btree ("food_id") WHERE "food_servings"."is_default";--> statement-breakpoint
CREATE INDEX "food_servings_food_sort_idx" ON "food_servings" USING btree ("food_id","sort_order");--> statement-breakpoint
CREATE INDEX "foods_category_idx" ON "foods" USING btree ("category");--> statement-breakpoint
CREATE INDEX "foods_aliases_gin" ON "foods" USING gin ("aliases");--> statement-breakpoint
CREATE INDEX "foods_owner_idx" ON "foods" USING btree ("owner_id") WHERE "foods"."owner_id" is not null;--> statement-breakpoint
CREATE INDEX "meal_items_user_date_idx" ON "meal_items" USING btree ("user_id","log_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "meal_items_user_food_date_idx" ON "meal_items" USING btree ("user_id","food_id","log_date" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "measurements_user_metric_date_uniq" ON "measurements" USING btree ("user_id","metric","measured_on");