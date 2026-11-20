/**
 * Which extra guesses auto-detect may use. Both are optional and off until switched on, because each can be wrong:
 * the "centre" guess (the crossings of the empty middle of the board) and reading the letters and digits round the board with OCR.
 * Kept in the browser's storage so the choice is the same in every place auto-detect runs.
 */
export interface AlignPrefs { centre: boolean; ocr: boolean }

const KEY = "cx.align.opts";
const DEFAULTS: AlignPrefs = { centre: false, ocr: false };

export function alignPrefs(store: Pick<Storage, "getItem"> | null = typeof localStorage === "undefined" ? null : localStorage): AlignPrefs {
  try {
    const v = JSON.parse(store?.getItem(KEY) ?? "null");
    return { centre: v?.centre === true, ocr: v?.ocr === true };
  } catch { return { ...DEFAULTS }; }
}

export function setAlignPref(key: keyof AlignPrefs, on: boolean, store: Pick<Storage, "getItem" | "setItem"> | null = typeof localStorage === "undefined" ? null : localStorage) {
  try { store?.setItem(KEY, JSON.stringify({ ...alignPrefs(store), [key]: on })); } catch { /* storage unavailable */ }
}
