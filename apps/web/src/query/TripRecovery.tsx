import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { installTripRecovery } from "./recovery";

export function TripRecovery() {
  const client = useQueryClient();
  useEffect(() => installTripRecovery(client), [client]);
  return null;
}
