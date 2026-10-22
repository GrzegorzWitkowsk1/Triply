import { test, expect, login, openTrip } from "./fixtures.ts";
test.use({ scenario: "prague" });
test("packing checklist persists categories, status and edited quantities", async ({ page, user }) => {
  const errors: string[] = [];
  page.on("console", message => { if (message.type() === "error" && !message.text().includes("net::ERR_NAME_NOT_RESOLVED")) errors.push(message.text()); });
  await login(page, user); await openTrip(page, user.tripId!);
  await page.getByRole("button", { name: "What should I take?" }).click();
  await expect(page.getByText("Your packing list is empty")).toBeVisible();
  const add = page.getByRole("form", { name: "Add packing item" });
  async function addItem(name: string, category: string) {
    await add.getByLabel("Item name").fill(name);
    await add.getByLabel("Category").selectOption(category);
    await add.getByRole("button", { name: "Add item" }).click();
    await expect(page.getByRole("checkbox", { name })).toBeVisible();
    await expect(add.getByLabel("Item name")).toHaveValue("");
  }
  await addItem("Rain jacket", "clothing"); await addItem("Passport", "documents");
  const clothing = page.getByRole("region", { name: "Clothing" });
  await expect(clothing.getByRole("checkbox", { name: "Rain jacket" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Documents" }).getByRole("checkbox", { name: "Passport" })).toBeVisible();
  const progress = page.getByRole("progressbar", { name: "Packing completion" });
  await expect(progress).toHaveAttribute("aria-valuenow", "0");
  await page.getByRole("checkbox", { name: "Passport" }).click();
  await expect(page.getByRole("checkbox", { name: "Passport" })).toBeChecked();
  await expect(progress).toHaveAttribute("aria-valuenow", "50");
  await page.getByRole("button", { name: "To pack", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Passport" })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "Rain jacket" })).toBeVisible();
  await page.getByRole("button", { name: "Packed", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Passport" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Rain jacket" })).toHaveCount(0);
  await page.getByRole("button", { name: "All", exact: true }).click();
  const toggle = clothing.getByRole("button", { name: /Clothing/ });
  await toggle.focus(); await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(clothing.getByRole("checkbox")).toBeHidden();
  await page.keyboard.press("Space"); await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "Edit Rain jacket" }).click();
  const edit = page.getByRole("form", { name: "Edit Rain jacket" });
  await edit.getByLabel("Quantity").fill("2"); await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(edit).toHaveCount(0); await page.reload();
  await expect(page.getByLabel("Quantity 2", { exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Passport" })).toBeChecked();
  for (const width of [320, 375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole("heading", { name: "What to bring" })).toBeVisible();
    await expect(add.getByRole("button", { name: "Add item" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.getByRole("button", { name: "Delete Passport" }).click();
  await expect(page.getByRole("checkbox", { name: "Passport" })).toHaveCount(0);
  await expect(progress).toHaveAttribute("aria-valuenow", "0");
  await page.reload(); await expect(progress).toHaveAttribute("aria-valuenow", "0");
  expect(errors).toEqual([]);
});

