import { beforeEach, describe, expect, it } from "vitest";
import { addBackup, ago, beatSession, closeSession, deleteBackup, listBackups, MAX_BACKUPS, openSession, parseImport, STALE_MS } from "./backups";

const g = (n: number) => ({ nodes: Array.from({ length: n }, (_, i) => ({ id: "n" + i, type: "t", x: 0, y: 0, params: {} })), edges: [] });

describe("backups", () => {
  beforeEach(() => localStorage.clear());
  it("stores newest first, dedupes identical patches, caps the count and deletes", () => {
    expect(addBackup("a", g(1), null, true, 1000)).toBeTruthy();
    expect(addBackup("same", g(1), null, true, 2000)).toBeNull();
    expect(addBackup("forced", g(1), null, false, 3000)).toBeTruthy();
    for (let i = 0; i < 30; i++) addBackup("x", g(i + 2), null, true, 4000 + i);
    const l = listBackups();
    expect(l).toHaveLength(MAX_BACKUPS); expect(l[0].t).toBeGreaterThan(l[1].t);
    deleteBackup(l[0].id); expect(listBackups()).toHaveLength(MAX_BACKUPS - 1);
  });
  it("survives garbage and a full disk", () => {
    localStorage.setItem("cx.backups.v1", "{nope"); expect(listBackups()).toEqual([]);
    localStorage.setItem("cx.backups.v1", JSON.stringify([{ id: 1 }, null])); expect(listBackups()).toEqual([]);
    localStorage.setItem("cx.backups.v1", JSON.stringify({ not: "a list" })); expect(listBackups()).toEqual([]);
    const orig = Storage.prototype.setItem; let calls = 0;
    Storage.prototype.setItem = function (k: string, v: string) { if (k === "cx.backups.v1" && ++calls < 3) throw new Error("quota"); return orig.call(this, k, v); };
    try { addBackup("q", g(1), null, true, 1); addBackup("q2", g(2), null, true, 2); addBackup("q3", g(3), null, true, 3); } finally { Storage.prototype.setItem = orig; }
    expect(listBackups().length).toBeGreaterThan(0);
    Storage.prototype.setItem = () => { throw new Error("quota"); };
    try { expect(addBackup("never", g(9), null, false)).toBeNull(); } finally { Storage.prototype.setItem = orig; }
  });
  it("parses exports and rejects other files", () => {
    expect(parseImport(JSON.stringify(g(2)))!.graph.nodes).toHaveLength(2);
    expect(parseImport(JSON.stringify({ graph: g(1), setup: { completed: true } }))!.setup).toEqual({ completed: true });
    expect(parseImport("nope")).toBeNull(); expect(parseImport("{}")).toBeNull();
  });
  it("formats ages", () => {
    expect(ago(0, 5000)).toBe("just now"); expect(ago(0, 120000)).toBe("2 min ago"); expect(ago(0, 7200000)).toBe("2 h ago"); expect(ago(0, 172800000)).toBe("2 d ago");
  });
  it("detects a session that vanished, but not a clean exit or a live sibling tab", () => {
    expect(openSession(0)).toBe(false);
    expect(openSession(STALE_MS + 1)).toBe(true);
    beatSession(); expect(openSession()).toBe(false);
    closeSession(); expect(openSession(Date.now() + STALE_MS * 5)).toBe(false);
    localStorage.setItem("cx.session.v1", "{bad"); expect(openSession()).toBe(false);
  });
});
