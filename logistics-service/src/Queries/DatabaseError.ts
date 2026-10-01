// Translates driver error shapes into questions the service layer can ask, so
// services stay ignorant of the ORM. All ORM-specific error handling lives here.

/** Prisma's error code for "unique constraint failed". */
const UNIQUE_VIOLATION = "P2002";

interface PrismaKnownError {
  code?: string;
  message?: string;
  meta?: {
    target?: unknown;
    // Present with a driver adapter (what this service uses), instead of `target`.
    driverAdapterError?: { cause?: { constraint?: { index?: string; fields?: unknown } } };
  };
}

// Every place Prisma may name the violated constraint. The classic engine fills
// `meta.target`; the pg driver adapter leaves it undefined and puts the index name in
// `driverAdapterError.cause.constraint` (and in the message). Reading only `target`
// made a duplicate phone number come back as a 500 instead of a 409.
const constraintNames = (error: PrismaKnownError): string[] => {
  const names: string[] = [];
  const add = (value: unknown) => {
    if (Array.isArray(value)) value.forEach((v) => names.push(String(v)));
    else if (typeof value === "string") names.push(value);
  };
  add(error.meta?.target);
  const constraint = error.meta?.driverAdapterError?.cause?.constraint;
  add(constraint?.index);
  add(constraint?.fields);
  const fromMessage = /constraint: `([^`]+)`/.exec(error.message ?? "")?.[1];
  add(fromMessage);
  return names;
};

// True when the write would have duplicated a unique value. `field` narrows it to one
// column, since a user is unique on both email and phone number.
export const isUniqueViolation = (error: unknown, field?: string): boolean => {
  const known = error as PrismaKnownError | null;
  if (known?.code !== UNIQUE_VIOLATION) return false;
  if (!field) return true;

  return constraintNames(known).some((name) => name.toLowerCase().includes(field.toLowerCase()));
};
