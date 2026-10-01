import { Prisma } from "@prisma/client";
import { DB_SCHEMA } from "../DB/DatabaseUrl.js";

// Raw SQL does not get the per-service schema the driver adapter applies to Prisma models,
// so raw queries name their tables with the schema. It comes from the environment, so it is
// checked to be a plain identifier before it is ever placed in SQL text.
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
if (!IDENTIFIER.test(DB_SCHEMA)) throw new Error("DB_SCHEMA is not a valid identifier.");

/** A schema-qualified table name for use inside Prisma.sql. `table` is always a literal in code. */
export const qualified = (table: string): Prisma.Sql => Prisma.raw(`"${DB_SCHEMA}"."${table}"`);
