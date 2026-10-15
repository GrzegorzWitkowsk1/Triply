import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useIdentityMutation } from "./useIdentityMutation";

afterEach(cleanup);
it.each([false, true])("suppresses a late mutation callback and optimistic rollback after an identity switch (failure=%s)", async failure => {
  const client = new QueryClient();
  client.setQueryData(["auth", "session"], { status: "guest", guest: { id: "a" } });
  let complete!: () => void;
  const success = vi.fn(() => client.setQueryData(["trips", "old"], "private itinerary"));
  const rollback = vi.fn(() => client.setQueryData(["trips", "old"], "old optimistic snapshot"));
  const settled = vi.fn();
  function Probe() {
    const mutation = useIdentityMutation({
      mutationFn: () => new Promise<string>((resolve, reject) => { complete = () => failure ? reject(new Error("provider failed")) : resolve("old response"); }),
      onSuccess: success, onError: rollback, onSettled: settled,
    });
    return <><button onClick={() => mutation.mutate()}>Generate</button><p>{mutation.status}</p></>;
  }
  render(<QueryClientProvider client={client}><Probe /></QueryClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Generate" }));
  await waitFor(() => expect(complete).toBeTypeOf("function"));
  client.setQueryData(["auth", "session"], { status: "authenticated", user: { id: "b" } });
  complete();
  await screen.findByText(failure ? "error" : "success");
  expect(success).not.toHaveBeenCalled(); expect(rollback).not.toHaveBeenCalled(); expect(settled).not.toHaveBeenCalled();
  expect(client.getQueryData(["trips", "old"])).toBeUndefined(); client.clear();
});

it("retains callbacks and rollback data for the identity that started the operation", async () => {
  const client = new QueryClient();
  client.setQueryData(["auth", "session"], { status: "guest", guest: { id: "a" } });
  const success = vi.fn();
  function Probe() {
    const mutation = useIdentityMutation({ mutationFn: async () => "saved", onMutate: () => ({ previous: "snapshot" }), onSuccess: success });
    return <button onClick={() => mutation.mutate()}>Save</button>;
  }
  render(<QueryClientProvider client={client}><Probe /></QueryClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(success).toHaveBeenCalledWith("saved", undefined, { previous: "snapshot" }, expect.any(Object)));
  client.clear();
});
