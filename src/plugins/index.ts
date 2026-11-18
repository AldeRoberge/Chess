import { Registry } from "../core/types";
import { experiencePlugin } from "./experience";
import { gamePlugin } from "./game";
import { narrationPlugin } from "./narration";
import { scenePlugin } from "./scene";
import { sourcesPlugin } from "./sources";
import { trackingPlugin } from "./tracking";
import { visionPlugin } from "./vision";
import { clockPlugin } from "./clock";
import { worldPlugin } from "./world";

/** Add a plugin = add one line here (or call registry.use() at runtime from your own module). */
export function createRegistry() {
  return new Registry().use(sourcesPlugin).use(visionPlugin).use(gamePlugin).use(experiencePlugin).use(narrationPlugin).use(scenePlugin).use(trackingPlugin).use(clockPlugin).use(worldPlugin);
}
