/** How much the table explains: the commentary level and whether the AI opponent talks. Saved in the browser. */
export type CoachLevel = "off" | "beginner" | "intermediate" | "advanced" | "expert";

export const COACH_LEVELS: { value: CoachLevel; label: string; hint: string }[] = [
  { value: "off", label: "Off", hint: "No explanations or trivia, only the play-by-play." },
  { value: "beginner", label: "Beginner", hint: "Names every opening, tactic and pawn structure and explains it simply. Frequent trivia." },
  { value: "intermediate", label: "Intermediate", hint: "Names what happens with a short reason. Some trivia." },
  { value: "advanced", label: "Advanced", hint: "Fewer, shorter notes. Rare trivia." },
  { value: "expert", label: "Expert", hint: "Terse. Only the subtle points (pins, skewers, weak and passed pawns, deeper opening lines). No trivia." },
];

/** 0 = off .. 4 = expert. */
export const coachTier = (l: CoachLevel | undefined): number => ({ off: 0, beginner: 1, intermediate: 2, advanced: 3, expert: 4 })[l ?? "off"] ?? 0;

export interface CoachSettings { level: CoachLevel; opponentTalks: boolean }
export const DEFAULT_COACH: CoachSettings = { level: "intermediate", opponentTalks: true };

const KEY = "chess.coach";
const isLevel = (v: unknown): v is CoachLevel => COACH_LEVELS.some((l) => l.value === v);

export function parseCoachSettings(raw: string | null): CoachSettings {
  try {
    const j = raw ? JSON.parse(raw) : {};
    return { level: isLevel(j.level) ? j.level : DEFAULT_COACH.level, opponentTalks: typeof j.opponentTalks === "boolean" ? j.opponentTalks : DEFAULT_COACH.opponentTalks };
  } catch { return { ...DEFAULT_COACH }; }
}

let current: CoachSettings = (() => { try { return parseCoachSettings(localStorage.getItem(KEY)); } catch { return { ...DEFAULT_COACH }; } })();

export const coachSettings = (): CoachSettings => current;

export function setCoachSettings(p: Partial<CoachSettings>) {
  current = parseCoachSettings(JSON.stringify({ ...current, ...p }));
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* storage unavailable */ }
}
