import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { renderTripPdf } from "../src/services/tripPdf.ts";
import { pdfFixture } from "../src/services/tripPdf.fixtures.ts";

// Development-only: local deterministic PDFs and previews, never production storage.
const output = resolve(process.argv[2] ?? resolve(tmpdir(), "triply-pdf-samples"));
await mkdir(output, { recursive: true });
for (const [name, trip] of [["short", pdfFixture(1, 2)], ["multipage", pdfFixture(3, 8, true)]] as const) {
  const bytes = await renderTripPdf(trip);
  await writeFile(resolve(output, `${name}.pdf`), bytes);
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  const pdf = await task.promise;
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i), viewport = page.getViewport({ scale: 1.4 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: canvas.getContext("2d") as unknown as CanvasRenderingContext2D, viewport }).promise;
      await writeFile(resolve(output, `${name}-${i}.png`), canvas.toBuffer("image/png"));
    }
    console.log(`${name}: ${pdf.numPages} A4 pages, ${bytes.length} bytes → ${output}`);
  } finally { await task.destroy(); }
  const thumbnails = await Promise.all(Array.from({ length: pdf.numPages }, (_, i) => loadImage(resolve(output, `${name}-${i + 1}.png`))));
  const columns = 3, tileWidth = 300, tileHeight = 445;
  const sheet = createCanvas(columns * tileWidth, Math.ceil(thumbnails.length / columns) * tileHeight);
  const context = sheet.getContext("2d"); context.fillStyle = "#eeeeee"; context.fillRect(0, 0, sheet.width, sheet.height);
  thumbnails.forEach((image, i) => {
    const x = i % columns * tileWidth, y = Math.floor(i / columns) * tileHeight;
    context.drawImage(image, x + 5, y + 5, tileWidth - 10, 410);
    context.fillStyle = "#333333"; context.font = "14px sans-serif"; context.fillText(`Page ${i + 1}`, x + 10, y + 434);
  });
  await writeFile(resolve(output, `${name}-contact-sheet.png`), sheet.toBuffer("image/png"));
}
