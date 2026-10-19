import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { IdentitySession } from "@triply/shared";
import { AuthProvider, useAuth } from "./AuthProvider";
import { RequireAuth } from "./RouteGuards";
import { MemoryRouter } from "react-router-dom";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("remounts private forms after account switching and never renders the previous account's cached trips", async () => {
  let session: IdentitySession = { status: "authenticated", user: { id: "a", email: "a@example.com" } };
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(session))));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const renders: string[] = [];
  function PrivateForm() {
    const { user } = useAuth();
    const [draft, setDraft] = useState("");
    const trips = useQuery({ queryKey: ["trips"], queryFn: async () => `trips-${user!.id}`, staleTime: Infinity });
    renders.push(`${user?.id}:${trips.data}`);
    return <><input aria-label="Private draft" value={draft} onChange={e => setDraft(e.target.value)} /><p>{trips.data}</p></>;
  }
  function Shell() {
    const auth = useAuth();
    return <><button onClick={() => void auth.refetchSession()}>Switch</button><RequireAuth><PrivateForm /></RequireAuth></>;
  }
  render(<QueryClientProvider client={client}><AuthProvider><MemoryRouter><Shell /></MemoryRouter></AuthProvider></QueryClientProvider>);
  await screen.findByText("trips-a");
  fireEvent.change(screen.getByLabelText("Private draft"), { target: { value: "private notes from A" } });
  session = { status: "authenticated", user: { id: "b", email: "b@example.com" } };
  fireEvent.click(screen.getByRole("button", { name: "Switch" }));
  await screen.findByText("trips-b");
  expect((screen.getByLabelText("Private draft") as HTMLInputElement).value).toBe("");
  expect(renders).not.toContain("b:trips-a");
  client.clear();
});
it.each(["guest", "authenticated"] as const)("clears private caches and cancels old responses when %s identity changes in another tab", async status => {
  let session: IdentitySession = status === "guest"
    ? { status, guest: { id: "guest-a", expiresAt: "2030-01-01T00:00:00Z" } }
    : { status, user: { id: "user-a", email: "a@example.com" } };
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(session))));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Probe() {
    const auth = useAuth();
    return <><p>{auth.guest?.id ?? auth.user?.id ?? auth.status}</p><button onClick={() => void auth.refetchSession()}>Restore session</button></>;
  }
  render(<QueryClientProvider client={client}><AuthProvider><Probe /></AuthProvider></QueryClientProvider>);
  await screen.findByText(status === "guest" ? "guest-a" : "user-a");
  client.setQueryData(["trips"], [{ id: "old-private-trip" }]);
  client.setQueryData(["guest", "usage"], { tripCount: 6 });
  client.setQueryData(["saved", status === "guest" ? "guest:guest-a" : "user:user-a", "list"], { destinations: [{ destinationId: "city-001" }] });
  let finish!: (data: string[]) => void;
  const pending = client.fetchQuery({ queryKey: ["tripSharing", "old-trip"], queryFn: () => new Promise<string[]>(resolve => { finish = resolve; }) }).catch(() => undefined);
  session = { status: "authenticated", user: { id: "user-b", email: "b@example.com" } };
  fireEvent.click(screen.getByRole("button", { name: "Restore session" }));
  await screen.findByText("user-b");
  await waitFor(() => expect(client.getQueryData(["trips"])).toBeUndefined());
  expect(client.getQueryData(["guest", "usage"])).toBeUndefined();
  expect(client.getQueriesData({ queryKey: ["saved"] })).toEqual([]);
  finish(["late-private-response"]); await pending;
  expect(client.getQueryData(["tripSharing", "old-trip"])).toBeUndefined();
  expect(client.getQueryData(["auth", "session"])).toEqual(session);
  client.clear();
});
