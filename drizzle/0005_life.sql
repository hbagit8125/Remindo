CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text DEFAULT 'other' NOT NULL,
	"name" text NOT NULL,
	"number" text,
	"expiry_date" text NOT NULL,
	"renewal_cost_paise" integer,
	"notes" text,
	"reminder_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "list_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"list_id" uuid NOT NULL,
	"text" text NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"emoji" text,
	"kind" text DEFAULT 'list' NOT NULL,
	"body" text,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "medicines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"dose" text,
	"times" text[] DEFAULT '{}' NOT NULL,
	"stock" integer,
	"per_dose" integer DEFAULT 1 NOT NULL,
	"refill_at" integer DEFAULT 5 NOT NULL,
	"refill_alert_sent_at" timestamp with time zone,
	"reminder_ids" uuid[] DEFAULT '{}' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"relation" text,
	"birthday" text,
	"birth_year" integer,
	"anniversary" text,
	"gift_budget_paise" integer,
	"gift_ideas" text,
	"notes" text,
	"birthday_reminder_id" uuid,
	"anniversary_reminder_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reminders" ADD COLUMN "meta" jsonb;--> statement-breakpoint
ALTER TABLE "list_items" ADD CONSTRAINT "list_items_list_id_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "list_items_list_idx" ON "list_items" USING btree ("list_id");