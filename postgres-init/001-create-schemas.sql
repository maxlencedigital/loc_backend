-- Runs once, the first time the Postgres volume is created.
--
-- One schema per service inside a single database. This is what keeps "no
-- service reads another's tables" a real boundary rather than a convention,
-- and it mirrors the hosted setup exactly: the free Supabase tier gives one
-- database, so the separation has to live at the schema level in both places.
--
-- Prisma Migrate would create a missing schema on its first run anyway. These
-- exist up front so a service can connect and report healthy before anyone
-- has applied a migration — otherwise a fresh `docker compose up` looks
-- broken until the migration step, which is a confusing first impression.

CREATE SCHEMA IF NOT EXISTS gateway;
CREATE SCHEMA IF NOT EXISTS commerce;
CREATE SCHEMA IF NOT EXISTS logistics;
CREATE SCHEMA IF NOT EXISTS finance;
CREATE SCHEMA IF NOT EXISTS growth;
