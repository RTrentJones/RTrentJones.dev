-- "Trended, not gated" + legacy relabels. `gating` (default true) lets a producer mark a feed as tracked
-- only: it trends on the dashboard but never fails a project, badge or attention list. A constant
-- default is metadata-only on PG >= 11, so existing rows read `true` without a rewrite.
-- The UPDATEs fold legacy producer labels into today's series keys, keeping the original value in
-- `labels` (version / legacy_env / legacy_model). Each is scoped by tool and guarded so a second run is a
-- no-op; none touches passed, pass_rate, score or cases, and nothing is deleted.
ALTER TABLE "eval_run" ADD COLUMN IF NOT EXISTS "gating" boolean DEFAULT true NOT NULL;--> statement-breakpoint
-- pg_kafka: one series across releases (the release version was sent as the model).
UPDATE eval_run SET labels = coalesce(labels,'{}'::jsonb) || jsonb_build_object('version', model), model = 'pg_kafka'
  WHERE tool = 'pg_kafka' AND model <> 'pg_kafka';--> statement-breakpoint
-- Polyphony: the old `ci-<book>` env labels become suite <book> on env ci.
UPDATE eval_run SET labels = coalesce(labels,'{}'::jsonb) || jsonb_build_object('legacy_env', env),
  suite = substring(env from '^ci-(dracula|frankenstein)$'), env = 'ci'
  WHERE tool = 'polyphony' AND suite IS NULL AND env IN ('ci-dracula','ci-frankenstein');--> statement-breakpoint
-- Tracer dogfood: verify runs carried no model.
UPDATE eval_run SET labels = coalesce(labels,'{}'::jsonb) || jsonb_build_object('legacy_model', model), model = 'greenlight-verify'
  WHERE tool = 'tracer' AND mode = 'api+test' AND model = 'unknown';
