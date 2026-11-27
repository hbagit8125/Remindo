ALTER TABLE "savings" ADD COLUMN "interest_freq" text;--> statement-breakpoint
ALTER TABLE "savings" ADD COLUMN "interest_account_id" uuid;--> statement-breakpoint
ALTER TABLE "savings" ADD COLUMN "interest_from" text;--> statement-breakpoint
ALTER TABLE "savings" ADD COLUMN "last_interest_date" text;