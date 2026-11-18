/**
 * Where the pointer is on each node's preview canvas. The editor writes it (pointer events + paint size);
 * the hover card and the preview highlight read it, so neither needs to know about the other.
 */
export interface PreviewPointer { fx: number; fy: number; w: number; h: number }
const at = new Map<string, PreviewPointer>();

export const setPreviewPointer = (id: string, p: PreviewPointer | null) => { if (p) at.set(id, p); else at.delete(id); };
/** The canvas' logical size changes as nodes resize; the pointer stays a fraction of it. */
export const setPreviewSize = (id: string, w: number, h: number) => { const p = at.get(id); if (p) { p.w = w; p.h = h; } };
/** Pointer in the preview's logical (painting) coordinates, or null when it is not over this node's preview. */
export function previewPoint(id: string): { p: { x: number; y: number }; w: number; h: number } | null {
  const p = at.get(id);
  return p ? { p: { x: p.fx * p.w, y: p.fy * p.h }, w: p.w, h: p.h } : null;
}
