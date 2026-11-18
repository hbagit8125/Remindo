CREATE TABLE "completions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reminder_id" uuid NOT NULL,
	"occurrence_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reminder_id" uuid NOT NULL,
	"occurrence_at" timestamp with time zone NOT NULL,
	"alert_at" timestamp with time zone NOT NULL,
	"lead_minutes" integer DEFAULT 0 NOT NULL,
	"kind" text DEFAULT 'alert' NOT NULL,
	"dedupe_key" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"qstash_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"due_at" timestamp with time zone NOT NULL,
	"all_day" boolean DEFAULT false NOT NULL,
	"rrule" text,
	"priority" text DEFAULT 'normal' NOT NULL,
	"category" text,
	"lead_times" integer[] DEFAULT '{0}' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"input" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "completions" ADD CONSTRAINT "completions_reminder_id_reminders_id_fk" FOREIGN KEY ("reminder_id") REFERENCES "public"."reminders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_reminder_id_reminders_id_fk" FOREIGN KEY ("reminder_id") REFERENCES "public"."reminders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "completions_occ_idx" ON "completions" USING btree ("reminder_id","occurrence_at");--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_dedupe_idx" ON "deliveries" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "deliveries_status_alert_idx" ON "deliveries" USING btree ("status","alert_at");--> statement-breakpoint
CREATE INDEX "deliveries_reminder_occ_idx" ON "deliveries" USING btree ("reminder_id","occurrence_at");--> statement-breakpoint
CREATE INDEX "reminders_status_idx" ON "reminders" USING btree ("status");