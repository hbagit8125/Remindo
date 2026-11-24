ALTER TABLE "deliveries" ADD COLUMN "tg_chat_id" bigint;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "tg_message_id" integer;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "pushed" boolean DEFAULT false NOT NULL;