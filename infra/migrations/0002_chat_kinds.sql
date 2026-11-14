ALTER TABLE "messages" DROP CONSTRAINT "messages_body_length";--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "kind" text DEFAULT 'TEXT' NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "kind" text DEFAULT 'SYSTEM' NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_kind_check" CHECK ("messages"."kind" IN ('TEXT', 'CONTACT', 'SYSTEM'));--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_body_length" CHECK (char_length("messages"."body") BETWEEN 1 AND 2000);