import { describe, expect, it } from "vitest";
import { validateAvatar } from "./avatar.js";
describe("avatar validation", () => {
  it("accepts real PNG and rejects oversized dimensions, spoofed types and empty content", () => {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5ioAAAAASUVORK5CYII=", "base64");
    expect(validateAvatar(png, "image/png")).toBeNull();
    expect(validateAvatar(png, "image/jpeg")).toBeTruthy();
    expect(validateAvatar(Buffer.from("not an image"), "image/png")).toBeTruthy();
    expect(validateAvatar(Buffer.alloc(0), "image/png")).toBeTruthy();
    png.writeUInt32BE(2049, 16);
    expect(validateAvatar(png, "image/png")).toContain("2048");
  });
  it("reads JPEG frame dimensions without accepting truncated segments", () => {
    const jpeg = Buffer.from([255,216,255,192,0,11,8,0,20,0,30,1,1,17,0,255,217]);
    expect(validateAvatar(jpeg, "image/jpeg")).toBeNull();
    expect(validateAvatar(jpeg.subarray(0, 8), "image/jpeg")).toBeTruthy();
  });
});
