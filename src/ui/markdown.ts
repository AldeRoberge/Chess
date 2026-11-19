const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** A small, safe Markdown: paragraphs, "-" lists, **bold**, *italic*, `code`. Everything is escaped first. */
export function md(src: string): string {
  const inline = (t: string) => esc(t).replace(/`([^`\n]+)`/g, "<code>$1</code>").replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>").replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, "$1<i>$2</i>");
  const out: string[] = []; let list: string[] = [], para: string[] = [];
  const flushP = () => { if (para.length) { out.push(`<p>${para.join("<br>")}</p>`); para = []; } };
  const flushL = () => { if (list.length) { out.push(`<ul>${list.map((x) => `<li>${x}</li>`).join("")}</ul>`); list = []; } };
  for (const raw of src.replace(/\r/g, "").split("\n")) {
    const line = raw.trimEnd(), m = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (m) { flushP(); list.push(inline(m[1])); } else if (!line.trim()) { flushP(); flushL(); } else { flushL(); para.push(inline(line.replace(/^#{1,4}\s+/, ""))); }
  }
  flushP(); flushL();
  return out.join("");
}
