import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import LoginPage from "./LoginPage";

const mocks = vi.hoisted(() => ({ startGuest: vi.fn(async () => ({})), login: vi.fn(async () => ({})), register: vi.fn(async () => ({})) }));
vi.mock("../auth/AuthProvider", () => ({ useAuth: () => ({ ...mocks, isSubmitting: false, sessionExpired: false }) }));
function Home() { const location = useLocation(); return <output data-testid="destination">{location.pathname}{location.search}</output>; }
function mount(returnTo = true) {
  return render(<MemoryRouter initialEntries={[{ pathname: "/login", state: returnTo ? { from: { pathname: "/home", search: "?destinationId=city-003" } } : undefined }]}><Routes>
    <Route path="/login" element={<LoginPage mode="login" />} /><Route path="/register" element={<LoginPage mode="register" />} /><Route path="/home" element={<Home />} />
  </Routes></MemoryRouter>);
}
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("preserves the selected destination when switching auth tabs and entering Guest Mode", async () => {
  mount(); expect(mocks.startGuest).not.toHaveBeenCalled();
  fireEvent.click(within(screen.getByRole("group", { name: "Auth view" })).getByRole("button", { name: "Register" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue as guest" }));
  expect(await screen.findByTestId("destination")).toHaveTextContent("/home?destinationId=city-003");
  expect(mocks.startGuest).toHaveBeenCalledTimes(1);
});
it("returns authenticated users to the planning URL after switching tabs", async () => {
  const view = mount();
  fireEvent.click(within(screen.getByRole("group", { name: "Auth view" })).getByRole("button", { name: "Register" }));
  fireEvent.click(within(screen.getByRole("group", { name: "Auth view" })).getByRole("button", { name: "Sign in" }));
  fireEvent.change(screen.getByRole("textbox", { name: /Email address/ }), { target: { value: "planner@example.com" } });
  fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: "Original123!Aa" } });
  fireEvent.submit(view.container.querySelector("form")!);
  expect(await screen.findByTestId("destination")).toHaveTextContent("/home?destinationId=city-003");
});
it("retains the usual Home fallback for Guest Mode without a return URL", async () => {
  mount(false); fireEvent.click(screen.getByRole("button", { name: "Continue as guest" }));
  expect(await screen.findByTestId("destination")).toHaveTextContent("/home");
});
