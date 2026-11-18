import { loadMapping } from "./mapping/store";
import { initialSceneState } from "./scene/types";
import type { InMsg, OutMsg } from "./ui/channel";
import { openChannel } from "./ui/channel";
import { ProjectorOutput } from "./world/output";

/** Runs in the projector window: ?output=<projector index>. Fullscreen on dblclick. */
export function startOutputPage(index: number) {
  document.body.className = "output";
  document.body.innerHTML = `<canvas id="o"></canvas><canvas id="c"></canvas><div class="hint">Projector ${index} — double-click for fullscreen</div>`;
  const canvas = document.getElementById("o") as HTMLCanvasElement, calib = document.getElementById("c") as HTMLCanvasElement;
  let cfg = loadMapping();
  let out = new ProjectorOutput(canvas, cfg, Math.min(index, cfg.projectors.length - 1), 1);
  let scene = initialSceneState();
  let overlay: any = { game: null, director: null, hint: null };
  let calibCmd: any = null;
  const ch = openChannel();
  ch.onmessage = (e: MessageEvent<OutMsg>) => {
    const m = e.data;
    if (m.type === "state") { scene = m.scene; overlay = m.overlay; }
    else if (m.type === "calib") calibCmd = m.cmd.kind === "end" ? null : m.cmd;
    else if (m.type === "mapping") { cfg = loadMapping(); out.rebuild(cfg, Math.min(index, cfg.projectors.length - 1)); }
  };
  const size = () => {
    const w = window.innerWidth, h = window.innerHeight;
    out.resize(w, h); calib.width = w; calib.height = h;
    ch.postMessage({ type: "size", index, w, h } satisfies InMsg);
  };
  window.addEventListener("resize", size); size();
  document.addEventListener("dblclick", () => void document.documentElement.requestFullscreen?.());
  const loop = (t: number) => {
    if (calibCmd) {
      calib.style.display = "block";
      const c = calib.getContext("2d")!;
      c.fillStyle = calibCmd.kind === "white" ? "#fff" : "#000"; c.fillRect(0, 0, calib.width, calib.height);
      if (calibCmd.kind === "dot") { c.fillStyle = "#fff"; c.beginPath(); c.arc(calibCmd.x * (calib.width / 1280), calibCmd.y * (calib.height / 720), Math.max(6, calib.width / 120), 0, 7); c.fill(); }
    } else { calib.style.display = "none"; out.render(scene, overlay, t); }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
