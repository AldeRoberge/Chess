import { BOARD_THEMES, boardTheme, setBoardTheme } from "../boardThemes";
import { PIECE_SETS, pieceColors, pieceSet, setPieceColors, setPieceSet } from "../pieceSets";
import type { CtxItem } from "../contextMenu";
import { joinGroups } from "../contextMenu";
import { PRESETS, resetViewSettings, setDisplay, setQuality, setRender, viewSettings } from "../viewSettings";

/** A radio-style submenu: the current option is marked, picking one applies it and closes the menu. */
export function radioMenu<T extends string>(label: string, options: { value: T; label: string }[], get: () => T, set: (v: T) => void): CtxItem {
  return { kind: "submenu", label, items: () => options.map((o) => ({ kind: "action" as const, label: `${get() === o.value ? "●" : "○"}  ${o.label}`, run: () => set(o.value) })) };
}

export const SCALES = [{ value: "0.5", label: "50%" }, { value: "0.75", label: "75%" }, { value: "1", label: "100%" }, { value: "1.5", label: "150%" }, { value: "0", label: "Native (screen)" }];
export const FPS = [{ value: "15", label: "15 fps" }, { value: "30", label: "30 fps" }, { value: "60", label: "60 fps" }, { value: "0", label: "Unlimited" }];

export function styleItems(): CtxItem[] {
  return [
    radioMenu("Board look", BOARD_THEMES.map((t) => ({ value: t.id, label: t.name })), () => boardTheme().id, setBoardTheme),
    radioMenu("Piece set", PIECE_SETS.map((s) => ({ value: s.id, label: `${s.name} · ${s.license}` })), () => pieceSet().id, setPieceSet),
    { kind: "color", label: "White pieces colour", get: () => pieceColors().white ?? "#ffffff", set: (v) => setPieceColors({ white: v }) },
    { kind: "color", label: "Black pieces colour", get: () => pieceColors().black ?? "#262421", set: (v) => setPieceColors({ black: v }) },
    { kind: "action", label: "Original piece colours", run: () => setPieceColors({ white: null, black: null }), disabled: !pieceColors().white && !pieceColors().black },
  ];
}

export function renderItems(): CtxItem[] {
  const r = () => viewSettings().render;
  return [
    radioMenu("Quality", [{ value: "low", label: "Low" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" }, { value: "custom", label: "Custom" }] as { value: "low" | "medium" | "high" | "custom"; label: string }[],
      () => r().quality, (v) => { if (v !== "custom") setQuality(v); }),
    radioMenu("Resolution", SCALES, () => String(r().scale), (v) => setRender({ scale: Number(v) })),
    radioMenu("Frame rate", FPS, () => String(r().fps), (v) => setRender({ fps: Number(v) })),
    radioMenu("Shadows (3D view)", [{ value: "off", label: "Off" }, { value: "low", label: "Low" }, { value: "high", label: "High" }] as { value: "off" | "low" | "high"; label: string }[], () => r().shadows, (v) => setRender({ shadows: v })),
    { kind: "toggle", label: "Antialiasing (after reload)", get: () => r().aa, set: (v) => setRender({ aa: v }), hint: "WebGL can only change antialiasing when the page loads." },
  ];
}

export function displayItems(): CtxItem[] {
  const d = () => viewSettings().display;
  return [
    { kind: "toggle", label: "Coordinates", get: () => d().coords, set: (v) => setDisplay({ coords: v }) },
    { kind: "toggle", label: "Legal-move dots", get: () => d().legalMoves, set: (v) => setDisplay({ legalMoves: v }) },
    { kind: "toggle", label: "Move hints", get: () => d().hints, set: (v) => setDisplay({ hints: v }) },
    { kind: "toggle", label: "Last-move highlight", get: () => d().lastMove, set: (v) => setDisplay({ lastMove: v }) },
  ];
}

/** Everything a game preview can change, grouped as submenus; `extra` rows go first. */
export function viewMenu(extra: CtxItem[] = [], opts: { world?: boolean } = {}): CtxItem[] {
  return joinGroups([
    extra,
    [
      { kind: "submenu", label: "Style", items: styleItems },
      { kind: "submenu", label: "Performance & resolution", items: renderItems },
      { kind: "submenu", label: "Display", items: () => (opts.world ? [...displayItems(), { kind: "toggle" as const, label: "Projector frusta", get: () => viewSettings().display.frusta, set: (v: boolean) => setDisplay({ frusta: v }) }] : displayItems()) },
    ],
    [{ kind: "action", label: "Reset view settings", run: resetViewSettings }],
  ]);
}

export { PRESETS };
