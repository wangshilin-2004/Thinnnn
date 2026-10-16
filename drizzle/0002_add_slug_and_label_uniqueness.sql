ALTER TABLE "foods" ADD COLUMN "slug" text;--> statement-breakpoint
CREATE UNIQUE INDEX "food_servings_food_label_uniq" ON "food_servings" USING btree ("food_id","label");--> statement-breakpoint
CREATE UNIQUE INDEX "foods_slug_uniq" ON "foods" USING btree ("slug");