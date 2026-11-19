import qrcode from "qrcode-generator";

/** An inline SVG QR code for `text` (black modules on white, with a quiet zone so phone cameras can read it in any theme). */
export function qrSvg(text: string): SVGSVGElement {
  const q = qrcode(0, "M"); q.addData(text); q.make();
  const n = q.getModuleCount(), pad = 2, size = n + pad * 2;
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`); svg.setAttribute("shape-rendering", "crispEdges");
  svg.setAttribute("role", "img"); svg.setAttribute("aria-label", "QR code to join from a phone");
  const bg = document.createElementNS(ns, "rect"); bg.setAttribute("width", String(size)); bg.setAttribute("height", String(size)); bg.setAttribute("fill", "#fff");
  const path = document.createElementNS(ns, "path"); let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + pad} ${r + pad}h1v1h-1z`;
  path.setAttribute("d", d); path.setAttribute("fill", "#000");
  svg.append(bg, path); return svg;
}
