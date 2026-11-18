import type { ExperienceEvent } from "../core/events";

export interface NarrationLine {
  speaker: "A" | "B";
  name: string;
  text: string;
  t: number;
  priority: number; // 0 chatter .. 3 critical
}

const PIECE: Record<string, string> = { p: "le pion", n: "le cavalier", b: "le fou", r: "la tour", q: "la dame", k: "le roi" };
const PIECE_CAP: Record<string, string> = { p: "un pion", n: "un cavalier", b: "un fou", r: "une tour", q: "la dame", k: "le roi" };
const COLOR: Record<string, string> = { w: "Les blancs", b: "Les noirs" };

export interface NarratorConfig {
  voices: 1 | 2;
  names: [string, string];
  seed: number;
  minGapMs: number; // do not talk over ourselves
}
export const defaultNarratorConfig = (): NarratorConfig => ({ voices: 2, names: ["Jean", "Margot"], seed: 7, minGapMs: 900 });

/**
 * Real-time commentary. Two voices: A calls the action, B adds colour / reaction. Lines are
 * deterministic per seed (testable) and rate-limited, with critical events able to cut in.
 */
export class Narrator {
  private n = 0;
  private lastT = -1e9;
  private lastLow = -1e9;
  constructor(public cfg: NarratorConfig = defaultNarratorConfig()) {}

  private pick<T>(xs: T[]) {
    this.n = (this.n * 1103515245 + 12345 + this.cfg.seed) & 0x7fffffff;
    return xs[this.n % xs.length];
  }
  private line(speaker: "A" | "B", text: string, t: number, priority: number): NarrationLine {
    const s = this.cfg.voices === 1 ? "A" : speaker;
    return { speaker: s, name: this.cfg.names[s === "A" ? 0 : 1], text, t, priority };
  }

  handle(events: ExperienceEvent[]): NarrationLine[] {
    const out: NarrationLine[] = [];
    for (const e of events) {
      const lines = this.describe(e);
      for (const l of lines) {
        if (l.priority < 2 && l.t !== this.lastLow && l.t - this.lastLow < 2500) continue; // chatter throttle (lines of one event may pair up)
        if (l.priority < 3 && l.t - this.lastT < this.cfg.minGapMs && out.length === 0 && l.t !== this.lastT) continue;
        out.push(l);
        this.lastT = l.t;
        if (l.priority < 2) this.lastLow = l.t;
      }
    }
    return out;
  }

  /** Colour a human commentator would add on a quiet move: centre, rim knights, early queens, wing pawns, phase of the game. */
  private colour(m: any): string | null {
    const to: string = m.to ?? "", file = to[0], rank = to[1], ply: number = m.ply ?? 0;
    if (m.piece === "q" && ply <= 12) return this.pick(["Sortie précoce de la dame, c'est audacieux.", "La dame se montre tôt, il faudra qu'elle fasse attention aux tempos perdus."]);
    if (m.piece === "n" && (file === "a" || file === "h")) return this.pick(["Un cavalier en bordure, on dit qu'il y est mal placé.", "Le cavalier sur le bord, c'est rarement son meilleur endroit."]);
    if (m.piece === "p" && "de".includes(file) && "45".includes(rank)) return this.pick(["Un pion au centre, c'est la logique même.", "Voilà qui prend de l'espace au centre."]);
    if (m.piece === "p" && "abgh".includes(file)) return this.pick(["Un coup d'aile, on prépare quelque chose de ce côté.", "Poussée sur l'aile, on cherche de l'espace."]);
    if ((m.piece === "n" || m.piece === "b") && ply <= 12) return this.pick(["Un développement naturel.", "On met les pièces en jeu, rien à redire."]);
    if (m.piece === "r") return this.pick(["La tour cherche une colonne ouverte.", "Les tours entrent doucement dans la partie."]);
    if (m.piece === "k") return this.pick(["Le roi se déplace, il faut rester prudent.", "Un coup de roi, on veut le mettre à l'abri."]);
    if (ply > 60) return this.pick(["On entre en finale, chaque tempo compte.", "Le matériel s'est allégé, la technique va décider."]);
    if (ply > 20) return this.pick(["On est en plein milieu de partie, la tension monte.", "La position se complique, tout peut arriver."]);
    return null;
  }

  /** Time left, said as sure as the estimate is: exact when certain, rounded when roughly known, never a number when it is a guess. */
  private clockLines(e: ExperienceEvent): NarrationLine[] {
    const d = e.data ?? {}, t = e.t, who = d.side === "b" ? "les noirs" : "les blancs", Who = who[0].toUpperCase() + who.slice(1);
    const conf = Number(d.conf ?? 0), s = Math.max(0, Math.round(Number(d.ms ?? 0) / 1000));
    const exact = s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")}` : `${s} secondes`;
    const approx = s >= 90 ? `environ ${Math.round(s / 60)} minutes` : s >= 45 ? "environ une minute" : `moins de ${Math.max(10, Math.ceil(s / 10) * 10 + 10)} secondes`;
    const amount = conf >= 0.7 ? exact : conf >= 0.4 ? approx : "";
    switch (e.type) {
      case "clock-low":
        return [this.line("A", amount ? `${Who} n'ont plus beaucoup de temps : ${amount}.` : `${Who} semblent manquer de temps.`, t, 2), this.line("B", this.pick(["La pendule commence à peser.", "Le temps devient un adversaire de plus."]), t, 1)];
      case "clock-critical":
        return [this.line("A", amount ? `Attention, il reste ${amount} aux ${who.replace("les ", "")} !` : `${Who} sont presque à court de temps !`, t, 3), this.line("B", this.pick(["Chaque seconde compte maintenant.", "Il faut jouer vite, très vite."]), t, 2)];
      case "clock-flag":
        return [this.line("A", conf >= 0.7 ? `Le drapeau est tombé ! ${Who} n'ont plus de temps.` : `Il semble que ${who} soient à court de temps.`, t, 3)];
      default: // clock-lost
        return [this.line("B", "Je ne vois plus la pendule, je continue avec mes estimations.", t, 1)];
    }
  }

  private describe(e: ExperienceEvent): NarrationLine[] {
    const t = e.t;
    const d = e.data ?? {};
    switch (e.type) {
      case "seat":
        return [this.line("A", this.pick(["Un joueur s'installe à la table.", "Nous avons un joueur à l'échiquier."]), t, 3)];
      case "leave":
        return [this.line("A", this.pick(["Le joueur se lève de la table.", "Le fauteuil se vide, on fait une pause."]), t, 3)];
      case "mode":
        return d.mode === "engine"
          ? [this.line("A", `Une partie contre l'ordinateur, réglé autour de ${d.elo} Elo.`, t, 3), this.line("B", this.pick(["Face à la machine, il faudra tenir sans une seule erreur.", "Elle ne se fatigue jamais, voyons comment il va s'y prendre."]), t, 1)]
          : [this.line("A", "Une partie à deux joueurs, face à face.", t, 3), this.line("B", this.pick(["Rien de tel qu'un duel entre humains.", "Du jeu à l'ancienne, j'adore."]), t, 1)];
      case "phase":
        if (d.phase === "intro") return [this.line("B", this.pick(["Les lumières baissent, les pièces sont en place. Ça va commencer.", "Ambiance feutrée sur l'échiquier, on est prêts."]), t, 2)];
        if (d.phase === "outro") return [this.line("A", d.result ? `La partie est terminée : ${d.result}.` : "La partie est terminée.", t, 3)];
        return [];
      case "move": {
        const m = d;
        const who = COLOR[m.color];
        const piece = PIECE[m.piece];
        if (m.captured) return []; // handled by capture
        if (m.flags?.includes("k") || m.flags?.includes("q")) return []; // handled by castle
        if (m.promotion) return [];
        const cap = piece[0].toUpperCase() + piece.slice(1);
        const lead = this.pick([`${who} jouent ${piece} en ${m.to}.`, `${cap} va en ${m.to}.`, `${m.san}, ${piece} en ${m.to}.`, `${cap} se porte en ${m.to}.`]);
        const out = [this.line("A", lead, t, 1)];
        const c = (m.ply ?? 0) > 1 && (m.ply ?? 0) % 3 === 0 ? this.colour(m) : null;
        if (c) out.push(this.line("B", c, t, 0));
        return out;
      }
      case "capture": {
        const m = d;
        const taken = m.captured as string;
        const by = PIECE[m.piece][0].toUpperCase() + PIECE[m.piece].slice(1);
        if (taken === "q")
          return [
            this.line("A", `${by} prend la dame en ${m.to} ! ${COLOR[m.color]} gagnent la dame !`, t, 3),
            this.line("B", this.pick(["Oh là là, quel coup de tonnerre !", "Impossible de s'en relever facilement, la dame est tombée !", "Un tournant de la partie, sans aucun doute."]), t, 3),
          ];
        return [
          this.line("A", `${by} prend ${PIECE_CAP[taken]} en ${m.to}.`, t, 2),
          this.line("B", this.pick(["Un échange qui change l'équilibre.", "Bien vu, il fallait prendre.", "On simplifie un peu la position.", "Voilà qui ouvre le jeu."]), t, 1),
        ];
      }
      case "castle":
        return [this.line("A", `${COLOR[d.color]} roquent ${d.flags.includes("k") ? "côté roi" : "côté dame"}.`, t, 2), this.line("B", this.pick(["Le roi est à l'abri, la tour entre en jeu : deux choses en un.", "Le roque, le geste le plus sûr de la partie."]), t, 1)];
      case "promotion":
        return [this.line("A", `Promotion ! Le pion arrive en ${d.to} et devient ${PIECE_CAP[d.promotion] ?? "une dame"} !`, t, 3), this.line("B", this.pick(["Un long chemin pour ce pion, et quel résultat !", "Voilà qui peut tout décider."]), t, 2)];
      case "check":
        return [this.line("A", "Échec !", t, 3), this.line("B", this.pick(["Le roi est attaqué, il doit réagir tout de suite.", "Attention au roi, il faut parer ça.", "Un échec qui force la réponse."]), t, 2)];
      case "mate":
        return [this.line("A", `Échec et mat ! ${COLOR[d.color]} l'emportent.`, t, 3), this.line("B", this.pick(["Magnifique finale, chapeau !", "Voilà une belle partie, bien menée jusqu'au bout."]), t, 3)];
      case "draw":
        return [this.line("A", "La partie est nulle.", t, 3), this.line("B", this.pick(["Personne ne peut forcer la décision, on se quitte sur un partage.", "Un partage des points, après un beau combat."]), t, 2)];
      // A lifted piece or an unreadable board says nothing certain about the players: never narrate guesses about what they are doing.
      case "lifted":
      case "illegal":
        return [];
      case "clock-low":
      case "clock-critical":
      case "clock-flag":
      case "clock-lost":
        return this.clockLines(e);
      case "engine-move":
        return [this.line("A", `L'ordinateur répond ${d.san ?? d.uci}.`, t, 2), this.line("B", this.pick(["Un coup précis, comme toujours.", "La réponse est rapide, la machine ne tremble pas.", "À lui de trouver une idée maintenant."]), t, 1)];
      default:
        return [];
    }
  }
}
