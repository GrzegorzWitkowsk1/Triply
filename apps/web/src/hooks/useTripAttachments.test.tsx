import { act, renderHook, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ATTACHMENT_LIMITS as L } from "@triply/shared";
import { useTripAttachments } from "./useTripAttachments";
afterEach(cleanup);
const txt = (name = "preferences.txt", text = "Rome") => new File([text], name, { type: "text/plain", lastModified: 123 });
describe("trip attachment selection", () => {
  it("accepts TXT/PDF and exposes files and readable sizes", () => {
    const { result } = renderHook(useTripAttachments); const files = [txt(), new File(["%PDF-1.7"], "places.pdf", { type: "application/pdf" })];
    act(() => result.current.pick(files)); expect(result.current.files).toEqual(files); expect(result.current.blocked).toBe(false); expect(result.current.entries[0].file.size).toBe(4);
  });
  it.each([
    [new File(["image"], "photo.png", { type: "image/png" }), "ATTACHMENT_FORMAT"],
    [txt("empty.txt", ""), "ATTACHMENT_EMPTY"],
    [new File([new Uint8Array(L.txtBytes + 1)], "big.txt", { type: "text/plain" }), "ATTACHMENT_SIZE"],
    [new File([new Uint8Array(L.pdfBytes + 1)], "big.pdf", { type: "application/pdf" }), "ATTACHMENT_SIZE"],
  ] as const)("retains invalid selections with blocking errors", (file, code) => {
    const { result } = renderHook(useTripAttachments); act(() => result.current.pick([file]));
    expect(result.current.entries[0].error).toBe(code); expect(result.current.blocked).toBe(true);
    act(() => result.current.remove(result.current.entries[0].id)); expect(result.current.blocked).toBe(false);
  });
  it("detects duplicates without adding another copy", () => {
    const { result } = renderHook(useTripAttachments); act(() => result.current.pick([txt(), txt()]));
    expect(result.current.entries).toHaveLength(1); expect(result.current.notice).toBe("ATTACHMENT_DUPLICATE");
  });
  it("blocks a fourth file while preserving the first three", () => {
    const { result } = renderHook(useTripAttachments); act(() => result.current.pick([txt("1.txt"), txt("2.txt"), txt("3.txt"), txt("4.txt")]));
    expect(result.current.entries[3].error).toBe("ATTACHMENT_COUNT"); expect(result.current.entries.slice(0, 3).every(e => e.error === null)).toBe(true);
  });
  it("enforces aggregate size even when each PDF is allowed", () => {
    const { result } = renderHook(useTripAttachments); const files = [1, 2, 3].map(i => new File([new Uint8Array(4 * 1024 * 1024)], `${i}.pdf`, { type: "application/pdf" }));
    act(() => result.current.pick(files)); expect(result.current.entries[2].error).toBe("ATTACHMENT_TOTAL_SIZE");
  });
  it("associates server errors with individual files and removal enables retry", () => {
    const { result } = renderHook(useTripAttachments); act(() => result.current.pick([txt("good.txt"), txt("bad.txt")]));
    act(() => result.current.fail([{ index: 1, code: "ATTACHMENT_SCANNED_PDF" }]));
    expect(result.current.entries[0].error).toBeNull(); expect(result.current.blocked).toBe(true);
    act(() => result.current.remove(result.current.entries[1].id)); expect(result.current.files).toHaveLength(1); expect(result.current.blocked).toBe(false);
  });
});
