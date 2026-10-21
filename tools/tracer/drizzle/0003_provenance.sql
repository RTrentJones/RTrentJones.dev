-- Provenance + metrics (all nullable, additive): suite/repo/branch/source_url/labels let a run say
-- where it came from, and run/case `metrics` carry numeric results (F1, msgs/s, …) beside pass/fail.
-- category groups cases within a run. No backfill: existing rows read as "unknown provenance".
ALTER TABLE "eval_case" ADD COLUMN IF NOT EXISTS "category" text;--> statement-breakpoint
ALTER TABLE "eval_case" ADD COLUMN IF NOT EXISTS "metrics" jsonb;--> statement-breakpoint
ALTER TABLE "eval_run" ADD COLUMN IF NOT EXISTS "suite" text;--> statement-breakpoint
ALTER TABLE "eval_run" ADD COLUMN IF NOT EXISTS "repo" text;--> statement-breakpoint
ALTER TABLE "eval_run" ADD COLUMN IF NOT EXISTS "branch" text;--> statement-breakpoint
ALTER TABLE "eval_run" ADD COLUMN IF NOT EXISTS "source_url" text;--> statement-breakpoint
ALTER TABLE "eval_run" ADD COLUMN IF NOT EXISTS "metrics" jsonb;--> statement-breakpoint
ALTER TABLE "eval_run" ADD COLUMN IF NOT EXISTS "labels" jsonb;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_eval_run_tool_started" ON "eval_run" USING btree ("tool","started_at" DESC NULLS LAST);