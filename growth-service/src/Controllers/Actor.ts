import { IdentifiedRequest } from "../Middleware/Identity.js";

// requireIdentity has already run on every route that reads this, so the user is set.
export const actorId = (req: IdentifiedRequest): string => (req.user as { id: string }).id;
