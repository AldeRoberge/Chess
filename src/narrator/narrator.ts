import type { ExperienceEvent } from "../core/events";

export type Lang = "fr" | "en";
export const LANGS: Lang[] = ["fr", "en"];

export interface NarrationLine {
  speaker: "A" | "B";
  name: string;
  text: string;
  t: number;
  priority: number; // 0 chatter .. 3 critical
}

/** Every sentence the built-in narrator can say, per language. */
interface Phrases {
  piece: Record<string, string>; // "the knight" / "le cavalier"
  pieceCap: Record<string, string>; // object of a capture or promotion: "a knight" / "un cavalier"
  defaultPromotion: string;
  queen: string; // "la dame" / "the queen"
  byColor: Record<"w" | "b", string>; // subject at sentence start: "Les blancs" / "White"
  seat: string[];
  leave: string[];
  engineMode: (elo: number) => string;
  engineSits: string[];
  humanMode: string;
  humanSits: string[];
  introSays: string[];
  outro: (result?: string) => string;
  moveLead: (who: string, piece: string, cap: string, san: string, to: string) => string[];
  colour: { queenEarly: string[]; knightEdge: string[]; centrePawn: string[]; wingPawn: string[]; develop: string[]; rook: string[]; king: string[]; endgame: string[]; middlegame: string[] };
  clockLowA: (c: "w" | "b", amount: string) => string;
  clockLowB: string[];
  clockCriticalA: (c: "w" | "b", amount: string) => string;
  clockCriticalB: string[];
  clockFlagA: (c: "w" | "b", sure: boolean) => string;
  clockLost: string;
  queenTaken: (by: string, to: string, c: string) => string;
  queenTakenB: string[];
  captureA: (by: string, taken: string, to: string) => string;
  captureB: string[];
  castle: (c: string, kingside: boolean) => string;
  castleB: string[];
  promotion: (to: string, piece: string) => string;
  promotionB: string[];
  check: string;
  checkB: string[];
  mate: (c: string) => string;
  mateB: string[];
  draw: string;
  drawB: string[];
  engineMove: (move: string) => string;
  engineMoveB: string[];
  /** Clock amounts, filled by the caller: exact when certain, rounded when roughly known. */
  exactTime: (min: number, sec: number) => string;
  roughTime: (s: number) => string;
  lessThan: (n: number) => string;
  sideLc: (c: "w" | "b") => string; // "les blancs" / "white", used inside clock sentences
}

const FR: Phrases = {
  piece: { p: "le pion", n: "le cavalier", b: "le fou", r: "la tour", q: "la dame", k: "le roi" },
  pieceCap: { p: "un pion", n: "un cavalier", b: "un fou", r: "une tour", q: "la dame", k: "le roi" },
  defaultPromotion: "une dame",
  queen: "la dame",
  byColor: { w: "Les blancs", b: "Les noirs" },
  seat: ["Un joueur s'installe à la table.", "Nous avons un joueur à l'échiquier."],
  leave: ["Le joueur se lève de la table.", "Le fauteuil se vide, on fait une pause."],
  engineMode: (elo) => `Une partie contre l'ordinateur, réglé autour de ${elo} Elo.`,
  engineSits: ["Face à la machine, il faudra tenir sans une seule erreur.", "Elle ne se fatigue jamais, voyons comment il va s'y prendre."],
  humanMode: "Une partie à deux joueurs, face à face.",
  humanSits: ["Rien de tel qu'un duel entre humains.", "Du jeu à l'ancienne, j'adore."],
  introSays: ["Les lumières baissent, les pièces sont en place. Ça va commencer.", "Ambiance feutrée sur l'échiquier, on est prêts."],
  outro: (result) => (result ? `La partie est terminée : ${result}.` : "La partie est terminée."),
  moveLead: (who, piece, cap, san, to) => [`${who} jouent ${piece} en ${to}.`, `${cap} va en ${to}.`, `${san}, ${piece} en ${to}.`, `${cap} se porte en ${to}.`],
  colour: {
    queenEarly: ["Sortie précoce de la dame, c'est audacieux.", "La dame se montre tôt, il faudra qu'elle fasse attention aux tempos perdus."],
    knightEdge: ["Un cavalier en bordure, on dit qu'il y est mal placé.", "Le cavalier sur le bord, c'est rarement son meilleur endroit."],
    centrePawn: ["Un pion au centre, c'est la logique même.", "Voilà qui prend de l'espace au centre."],
    wingPawn: ["Un coup d'aile, on prépare quelque chose de ce côté.", "Poussée sur l'aile, on cherche de l'espace."],
    develop: ["Un développement naturel.", "On met les pièces en jeu, rien à redire."],
    rook: ["La tour cherche une colonne ouverte.", "Les tours entrent doucement dans la partie."],
    king: ["Le roi se déplace, il faut rester prudent.", "Un coup de roi, on veut le mettre à l'abri."],
    endgame: ["On entre en finale, chaque tempo compte.", "Le matériel s'est allégé, la technique va décider."],
    middlegame: ["On est en plein milieu de partie, la tension monte.", "La position se complique, tout peut arriver."],
  },
  clockLowA: (c, amount) => (amount ? `${FR.byColor[c]} n'ont plus beaucoup de temps : ${amount}.` : `${FR.byColor[c]} semblent manquer de temps.`),
  clockLowB: ["La pendule commence à peser.", "Le temps devient un adversaire de plus."],
  clockCriticalA: (c, amount) => (amount ? `Attention, il reste ${amount} aux ${c === "w" ? "blancs" : "noirs"} !` : `${FR.byColor[c]} sont presque à court de temps !`),
  clockCriticalB: ["Chaque seconde compte maintenant.", "Il faut jouer vite, très vite."],
  clockFlagA: (c, sure) => (sure ? `Le drapeau est tombé ! ${FR.byColor[c]} n'ont plus de temps.` : `Il semble que ${FR.sideLc(c)} soient à court de temps.`),
  clockLost: "Je ne vois plus la pendule, je continue avec mes estimations.",
  queenTaken: (by, to, c) => `${by} prend la dame en ${to} ! ${c} gagnent la dame !`,
  queenTakenB: ["Oh là là, quel coup de tonnerre !", "Impossible de s'en relever facilement, la dame est tombée !", "Un tournant de la partie, sans aucun doute."],
  captureA: (by, taken, to) => `${by} prend ${taken} en ${to}.`,
  captureB: ["Un échange qui change l'équilibre.", "Bien vu, il fallait prendre.", "On simplifie un peu la position.", "Voilà qui ouvre le jeu."],
  castle: (c, kingside) => `${c} roquent ${kingside ? "côté roi" : "côté dame"}.`,
  castleB: ["Le roi est à l'abri, la tour entre en jeu : deux choses en un.", "Le roque, le geste le plus sûr de la partie."],
  promotion: (to, piece) => `Promotion ! Le pion arrive en ${to} et devient ${piece} !`,
  promotionB: ["Un long chemin pour ce pion, et quel résultat !", "Voilà qui peut tout décider."],
  check: "Échec !",
  checkB: ["Le roi est attaqué, il doit réagir tout de suite.", "Attention au roi, il faut parer ça.", "Un échec qui force la réponse."],
  mate: (c) => `Échec et mat ! ${c} l'emportent.`,
  mateB: ["Magnifique finale, chapeau !", "Voilà une belle partie, bien menée jusqu'au bout."],
  draw: "La partie est nulle.",
  drawB: ["Personne ne peut forcer la décision, on se quitte sur un partage.", "Un partage des points, après un beau combat."],
  engineMove: (m) => `L'ordinateur répond ${m}.`,
  engineMoveB: ["Un coup précis, comme toujours.", "La réponse est rapide, la machine ne tremble pas.", "À lui de trouver une idée maintenant."],
  exactTime: (min, sec) => (min > 0 ? `${min} min ${String(sec).padStart(2, "0")}` : `${sec} secondes`),
  roughTime: (s) => (s >= 90 ? `environ ${Math.round(s / 60)} minutes` : "environ une minute"),
  lessThan: (n) => `moins de ${n} secondes`,
  sideLc: (c) => (c === "w" ? "les blancs" : "les noirs"),
};

const EN: Phrases = {
  piece: { p: "the pawn", n: "the knight", b: "the bishop", r: "the rook", q: "the queen", k: "the king" },
  pieceCap: { p: "a pawn", n: "a knight", b: "a bishop", r: "a rook", q: "the queen", k: "the king" },
  defaultPromotion: "a queen",
  queen: "the queen",
  byColor: { w: "White", b: "Black" },
  seat: ["A player sits down at the board.", "We have a player at the board."],
  leave: ["The player gets up from the table.", "The chair empties, we take a short break."],
  engineMode: (elo) => `A game against the computer, set at about ${elo} Elo.`,
  engineSits: ["Against the machine, he will have to play without a single slip.", "It never tires, let's see how it goes about it."],
  humanMode: "A two-player game, face to face.",
  humanSits: ["Nothing like a duel between humans.", "Old-school chess, I love it."],
  introSays: ["The lights dim, the pieces are in place. Here we go.", "A hushed mood over the board, we are ready."],
  outro: (result) => (result ? `The game is over: ${result}.` : "The game is over."),
  moveLead: (who, piece, cap, san, to) => [`${who} plays ${piece} to ${to}.`, `${cap} goes to ${to}.`, `${san}, ${piece} to ${to}.`, `${cap} moves to ${to}.`],
  colour: {
    queenEarly: ["An early queen sortie, that is bold.", "The queen comes out early, she will have to watch for lost tempi."],
    knightEdge: ["A knight on the rim, they say it is badly placed there.", "A knight on the edge is rarely at its best."],
    centrePawn: ["A pawn in the centre, that is pure logic.", "That pawn grabs space in the centre."],
    wingPawn: ["A wing push, something is being prepared on this side.", "Pushing on the wing, looking for space."],
    develop: ["A natural development.", "Pieces into play, nothing to object to."],
    rook: ["The rook is looking for an open file.", "The rooks are slowly entering the game."],
    king: ["The king moves, caution is needed.", "A king move, they want to shelter it."],
    endgame: ["We are entering the endgame, every tempo counts.", "The material has thinned out, technique will decide."],
    middlegame: ["We are in the middlegame, the tension rises.", "The position is getting complicated, anything can happen."],
  },
  clockLowA: (c, amount) => (amount ? `${EN.byColor[c]} are low on time: ${amount}.` : `${EN.byColor[c]} seem short of time.`),
  clockLowB: ["The clock is starting to weigh.", "Time is becoming one more opponent."],
  clockCriticalA: (c, amount) => (amount ? `Careful, ${EN.byColor[c]} have ${amount} left!` : `${EN.byColor[c]} are almost out of time!`),
  clockCriticalB: ["Every second counts now.", "They must play fast, very fast."],
  clockFlagA: (c, sure) => (sure ? `The flag has fallen! ${EN.byColor[c]} are out of time.` : `It seems ${EN.sideLc(c)} are out of time.`),
  clockLost: "I can no longer see the clock, I am carrying on with my estimates.",
  queenTaken: (by, to, c) => `${by} takes the queen on ${to}! ${c} wins the queen!`,
  queenTakenB: ["Oh my, what a thunderbolt!", "Hard to recover from that, the queen has fallen!", "A turning point in the game, no doubt."],
  captureA: (by, taken, to) => `${by} takes ${taken} on ${to}.`,
  captureB: ["An exchange that changes the balance.", "Well spotted, it had to be taken.", "We simplify the position a little.", "That opens up the game."],
  castle: (c, kingside) => `${c} castles ${kingside ? "kingside" : "queenside"}.`,
  castleB: ["The king is safe and the rook joins the game: two things in one.", "Castling, the safest move of the game."],
  promotion: (to, piece) => `Promotion! The pawn reaches ${to} and becomes ${piece}!`,
  promotionB: ["A long road for that pawn, and what a result!", "That could decide everything."],
  check: "Check!",
  checkB: ["The king is under attack, it must react right away.", "Watch the king, this has to be parried.", "A check that forces a reply."],
  mate: (c) => `Checkmate! ${c} wins.`,
  mateB: ["Magnificent finish, hats off!", "A beautiful game, well carried to the end."],
  draw: "The game is a draw.",
  drawB: ["Neither side can force the decision, we split the point.", "A share of the points after a fine fight."],
  engineMove: (m) => `The computer replies ${m}.`,
  engineMoveB: ["A precise move, as always.", "The reply is quick, the machine does not flinch.", "Now the player has to find an idea."],
  exactTime: (min, sec) => (min > 0 ? `${min} min ${String(sec).padStart(2, "0")}` : `${sec} seconds`),
  roughTime: (s) => (s >= 90 ? `about ${Math.round(s / 60)} minutes` : "about one minute"),
  lessThan: (n) => `less than ${n} seconds`,
  sideLc: (c) => (c === "w" ? "white" : "black"),
};

const PHRASES: Record<Lang, Phrases> = { fr: FR, en: EN };

export interface NarratorConfig {
  voices: 1 | 2;
  names: [string, string];
  seed: number;
  minGapMs: number; // do not talk over ourselves
  lang?: Lang; // missing = French
}
export const defaultNarratorConfig = (): NarratorConfig => ({ voices: 2, names: ["Jean", "Margot"], seed: 7, minGapMs: 900, lang: "fr" });

/**
 * Real-time commentary. Two voices: A calls the action, B adds colour / reaction. Lines are
 * deterministic per seed (testable) and rate-limited, with critical events able to cut in.
 */
export class Narrator {
  private n = 0;
  private lastT = -1e9;
  private lastLow = -1e9;
  constructor(public cfg: NarratorConfig = defaultNarratorConfig()) {}

  private get p(): Phrases { return PHRASES[this.cfg.lang ?? "fr"] ?? FR; }

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
    const c = this.p.colour;
    const to: string = m.to ?? "", file = to[0], rank = to[1], ply: number = m.ply ?? 0;
    if (m.piece === "q" && ply <= 12) return this.pick(c.queenEarly);
    if (m.piece === "n" && (file === "a" || file === "h")) return this.pick(c.knightEdge);
    if (m.piece === "p" && "de".includes(file) && "45".includes(rank)) return this.pick(c.centrePawn);
    if (m.piece === "p" && "abgh".includes(file)) return this.pick(c.wingPawn);
    if ((m.piece === "n" || m.piece === "b") && ply <= 12) return this.pick(c.develop);
    if (m.piece === "r") return this.pick(c.rook);
    if (m.piece === "k") return this.pick(c.king);
    if (ply > 60) return this.pick(c.endgame);
    if (ply > 20) return this.pick(c.middlegame);
    return null;
  }

  /** Time left, said as sure as the estimate is: exact when certain, rounded when roughly known, never a number when it is a guess. */
  private clockLines(e: ExperienceEvent): NarrationLine[] {
    const P = this.p, d = e.data ?? {}, t = e.t;
    const side: "w" | "b" = d.side === "b" ? "b" : "w";
    const conf = Number(d.conf ?? 0), s = Math.max(0, Math.round(Number(d.ms ?? 0) / 1000));
    const exact = P.exactTime(Math.floor(s / 60), s % 60);
    const approx = s >= 45 ? P.roughTime(s) : P.lessThan(Math.max(10, Math.ceil(s / 10) * 10 + 10));
    const amount = conf >= 0.7 ? exact : conf >= 0.4 ? approx : "";
    switch (e.type) {
      case "clock-low":
        return [this.line("A", P.clockLowA(side, amount), t, 2), this.line("B", this.pick(P.clockLowB), t, 1)];
      case "clock-critical":
        return [this.line("A", P.clockCriticalA(side, amount), t, 3), this.line("B", this.pick(P.clockCriticalB), t, 2)];
      case "clock-flag":
        return [this.line("A", P.clockFlagA(side, conf >= 0.7), t, 3)];
      default: // clock-lost
        return [this.line("B", P.clockLost, t, 1)];
    }
  }

  private describe(e: ExperienceEvent): NarrationLine[] {
    const P = this.p;
    const t = e.t;
    const d = e.data ?? {};
    switch (e.type) {
      case "seat":
        return [this.line("A", this.pick(P.seat), t, 3)];
      case "leave":
        return [this.line("A", this.pick(P.leave), t, 3)];
      case "mode":
        return d.mode === "engine"
          ? [this.line("A", P.engineMode(d.elo), t, 3), this.line("B", this.pick(P.engineSits), t, 1)]
          : [this.line("A", P.humanMode, t, 3), this.line("B", this.pick(P.humanSits), t, 1)];
      case "phase":
        if (d.phase === "intro") return [this.line("B", this.pick(P.introSays), t, 2)];
        if (d.phase === "outro") return [this.line("A", P.outro(d.result), t, 3)];
        return [];
      case "move": {
        const m = d;
        if (m.captured) return []; // handled by capture
        if (m.flags?.includes("k") || m.flags?.includes("q")) return []; // handled by castle
        if (m.promotion) return [];
        const piece = P.piece[m.piece];
        const cap = piece[0].toUpperCase() + piece.slice(1);
        const lead = this.pick(P.moveLead(P.byColor[m.color as "w" | "b"], piece, cap, m.san, m.to));
        const out = [this.line("A", lead, t, 1)];
        const c = (m.ply ?? 0) > 1 && (m.ply ?? 0) % 3 === 0 ? this.colour(m) : null;
        if (c) out.push(this.line("B", c, t, 0));
        return out;
      }
      case "capture": {
        const m = d;
        const taken = m.captured as string;
        const by = P.piece[m.piece][0].toUpperCase() + P.piece[m.piece].slice(1);
        if (taken === "q")
          return [
            this.line("A", P.queenTaken(by, m.to, P.byColor[m.color as "w" | "b"]), t, 3),
            this.line("B", this.pick(P.queenTakenB), t, 3),
          ];
        return [
          this.line("A", P.captureA(by, P.pieceCap[taken], m.to), t, 2),
          this.line("B", this.pick(P.captureB), t, 1),
        ];
      }
      case "castle":
        return [this.line("A", P.castle(P.byColor[d.color as "w" | "b"], String(d.flags ?? "").includes("k")), t, 2), this.line("B", this.pick(P.castleB), t, 1)];
      case "promotion":
        return [this.line("A", P.promotion(d.to, P.pieceCap[d.promotion] ?? P.defaultPromotion), t, 3), this.line("B", this.pick(P.promotionB), t, 2)];
      case "check":
        return [this.line("A", P.check, t, 3), this.line("B", this.pick(P.checkB), t, 2)];
      case "mate":
        return [this.line("A", P.mate(P.byColor[d.color as "w" | "b"]), t, 3), this.line("B", this.pick(P.mateB), t, 3)];
      case "draw":
        return [this.line("A", P.draw, t, 3), this.line("B", this.pick(P.drawB), t, 2)];
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
        return [this.line("A", P.engineMove(d.san ?? d.uci), t, 2), this.line("B", this.pick(P.engineMoveB), t, 1)];
      default:
        return [];
    }
  }
}
