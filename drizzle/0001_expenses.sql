CREATE TABLE "budget_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"month" text NOT NULL,
	"category" text NOT NULL,
	"threshold" integer NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" text NOT NULL,
	"amount_paise" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text DEFAULT 'expense' NOT NULL,
	"amount_paise" integer NOT NULL,
	"category" text DEFAULT 'Other' NOT NULL,
	"note" text,
	"merchant" text,
	"method" text,
	"date" text NOT NULL,
	"reminder_id" uuid,
	"occurrence_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reminders" ADD COLUMN "amount_paise" integer;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_reminder_id_reminders_id_fk" FOREIGN KEY ("reminder_id") REFERENCES "public"."reminders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "budget_alerts_idx" ON "budget_alerts" USING btree ("month","category","threshold");--> statement-breakpoint
CREATE UNIQUE INDEX "budgets_category_idx" ON "budgets" USING btree ("category");--> statement-breakpoint
CREATE INDEX "transactions_date_idx" ON "transactions" USING btree ("date");--> statement-breakpoint
CREATE INDEX "transactions_reminder_idx" ON "transactions" USING btree ("reminder_id","occurrence_at");