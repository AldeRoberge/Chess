import type { ExperienceEvent } from "../core/events";
import type { NarrationLine } from "./narrator";

/** Optional AI commentary through OpenAI's chat API (small, fast, cheap model). Falls back to the built-in lines on any failure. */
export interface LlmSettings { apiKey: string; model: string; names: [string, string]; voices: 1 | 2; timeoutMs?: number }
export const LLM_DEFAULT_MODEL = "gpt-4.1-nano";

const STYLES = `Registres à alterner selon le moment :
- Analytique et professionnel : « Les blancs ont un léger avantage positionnel. La paire de fous devient puissante, mais les noirs ont encore des ressources défensives. »
- Excité et dramatique : « Oh, un instant ! Il sacrifie la tour ! C'est incroyable ! Si les noirs prennent, il y a une fourchette de dame dévastatrice ! »
- Suspense : « Il réfléchit depuis longtemps. Il n'y a qu'un coup qui maintient la partie en vie. Le voit-il ? »
- Décontracté, comme sur un stream : « Je n'aime pas trop cette poussée de pion, on gagne de l'espace mais que fait-on du roi faible ? »
- Humoristique après une gaffe : « Et voilà la dame. Un généreux cadeau, pas sûr que ce soit volontaire. »
Début de partie, ton posé et pédagogique, on nomme l'ouverture quand on la reconnaît : « Les blancs ouvrent par e4. Du classique, on prend le contrôle du centre. » « Les noirs répondent e5, une mise en place très traditionnelle. » « Cavalier f3, qui met aussitôt la pression sur le pion e5. » « Cavalier c6 défend le pion, puis fou c4 : on va vers la partie italienne, ça peut devenir très intéressant. »
Montée de tension : « Il y va ! Dame h5, et soudain le roi noir semble très vulnérable ! » « Mais attendez ! Les noirs ont une ressource défensive. Va-t-il la trouver ? » « OH NON ! Il joue le mauvais coup ! » « Et il le voit ! Dame prend f7, ÉCHEC ET MAT ! » « QUELLE FIN DE PARTIE SENSATIONNELLE ! »
Commentaire de coup avec analyse et anticipation (3 phrases) : « Cavalier g5 ! Il attaque le pion f7, notoirement faible en ouverture. Les noirs doivent être très prudents ; je ne serais pas surpris que les blancs préparent un sacrifice. »
Expressions : « Quelle trouvaille ! », « Voilà qui est intéressant ! », « Oh non, il n'a pas vu ça ! », « Il donne la qualité ! », « Le roi est en échec ! », « Les noirs accumulent la pression sur l'aile roi. », « C'est le seul coup qui tienne la position. », « C'est à peu près équilibré, il reste beaucoup à jouer. », « Il ne lui reste que quinze secondes ! », « Un mat en trois est sur l'échiquier ! ».`;

type Voices = Pick<LlmSettings, "names" | "voices">;

export const buildMessages = (events: ExperienceEvent[], history: string[], s: Voices) => [
  {
    role: "system" as const,
    content: `Tu es ${s.voices === 2 ? `deux commentateurs d'échecs en direct, ${s.names[0]} (A, joue-par-joue) et ${s.names[1]} (B, analyse, anticipation et réactions)` : `${s.names[0]}, commentateur d'échecs en direct (A)`}. Tu parles français, comme de vrais commentateurs : naturels, vivants, jamais robotiques.
${STYLES}
Règles : au plus 3 répliques au total, 1 à 3 courtes phrases chacune ; moins pour un coup banal. Nomme les pièces et les cases, dis ce que le coup menace ou prépare, et ce que l'adversaire doit craindre. Adapte l'intensité à l'enjeu : calme au début, nerveux quand la tension monte, éclatant sur un mat. Ne parle JAMAIS de capteurs, de caméra, de « position incohérente » ni d'attendre que les pièces soient replacées. Ne décris JAMAIS ce que font les joueurs physiquement (ajuster, hésiter, réfléchir, toucher une pièce) : tu ne le vois pas, c'est une invention ; si un événement n'est pas un coup, un échec, un mat, une prise ou une nulle, ne dis rien. N'invente ni coups ni évaluations précises que tu ne peux pas déduire. Réponds uniquement en JSON : {"lines":[{"speaker":"A","text":"..."}]}.`,
  },
  { role: "user" as const, content: `Coups récents : ${history.slice(-16).join(" ") || "aucun"}\nÉvénements : ${JSON.stringify(events.map((e) => ({ type: e.type, ...(e.data ?? {}) })))}` },
];

export function parseReply(raw: string, s: Voices, t: number, priority: number): NarrationLine[] {
  let j: any; try { j = JSON.parse(raw); } catch { return []; }
  const arr: any[] = Array.isArray(j?.lines) ? j.lines : [];
  return arr.slice(0, 3).filter((l) => typeof l?.text === "string" && l.text.trim()).map((l) => {
    const sp: "A" | "B" = s.voices === 1 || l.speaker !== "B" ? "A" : "B";
    return { speaker: sp, name: s.names[sp === "A" ? 0 : 1], text: l.text.trim().slice(0, 360), t, priority };
  });
}

/** Asks the model for lines about these events; rejects on HTTP errors, timeouts or an empty reply so the caller can fall back. */
export async function commentate(events: ExperienceEvent[], history: string[], s: LlmSettings, priority: number, doFetch: typeof fetch = fetch): Promise<NarrationLine[]> {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), s.timeoutMs ?? 5000);
  try {
    const r = await doFetch("https://api.openai.com/v1/chat/completions", {
      method: "POST", signal: ctl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.apiKey.trim()}` },
      body: JSON.stringify({ model: s.model || LLM_DEFAULT_MODEL, messages: buildMessages(events, history, s), response_format: { type: "json_object" }, temperature: 0.9, max_tokens: 260 }),
    });
    if (!r.ok) throw new Error(`OpenAI ${r.status}`);
    const lines = parseReply((await r.json())?.choices?.[0]?.message?.content ?? "", s, events[events.length - 1]?.t ?? 0, priority);
    if (!lines.length) throw new Error("empty reply");
    return lines;
  } finally { clearTimeout(timer); }
}
