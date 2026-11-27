ALTER TABLE "autopays" ADD COLUMN "frequency" text DEFAULT 'monthly' NOT NULL;--> statement-breakpoint
ALTER TABLE "autopays" ADD COLUMN "month" integer;