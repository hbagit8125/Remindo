CREATE TABLE "saving_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"saving_id" uuid NOT NULL,
	"type" text NOT NULL,
	"amount_paise" integer NOT NULL,
	"date" text NOT NULL,
	"note" text,
	"transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "savings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'other' NOT NULL,
	"institution" text,
	"rate_pct" text,
	"maturity_date" text,
	"reminder_id" uuid,
	"notes" text,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "saving_entries_saving_idx" ON "saving_entries" USING btree ("saving_id");