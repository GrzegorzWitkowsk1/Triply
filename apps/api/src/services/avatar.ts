import { AVATAR_TYPES, MAX_AVATAR_BYTES, MAX_AVATAR_DIMENSION } from "@triply/shared";

// SVG uploads are stored as inert images, with a deliberately restricted XML vocabulary.
function safeSvg(data: Buffer): boolean {
  const text = data.toString("utf8").trim();
  if (!/^<svg\s[^>]*xmlns=["']http:\/\/www\.w3\.org\/2000\/svg["']/i.test(text) || !/<\/svg>$/.test(text)) return false;
  if (/[&]|<!|<\?|url\s*\(|(?:javascript|data|https?):/i.test(text.replace(/xmlns=["']http:\/\/www\.w3\.org\/2000\/svg["']/g, ""))) return false;
  const tags = text.match(/<[^>]*>/g) ?? [];
  const allowedTags = new Set(["svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "title", "desc", "defs", "linearGradient", "radialGradient", "stop"]);
  const allowedAttributes = new Set(["xmlns", "viewBox", "width", "height", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "d", "points", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "fill-rule", "opacity", "fill-opacity", "stroke-opacity", "transform", "offset", "stop-color", "stop-opacity", "id", "gradientUnits", "gradientTransform", "fx", "fy"]);
  return tags.every(tag => {
    const match = /^<\/?([A-Za-z]+)([\s\S]*?)\/?\s*>$/.exec(tag);
    if (!match || !allowedTags.has(match[1])) return false;
    const remainder = match[2].replace(/\s+([\w:-]+)\s*=\s*("[^"<>]*"|'[^'<>]*')/g, (_whole, name: string) => allowedAttributes.has(name) ? "" : "INVALID");
    return !remainder.trim();
  });
}
function dimensions(data: Buffer, type: string): [number, number] | null {
  if (type === "image/png") {
    if (data.length < 33 || !data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || data.toString("ascii", 12, 16) !== "IHDR") return null;
    return [data.readUInt32BE(16), data.readUInt32BE(20)];
  }
  if (data.length < 4 || data[0] !== 255 || data[1] !== 216) return null;
  let offset = 2;
  while (offset + 4 <= data.length) {
    if (data[offset] !== 255) return null;
    const marker = data[offset + 1];
    if (marker === 255) { offset++; continue; }
    const length = data.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > data.length) return null;
    if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
      if (length < 8) return null;
      return [data.readUInt16BE(offset + 7), data.readUInt16BE(offset + 5)];
    }
    offset += 2 + length;
  }
  return null;
}
export function validateAvatar(data: Buffer, type: string): string | null {
  if (!data.length || data.length > MAX_AVATAR_BYTES) return "Choose an image up to 2 MB.";
  if (!(AVATAR_TYPES as readonly string[]).includes(type)) return "Only JPG, JPEG, PNG and SVG images are allowed.";
  if (type === "image/svg+xml") return safeSvg(data) ? null : "This SVG is unsupported or contains unsafe content. Export it as PNG and try again.";
  const size = dimensions(data, type);
  if (!size) return "The file is not a valid image of the selected type.";
  return size.every(value => value > 0 && value <= MAX_AVATAR_DIMENSION) ? null : "Maximum image dimensions are 2048 × 2048 pixels.";
}
