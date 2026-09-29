// Translates driver error shapes into questions the service layer can ask, so
// services stay ignorant of the ORM. All ORM-specific error handling lives here.

/** Prisma's error code for "unique constraint failed". */
const UNIQUE_VIOLATION = "P2002";

interface PrismaKnownError {
  code?: string;
  meta?: { target?: unknown; modelName?: string };
}

// True when the write would have duplicated a unique value. `field` narrows it
// to one column, since a user is unique on both email and phone number, and
// Prisma reports `meta.target` as either a field list or an index name.
export const isUniqueViolation = (error: unknown, field?: string): boolean => {
  const known = error as PrismaKnownError | null;
  if (known?.code !== UNIQUE_VIOLATION) return false;
  if (!field) return true;

  const target = known.meta?.target;
  const targets = Array.isArray(target)
    ? target.map(String)
    : typeof target === "string"
      ? [target]
      : [];

  return targets.some((entry) => entry.toLowerCase().includes(field.toLowerCase()));
};
