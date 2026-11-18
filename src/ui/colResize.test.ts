import { describe, expect, it } from "vitest";
import { resizableColumns } from "./colResize";

function table(cols: number) {
  const t = document.createElement("table");
  const tr = document.createElement("tr");
  for (let i = 0; i < cols; i++) tr.append(document.createElement("th"));
  t.append(document.createElement("thead"));
  t.querySelector("thead")!.append(tr);
  document.body.append(t);
  return t;
}

const pointer = (type: string, x: number, pointerId = 1) => {
  const e = new Event(type, { bubbles: true, cancelable: true }) as Event & { clientX: number; pointerId: number };
  Object.assign(e, { clientX: x, pointerId });
  return e;
};

describe("resizableColumns", () => {
  it("does nothing for a table with fewer than two columns", () => {
    const t = table(1);
    resizableColumns(t, "one");
    expect(t.querySelectorAll(".col-rz").length).toBe(0);
  });

  it("adds a resize handle to every column except the last", () => {
    const t = table(3);
    resizableColumns(t, "three");
    expect(t.querySelectorAll(".col-rz").length).toBe(2);
    expect(t.style.tableLayout).toBe("");
  });

  it("drags the boundary, moving width between neighbours and clamping at the minimum", () => {
    const t = table(2);
    const ths = [...t.querySelectorAll<HTMLElement>("th")];
    ths.forEach((th) => { th.getBoundingClientRect = () => ({ width: 100 }) as DOMRect; });
    resizableColumns(t, "drag");
    const handle = t.querySelector<HTMLElement>(".col-rz")!;
    handle.setPointerCapture = () => {};
    handle.dispatchEvent(pointer("pointerdown", 50));
    expect(t.style.tableLayout).toBe("fixed");
    expect(handle.classList.contains("on")).toBe(true);
    handle.dispatchEvent(pointer("pointermove", 80));
    expect(ths[0].style.width).toBe("130px");
    expect(ths[1].style.width).toBe("70px");
    handle.dispatchEvent(pointer("pointermove", -1000));
    expect(ths[0].style.width).toBe("36px");
    handle.dispatchEvent(pointer("pointerup", 0));
    expect(handle.classList.contains("on")).toBe(false);
  });

  it("restores saved widths when the table is rebuilt, and resets on double-click", () => {
    const t = table(2);
    const ths = [...t.querySelectorAll<HTMLElement>("th")];
    ths.forEach((th) => { th.getBoundingClientRect = () => ({ width: 100 }) as DOMRect; });
    resizableColumns(t, "persist");
    const handle = t.querySelector<HTMLElement>(".col-rz")!;
    handle.setPointerCapture = () => {};
    handle.dispatchEvent(pointer("pointerdown", 0));
    handle.dispatchEvent(pointer("pointermove", 20));
    handle.dispatchEvent(pointer("pointerup", 20));

    const rebuilt = table(2);
    resizableColumns(rebuilt, "persist");
    expect(rebuilt.style.tableLayout).toBe("fixed");
    expect(rebuilt.querySelector<HTMLElement>("th")!.style.width).toBe("120px");

    rebuilt.querySelector<HTMLElement>(".col-rz")!.dispatchEvent(new Event("dblclick", { bubbles: true }));
    expect(rebuilt.style.tableLayout).toBe("");
    expect(rebuilt.querySelector<HTMLElement>("th")!.style.width).toBe("");
  });

  it("ignores a saved width list whose length no longer matches", () => {
    const t = table(3);
    resizableColumns(t, "mismatch-a");
    const other = table(2);
    resizableColumns(other, "mismatch-a");
    expect(other.style.tableLayout).toBe("");
  });

  it("stops click propagation from the handle", () => {
    const t = table(2);
    resizableColumns(t, "click");
    let reached = false;
    t.addEventListener("click", () => { reached = true; });
    t.querySelector<HTMLElement>(".col-rz")!.click();
    expect(reached).toBe(false);
  });
});
