CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'enabled' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agents_id_format" CHECK ("agents"."id" ~ '^agt_[a-z0-9_]{1,64}$'),
	CONSTRAINT "agents_status_valid" CHECK ("agents"."status" in ('enabled', 'disabled'))
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"recipient" text NOT NULL,
	"category" text NOT NULL,
	"protocol" text,
	"verdict" text NOT NULL,
	"reason" text NOT NULL,
	"mandate_id" text,
	"policy_version" text NOT NULL,
	"nonce" text NOT NULL,
	"mode" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"verdict_token" text NOT NULL,
	"supersedes_id" text,
	CONSTRAINT "decisions_nonce_unique" UNIQUE("nonce"),
	CONSTRAINT "decisions_verdict_valid" CHECK ("decisions"."verdict" in ('deny_no_mandate', 'deny_revoked', 'deny_expired', 'deny_category', 'deny_limit', 'deny_velocity', 'review', 'allow')),
	CONSTRAINT "decisions_mode_valid" CHECK ("decisions"."mode" in ('observe', 'enforce')),
	CONSTRAINT "decisions_protocol_valid" CHECK ("decisions"."protocol" is null or "decisions"."protocol" in ('x402', 'mpp', 'acp', 'ap2', 'card')),
	CONSTRAINT "decisions_amount_positive" CHECK ("decisions"."amount" > 0),
	CONSTRAINT "decisions_mandate_iff_not_no_mandate" CHECK (("decisions"."verdict" = 'deny_no_mandate') = ("decisions"."mandate_id" is null)),
	CONSTRAINT "decisions_supersedes_only_on_allow" CHECK ("decisions"."supersedes_id" is null or "decisions"."verdict" = 'allow')
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"key" text PRIMARY KEY NOT NULL,
	"request_hash" text NOT NULL,
	"decision_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_key_length" CHECK (length("idempotency_keys"."key") between 1 and 255)
);
--> statement-breakpoint
CREATE TABLE "mandates" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"principal" text NOT NULL,
	"per_transaction" bigint NOT NULL,
	"per_month" bigint NOT NULL,
	"currency" text NOT NULL,
	"categories" text[] NOT NULL,
	"review_above" bigint,
	"expires" date NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"revoked_at" timestamp with time zone,
	"replaces_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mandates_status_valid" CHECK ("mandates"."status" in ('active', 'revoked')),
	CONSTRAINT "mandates_revoked_at_iff_revoked" CHECK (("mandates"."status" = 'revoked') = ("mandates"."revoked_at" is not null)),
	CONSTRAINT "mandates_limits_positive" CHECK ("mandates"."per_transaction" > 0 and "mandates"."per_month" > 0),
	CONSTRAINT "mandates_per_transaction_within_month" CHECK ("mandates"."per_transaction" <= "mandates"."per_month"),
	CONSTRAINT "mandates_review_above_positive" CHECK ("mandates"."review_above" is null or "mandates"."review_above" > 0),
	CONSTRAINT "mandates_currency_format" CHECK ("mandates"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "mandates_has_categories" CHECK (cardinality("mandates"."categories") >= 1),
	CONSTRAINT "mandates_principal_length" CHECK (length("mandates"."principal") between 1 and 128)
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"decision_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_decision_id_unique" UNIQUE("decision_id"),
	CONSTRAINT "reviews_status_valid" CHECK ("reviews"."status" in ('pending', 'approved', 'denied')),
	CONSTRAINT "reviews_resolved_at_iff_resolved" CHECK (("reviews"."status" = 'pending') = ("reviews"."resolved_at" is null))
);
--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_mandate_id_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."mandates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_supersedes_id_decisions_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_decision_id_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_replaces_id_mandates_id_fk" FOREIGN KEY ("replaces_id") REFERENCES "public"."mandates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_decision_id_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decisions_agent_issued_at" ON "decisions" USING btree ("agent_id","issued_at");--> statement-breakpoint
CREATE UNIQUE INDEX "decisions_supersedes_once" ON "decisions" USING btree ("supersedes_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mandates_one_active_per_agent_currency" ON "mandates" USING btree ("agent_id","currency") WHERE status = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "mandates_replaced_once" ON "mandates" USING btree ("replaces_id");