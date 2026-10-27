CREATE TABLE "deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"decision_id" text NOT NULL,
	"verdict_nonce" text NOT NULL,
	"supersedes_id" text,
	"mandate_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"amount" bigint NOT NULL,
	"recipient" text NOT NULL,
	"resource" text NOT NULL,
	"verdict_token" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"tx_hash" text,
	"payer" text,
	"failure" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "deliveries_verdict_nonce_unique" UNIQUE("verdict_nonce"),
	CONSTRAINT "deliveries_status_valid" CHECK ("deliveries"."status" in ('pending', 'settled', 'failed')),
	CONSTRAINT "deliveries_amount_positive" CHECK ("deliveries"."amount" > 0),
	CONSTRAINT "deliveries_completed_at_iff_completed" CHECK (("deliveries"."status" = 'pending') = ("deliveries"."completed_at" is null)),
	CONSTRAINT "deliveries_tx_hash_iff_settled" CHECK (("deliveries"."status" = 'settled') = ("deliveries"."tx_hash" is not null)),
	CONSTRAINT "deliveries_failure_iff_failed" CHECK (("deliveries"."status" = 'failed') = ("deliveries"."failure" is not null)),
	CONSTRAINT "deliveries_tx_hash_format" CHECK ("deliveries"."tx_hash" ~ '^0x[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE INDEX "deliveries_decision" ON "deliveries" USING btree ("decision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_supersedes_once" ON "deliveries" USING btree ("supersedes_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_tx_hash_once" ON "deliveries" USING btree ("tx_hash");