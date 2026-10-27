CREATE TABLE "chain_cursors" (
	"stream" text PRIMARY KEY NOT NULL,
	"last_block" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chain_cursors_last_block_valid" CHECK ("chain_cursors"."last_block" >= 0)
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"from_address" text NOT NULL,
	"to_address" text NOT NULL,
	"value" bigint NOT NULL,
	"authorization_nonce" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlements_pkey" PRIMARY KEY("tx_hash","log_index"),
	CONSTRAINT "settlements_tx_hash_format" CHECK ("settlements"."tx_hash" ~ '^0x[0-9a-f]{64}$'),
	CONSTRAINT "settlements_authorization_nonce_format" CHECK ("settlements"."authorization_nonce" ~ '^0x[0-9a-f]{64}$'),
	CONSTRAINT "settlements_value_not_negative" CHECK ("settlements"."value" >= 0),
	CONSTRAINT "settlements_position_valid" CHECK ("settlements"."log_index" >= 0 and "settlements"."block_number" >= 0)
);
--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "authorization_nonce" text;--> statement-breakpoint
CREATE INDEX "settlements_authorization_nonce" ON "settlements" USING btree ("authorization_nonce");--> statement-breakpoint
CREATE INDEX "deliveries_authorization_nonce" ON "deliveries" USING btree ("authorization_nonce");--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_authorization_nonce_format" CHECK ("deliveries"."authorization_nonce" ~ '^0x[0-9a-f]{64}$');