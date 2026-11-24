CREATE TABLE "split_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"members" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "splits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"total_paise" integer NOT NULL,
	"category" text DEFAULT 'Other' NOT NULL,
	"date" text NOT NULL,
	"paid_by" text DEFAULT 'me' NOT NULL,
	"method" text DEFAULT 'equal' NOT NULL,
	"shares" jsonb NOT NULL,
	"my_paise" integer DEFAULT 0 NOT NULL,
	"transaction_id" uuid,
	"account_id" uuid,
	"reminder_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dues" ADD COLUMN "split_id" uuid;--> statement-breakpoint
-- One-off cleanup: "Collect ₹… from …" reminders of dues that are already settled
-- were showing up in today's lists (and the widget). Hide them.
UPDATE "reminders" SET "status" = 'archived' WHERE "id" IN (SELECT "reminder_id" FROM "dues" WHERE "settled_at" IS NOT NULL AND "reminder_id" IS NOT NULL);
