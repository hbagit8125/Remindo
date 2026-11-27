ALTER TABLE "accounts" ADD COLUMN "credit_limit_paise" integer;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "statement_day" integer;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "due_day" integer;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "pay_from_id" uuid;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "reminder_id" uuid;