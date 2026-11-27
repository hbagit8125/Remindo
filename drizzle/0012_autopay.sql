CREATE TABLE "autopay_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"autopay_id" uuid NOT NULL,
	"due_date" text NOT NULL,
	"transaction_id" uuid,
	"saving_entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "autopays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"amount_paise" integer NOT NULL,
	"day" integer NOT NULL,
	"account_id" uuid,
	"saving_id" uuid,
	"start_date" text NOT NULL,
	"total_count" integer,
	"paid_before" integer DEFAULT 0 NOT NULL,
	"loan_paise" integer,
	"lender" text,
	"active" boolean DEFAULT true NOT NULL,
	"alert_reminder_id" uuid,
	"alert_for" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "autopay_runs_once" ON "autopay_runs" USING btree ("autopay_id","due_date");