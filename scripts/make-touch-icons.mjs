// Renders the iOS home-screen icons: public/apple-touch-icon.png (the everyday blue knight) and public/touch-icons/<season>.png (one per holiday).
// Safari ignores the SVG favicon and needs an opaque PNG; iOS rounds the corners itself, so the artwork is drawn square.
// Re-run after changing the knight or a season's look in src/ui/seasonArt.ts:  npm run icons
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { knightSvg } from "../src/ui/brandIcon.ts";
import { SEASON_LOOKS } from "../src/ui/seasonArt.ts";
import { SEASONS } from "../src/ui/seasons.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SIZE = 180;

async function render(svg, file, background) {
  const out = resolve(root, file);
  mkdirSync(dirname(out), { recursive: true });
  await sharp(Buffer.from(svg), { density: 72 * (SIZE / 64) * 2 }).resize(SIZE, SIZE).flatten({ background }).png({ compressionLevel: 9 }).toFile(out);
  console.log("wrote", file);
}

// The everyday look follows the app theme with CSS variables a PNG cannot use, so it comes from the blue fallback favicon.
const plain = readFileSync(resolve(root, "public/knight.svg"), "utf8").replaceAll(' rx="14"', "");
await render(plain, "public/apple-touch-icon.png", "#1769c2");
for (const season of SEASONS) {
  const look = SEASON_LOOKS[season.id];
  await render(knightSvg(look, { standalone: true, square: true }), `public/touch-icons/${season.id}.png`, look.bg[1]);
}
