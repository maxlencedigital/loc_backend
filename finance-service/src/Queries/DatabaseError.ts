// P2002 is Prisma's unique-constraint violation. Error-shape knowledge lives only here, and this
// file imports nothing so any layer can use it without loading the database client.
export const isUniqueViolation = (error: unknown): boolean =>
  typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
