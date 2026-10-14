import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ProfileUser } from "@triply/shared";
import ProfilePage from "./ProfilePage";
import { ToastProvider } from "../components/ToastProvider";
const mocks = vi.hoisted(() => ({ user: {} as ProfileUser, updateUser: vi.fn(), saveNames: vi.fn(), upload: vi.fn(), savePreferences: vi.fn(), password: vi.fn() }));
vi.mock("../auth/AuthProvider", () => ({ useAuth: () => ({ user: mocks.user, updateUser: mocks.updateUser }) }));
vi.mock("../api/profile", () => ({ saveProfileNames: mocks.saveNames, uploadAvatar: mocks.upload, saveProfilePreferences: mocks.savePreferences, changePassword: mocks.password }));
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear();
  mocks.user = { id: "user", email: "test@example.com", name: "Anna", surname: "", avatar: null, preferences: { interests: ["culture"], pace: "relaxed", maxWalkingDistanceKm: 3 } };
  mocks.saveNames.mockResolvedValue(mocks.user); mocks.upload.mockResolvedValue({ ...mocks.user, avatar: "data:image/png;base64,AAAA" });
  mocks.savePreferences.mockResolvedValue(mocks.user); mocks.password.mockResolvedValue(undefined);
});
afterEach(cleanup);
function page() { return render(<ToastProvider><ProfilePage /></ToastProvider>); }
describe("profile settings", () => {
  it("saves only the changed name and keeps email readonly", async () => {
    page();
    expect((screen.getByLabelText("Email") as HTMLInputElement).readOnly).toBe(true);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Jo" } });
    const profileForm = screen.getByLabelText("Name").closest("form")!;
    await waitFor(() => expect((within(profileForm).getByText("Save") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(within(profileForm).getByText("Save"));
    await waitFor(() => expect(mocks.saveNames).toHaveBeenCalledWith({ name: "Jo" }));
    expect(await screen.findByText("Profile saved.")).toBeTruthy();
  });
  it("uploads an avatar on selection without submitting the names form", async () => {
    const { container } = page();
    const file = new File(["image"], "avatar.png", { type: "image/png" });
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledWith(file));
    expect(mocks.saveNames).not.toHaveBeenCalled();
    expect(await screen.findByText("Avatar updated.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /remove avatar/i })).toBeNull();
  });
  it("rejects oversized uploads and displays API upload errors", async () => {
    const { container } = page();
    const input = container.querySelector('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [new File([new Uint8Array(2 * 1024 * 1024 + 1)], "large.png", { type: "image/png" })] } });
    expect(screen.getByText(/Maximum size is 2 MB/)).toBeTruthy();
    expect(mocks.upload).not.toHaveBeenCalled();
    mocks.upload.mockRejectedValue(new Error("Invalid image."));
    fireEvent.change(input, { target: { files: [new File(["bad"], "bad.png", { type: "image/png" })] } });
    await waitFor(() => expect(screen.getAllByText("Invalid image.").length).toBe(2));
  });
  it("requires matching new passwords, asks for current password and allows retry after rejection", async () => {
    page();
    const newInput = screen.getByLabelText(/^New password/);
    const repeat = screen.getByLabelText(/^Repeat password/);
    fireEvent.change(newInput, { target: { value: "Changed123!Aa" } });
    fireEvent.change(repeat, { target: { value: "Mismatch123!Aa" } });
    expect(await screen.findByText("Passwords do not match")).toBeTruthy();
    fireEvent.change(repeat, { target: { value: "Changed123!Aa" } });
    await waitFor(() => expect((screen.getByText("Change password") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByText("Change password"));
    const dialog = await screen.findByRole("dialog");
    expect((within(dialog).getByText("Confirm") as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.password).not.toHaveBeenCalled();
    mocks.password.mockRejectedValueOnce(new Error("Current password is incorrect."));
    fireEvent.change(within(dialog).getByLabelText(/^Current password/), { target: { value: "Wrong123!Aa" } });
    fireEvent.click(within(dialog).getByText("Confirm"));
    expect(await within(dialog).findByText("Current password is incorrect.")).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/^Current password/), { target: { value: "Original123!Aa" } });
    fireEvent.click(within(dialog).getByText("Confirm"));
    await waitFor(() => expect(mocks.password).toHaveBeenLastCalledWith({ currentPassword: "Original123!Aa", newPassword: "Changed123!Aa", repeatPassword: "Changed123!Aa" }));
    expect(await screen.findByText("Password changed.")).toBeTruthy();
    expect((newInput as HTMLInputElement).value).toBe("");
  });
  it("loads profile preferences and saves the selected options", async () => {
    page();
    expect(screen.getByRole("button", { name: "Culture" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Relaxed" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Food" }));
    fireEvent.click(screen.getByRole("button", { name: "Packed" }));
    fireEvent.click(screen.getByRole("button", { name: "High" }));
    const form = screen.getByRole("button", { name: "Food" }).closest("form")!;
    fireEvent.click(within(form).getByText("Save"));
    await waitFor(() => expect(mocks.savePreferences).toHaveBeenCalledWith({ interests: ["culture", "food"], pace: "packed", maxWalkingDistanceKm: 10 }));
  });
  it("preserves unsaved preferences when the same session is refetched", () => {
    const view = page();
    fireEvent.click(screen.getByRole("button", { name: "Packed" }));
    mocks.user = { ...mocks.user, preferences: { ...mocks.user.preferences!, interests: [...mocks.user.preferences!.interests] } };
    view.rerender(<ToastProvider><ProfilePage /></ToastProvider>);
    expect(screen.getByRole("button", { name: "Packed" }).getAttribute("aria-pressed")).toBe("true");
  });
  it("persists application language across remounts", () => {
    const first = page();
    fireEvent.mouseDown(screen.getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: "English" }));
    expect(localStorage.getItem("triply.language")).toBe("en");
    first.unmount(); page();
    expect(screen.getByRole("combobox").textContent).toContain("English");
  });
});
