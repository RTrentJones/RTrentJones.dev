-- Remove the legacy demo rows that earlier deployments inserted via 0001_seed.sql.
-- The predicates below match only the seeded portfolio fixtures: short fake git SHAs, fixed tool/model
-- combinations, and the exact synthetic case names used by that migration. Real ingested data is left
-- intact, including other project types such as pg_kafka.
WITH seeded_runs AS (
  SELECT id
  FROM eval_run
  WHERE (tool, model, mode, env, git_sha, pass_rate) IN (
    ('tracer', 'claude-opus-4-8', 'eval', 'prod', 'a1b2c3d', 0.95::real),
    ('tracer', 'claude-opus-4-8', 'eval', 'prod', 'd4e5f6a', 0.80::real),
    ('tracer', 'claude-sonnet-4-6', 'eval', 'prod', 'd4e5f6a', 0.90::real),
    ('tracer', 'claude-haiku-4-5', 'eval', 'prod', 'd4e5f6a', 0.80::real),
    ('bamcp', 'claude-opus-4-8', 'agent-web', 'prod', 'd4e5f6a', 1.00::real)
  )
  AND EXISTS (
    SELECT 1
    FROM eval_case c
    WHERE c.run_id = eval_run.id
      AND c.name IN (
        'summarize-changelog',
        'classify-sentiment',
        'extract-json',
        'refuse-unsafe',
        'tools-listed',
        'auth-required'
      )
  )
)
DELETE FROM eval_run
WHERE id IN (SELECT id FROM seeded_runs);
