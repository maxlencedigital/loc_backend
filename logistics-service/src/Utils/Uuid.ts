const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A malformed id never reaches Postgres, whose uuid column would answer with a 500.
export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
