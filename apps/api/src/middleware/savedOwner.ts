import { currentTripOwner, guestOwnerId } from "./tripIdentity.js";

export function currentSavedOwner(req: Parameters<typeof currentTripOwner>[0]) {
  const identity = currentTripOwner(req);
  const guest = guestOwnerId(identity);
  return { ownerType: guest ? "guest" : "user", ownerId: guest ?? identity };
}
