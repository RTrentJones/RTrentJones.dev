-- Retire the old "notes from Neon" scaffold table; "/" now renders eval data.
DROP TABLE IF EXISTS "notes"; -- greenlight:allow (intentional: scaffold table, no real data)
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "eval_case" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"name" text NOT NULL,
	"input" text,
	"expected" text,
	"output" text,
	"score" real,
	"passed" boolean NOT NULL,
	"judge_rationale" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "eval_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tool" text NOT NULL,
	"model" text NOT NULL,
	"mode" text NOT NULL,
	"env" text NOT NULL,
	"git_sha" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"duration_ms" integer,
	"cost_usd" numeric(10, 4),
	"tokens_in" integer,
	"tokens_out" integer,
	"passed" boolean NOT NULL,
	"pass_rate" real
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "eval_case" ADD CONSTRAINT "eval_case_run_id_eval_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."eval_run"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_eval_case_run" ON "eval_case" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_eval_run_tool_model_started" ON "eval_run" USING btree ("tool","model","started_at" DESC NULLS LAST);