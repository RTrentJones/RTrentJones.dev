-- Replays 0004's Polyphony relabel for rows posted after 0004 ran: a Polyphony evals run dispatched on
-- 2026-10-23 from a main that predated the new exporter still sent `env = ci-<book>` with no suite, so
-- it landed in the legacy series. Same statement as 0004, so it is idempotent, scoped to Polyphony's two
-- book envs, keeps the original env in labels.legacy_env, and changes no score or verdict. Polyphony's
-- exporter now sends suite=<book> on env ci, so no new legacy rows can appear.
UPDATE eval_run SET labels = coalesce(labels,'{}'::jsonb) || jsonb_build_object('legacy_env', env),
  suite = substring(env from '^ci-(dracula|frankenstein)$'), env = 'ci'
  WHERE tool = 'polyphony' AND suite IS NULL AND env IN ('ci-dracula','ci-frankenstein');
