import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AssistantActionProposal } from "@triply/shared";
import AssistantProposalCard from "./AssistantProposalCard";
import i18n from "../../i18n";
const proposal = (): AssistantActionProposal => ({ proposalId: "p", tripId: "t", status: "pending", actions: [{ tool: "add_packing_item", domain: "packing", operation: { type: "create", itemId: "item", input: { name: "Umbrella", count: 1 } } }], changes: [{ tool: "add_packing_item", entityId: "item", label: "Umbrella", before: null, after: "Umbrella ×1" }], warnings: [], conflicts: [], days: [], baseItineraryVersion: 3, baseBudgetRevision: 0, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString() });
afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });
it("never executes on render and prevents double confirmation while pending", async () => {
  let done!: () => void;
  const confirm = vi.fn(() => new Promise<void>(resolve => { done = resolve; }));
  render(<AssistantProposalCard proposal={proposal()} disabled={false} onConfirm={confirm} onCancel={vi.fn()} />);
  expect(confirm).not.toHaveBeenCalled();
  const button = screen.getByRole("button", { name: "Confirm changes" });
  fireEvent.click(button); fireEvent.click(button);
  expect(confirm).toHaveBeenCalledExactlyOnceWith("p");
  await act(async () => done());
});
it("restores controls after network failure and supports retry", async () => {
  const confirm = vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce({});
  render(<AssistantProposalCard proposal={proposal()} disabled={false} onConfirm={confirm} onCancel={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Confirm changes" }));
  await screen.findByRole("alert");
  await waitFor(() => expect((screen.getByRole("button", { name: "Confirm changes" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Confirm changes" }));
  await waitFor(() => expect(confirm).toHaveBeenCalledTimes(2));
});
it("clears an uncertain transport error when a refreshed receipt proves completion", async () => {
  const confirm = vi.fn().mockRejectedValue(new Error("Lost committed response"));
  const p = proposal();
  const view = render(<AssistantProposalCard proposal={p} disabled={false} onConfirm={confirm} onCancel={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Confirm changes" }));
  await screen.findByRole("alert");
  view.rerender(<AssistantProposalCard proposal={{ ...p, status: "completed" }} disabled={false} onConfirm={confirm} onCancel={vi.fn()} />);
  expect(screen.getByRole("status").textContent).toContain("Changes saved");
  expect(screen.queryByRole("alert")).toBeNull();
});
it.each(["expired", "stale", "completed", "rejected", "failed"] as const)("blocks execution for %s proposals", status => {
  const p = proposal(); p.status = status;
  render(<AssistantProposalCard proposal={p} disabled={false} onConfirm={vi.fn()} onCancel={vi.fn()} />);
  expect(screen.queryByRole("button", { name: "Confirm changes" })).toBeNull();
});
it("uses local expiry and version checks and localizes controls without executing", async () => {
  const confirm = vi.fn(); const cancel = vi.fn();
  const view = render(<AssistantProposalCard proposal={proposal()} itineraryVersion={4} disabled={false} onConfirm={confirm} onCancel={cancel} />);
  expect((screen.getByRole("button", { name: "Confirm changes" }) as HTMLButtonElement).disabled).toBe(true);
  const expired = proposal(); expired.expiresAt = "2000-01-01";
  view.rerender(<AssistantProposalCard proposal={expired} disabled={false} onConfirm={confirm} onCancel={cancel} />);
  expect(screen.getByRole("status").textContent).toContain("expired");
  await act(() => i18n.changeLanguage("pl"));
  expect(screen.getByRole("button", { name: "Anuluj" })).toBeTruthy();
  expect(confirm).not.toHaveBeenCalled(); expect(cancel).not.toHaveBeenCalled();
});
