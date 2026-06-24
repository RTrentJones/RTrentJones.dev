-- Plain SQL migrations are the app's source of truth for the schema, applied by scripts/migrate.mjs
-- on each build (against DIRECT_URL → the env's branch). They compose with `greenlight migrations
-- scan` (the dangerous-SQL gate). Swap in Drizzle/Prisma migrations if you prefer — same convention.
CREATE TABLE IF NOT EXISTS notes (
  id         serial PRIMARY KEY,
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO notes (body) VALUES ('hello from Neon');
