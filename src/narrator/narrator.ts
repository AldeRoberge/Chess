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
  captureA: (by: string, taken: string, to: string) => string[];
  captureB: string[];
  /** Quiet-move colour from the shape of the move itself (rank reached, long retreats, ...). */
  pawnAdvance: string[]; pawnDeep: string[]; knightCentre: string[]; bishopLong: string[]; queenRetreat: string[]; opening: string[];
  /** Said now and then after a capture when one side is clearly ahead; `n` is the lead in pawns. */
  materialB: (leader: string, n: number) => string[];
  /** A capture that answers the previous capture on the same square. */
  recaptureB: string[];
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
  engineMove: (move: string) => string[];
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
  seat: ["Un joueur s'installe à la table.", "Nous avons un joueur à l'échiquier.", "Quelqu'un prend place, on va jouer.", "Le fauteuil est occupé, la scène est à lui."],
  leave: ["Le joueur se lève de la table.", "Le fauteuil se vide, on fait une pause.", "Il quitte l'échiquier, la partie attendra.", "Plus personne à la table pour le moment."],
  engineMode: (elo) => `Une partie contre l'ordinateur, réglé autour de ${elo} Elo.`,
  engineSits: ["Face à la machine, il faudra tenir sans une seule erreur.", "Elle ne se fatigue jamais, voyons comment il va s'y prendre.", "Un adversaire qui ne bluffe pas et ne sourit jamais.", "La machine a l'air calme. C'est toujours mauvais signe."],
  humanMode: "Une partie à deux joueurs, face à face.",
  humanSits: ["Rien de tel qu'un duel entre humains.", "Du jeu à l'ancienne, j'adore.", "Deux cerveaux, un échiquier : le programme parfait.", "Ici, les erreurs sont humaines, et c'est tant mieux."],
  introSays: ["Les lumières baissent, les pièces sont en place. Ça va commencer.", "Ambiance feutrée sur l'échiquier, on est prêts.", "Silence dans la salle, les pièces attendent.", "Tout est prêt, que le meilleur gagne."],
  outro: (result) => (result ? `La partie est terminée : ${result}.` : "La partie est terminée."),
  moveLead: (who, piece, cap, san, to) => [
    `${who} jouent ${piece} en ${to}.`, `${cap} va en ${to}.`, `${san}, ${piece} en ${to}.`, `${cap} se porte en ${to}.`,
    `${cap} file en ${to}.`, `${who} choisissent ${piece} en ${to}.`, `Direction ${to} pour ${piece}.`, `${san} : ${piece} atterrit en ${to}.`,
    `${cap} s'installe en ${to}.`, `Et voilà ${piece} en ${to}.`, `${who} avancent ${piece} vers ${to}.`, `${san}, sans hésiter.`,
  ],
  colour: {
    queenEarly: ["Sortie précoce de la dame, c'est audacieux.", "La dame se montre tôt, il faudra qu'elle fasse attention aux tempos perdus.", "Déjà la dame ? On aime le risque par ici.", "La dame part à l'aventure, espérons qu'elle revienne."],
    knightEdge: ["Un cavalier en bordure, on dit qu'il y est mal placé.", "Le cavalier sur le bord, c'est rarement son meilleur endroit.", "Un cavalier à la bande, ses options fondent comme neige.", "Sur le bord, le cavalier voit moins de cases. À surveiller."],
    centrePawn: ["Un pion au centre, c'est la logique même.", "Voilà qui prend de l'espace au centre.", "Le centre, toujours le centre : les manuels sourient.", "Un pion bien planté au milieu de l'échiquier."],
    wingPawn: ["Un coup d'aile, on prépare quelque chose de ce côté.", "Poussée sur l'aile, on cherche de l'espace.", "Les pions de l'aile s'ébranlent, une attaque se prépare peut-être.", "Un pion de rive, discret mais pas innocent."],
    develop: ["Un développement naturel.", "On met les pièces en jeu, rien à redire.", "Une pièce de plus dans la bataille.", "Du développement propre et sans fioriture."],
    rook: ["La tour cherche une colonne ouverte.", "Les tours entrent doucement dans la partie.", "La tour se réveille, attention aux colonnes.", "Une tour qui bouge, c'est souvent le signe que la partie s'ouvre."],
    king: ["Le roi se déplace, il faut rester prudent.", "Un coup de roi, on veut le mettre à l'abri.", "Le roi sort de sa réserve, prudence.", "Un roi en balade, ça n'annonce rien de tranquille."],
    endgame: ["On entre en finale, chaque tempo compte.", "Le matériel s'est allégé, la technique va décider.", "En finale, un seul pion peut tout changer.", "Il reste peu de pièces, mais chacune pèse lourd."],
    middlegame: ["On est en plein milieu de partie, la tension monte.", "La position se complique, tout peut arriver.", "Le milieu de partie bat son plein, on retient son souffle.", "Les menaces s'accumulent des deux côtés."],
  },
  pawnAdvance: ["Le pion avance, un pas à la fois.", "Poussée de pion, on gagne du terrain.", "Ce pion se rapproche de la case de promotion, doucement."],
  pawnDeep: ["Un pion déjà bien avancé, il faut l'arrêter.", "Ce pion est dangereusement loin, la promotion rôde.", "Attention au pion passé, il court vers la huitième rangée."],
  knightCentre: ["Le cavalier prend le centre, il rayonne.", "Un cavalier au centre, voilà une belle case.", "Le cavalier trouve un poste de choix."],
  bishopLong: ["Le fou prend la grande diagonale.", "Un fou à longue portée, ça va tirer loin.", "Le fou se déploie sur toute la diagonale."],
  queenRetreat: ["La dame bat en retraite, prudence.", "La dame se replie, histoire de ne pas se faire piéger.", "Un repli de la dame : sage décision."],
  opening: ["Ouverture classique, on connaît le chemin.", "Les premiers coups donnent le ton de la partie.", "On entre dans le vif du sujet, doucement."],
  clockLowA: (c, amount) => (amount ? `${FR.byColor[c]} n'ont plus beaucoup de temps : ${amount}.` : `${FR.byColor[c]} semblent manquer de temps.`),
  clockLowB: ["La pendule commence à peser.", "Le temps devient un adversaire de plus.", "Ça tictaque dans les têtes.", "Il va falloir accélérer le rythme."],
  clockCriticalA: (c, amount) => (amount ? `Attention, il reste ${amount} aux ${c === "w" ? "blancs" : "noirs"} !` : `${FR.byColor[c]} sont presque à court de temps !`),
  clockCriticalB: ["Chaque seconde compte maintenant.", "Il faut jouer vite, très vite.", "Les doigts tremblent au-dessus des pièces.", "Plus le temps de réfléchir, il faut sentir."],
  clockFlagA: (c, sure) => (sure ? `Le drapeau est tombé ! ${FR.byColor[c]} n'ont plus de temps.` : `Il semble que ${FR.sideLc(c)} soient à court de temps.`),
  clockLost: "Je ne vois plus la pendule, je continue avec mes estimations.",
  queenTaken: (by, to, c) => `${by} prend la dame en ${to} ! ${c} gagnent la dame !`,
  queenTakenB: ["Oh là là, quel coup de tonnerre !", "Impossible de s'en relever facilement, la dame est tombée !", "Un tournant de la partie, sans aucun doute.", "La dame ! Le public retient son souffle.", "Voilà qui change complètement la partie."],
  captureA: (by, taken, to) => [`${by} prend ${taken} en ${to}.`, `${by} s'empare de ${taken} en ${to}.`, `En ${to}, ${taken} est pris par ${by.toLowerCase()}.`, `${by} capture ${taken} en ${to}.`, `Prise ! ${by} emporte ${taken} en ${to}.`],
  captureB: ["Un échange qui change l'équilibre.", "Bien vu, il fallait prendre.", "On simplifie un peu la position.", "Voilà qui ouvre le jeu.", "Ça va faire réfléchir l'autre camp.", "Le matériel fond, la partie s'éclaircit.", "Une prise propre, nette, sans bavure.", "Reste à voir si la reprise sera possible."],
  recaptureB: ["Et ça reprend aussitôt, œil pour œil.", "La réponse est immédiate : on rend la monnaie.", "Une reprise sur la même case, l'échange est complet.", "Pas le temps de savourer, la case est déjà reprise."],
  materialB: (leader, n) => [`${leader} mènent maintenant de ${n} points au matériel.`, `Au compteur, ${leader.toLowerCase()} ont ${n} points d'avance.`, `Le matériel penche du côté de ${leader.toLowerCase()} : +${n}.`],
  castle: (c, kingside) => `${c} roquent ${kingside ? "côté roi" : "côté dame"}.`,
  castleB: ["Le roi est à l'abri, la tour entre en jeu : deux choses en un.", "Le roque, le geste le plus sûr de la partie.", "Un roque, et le roi respire enfin.", "Le roi s'abrite, la tour se réveille : bien joué.", "Voilà un roi qui dormira mieux ce soir."],
  promotion: (to, piece) => `Promotion ! Le pion arrive en ${to} et devient ${piece} !`,
  promotionB: ["Un long chemin pour ce pion, et quel résultat !", "Voilà qui peut tout décider.", "Le petit pion est devenu grand !", "Une nouvelle pièce sur l'échiquier, tout change."],
  check: "Échec !",
  checkB: ["Le roi est attaqué, il doit réagir tout de suite.", "Attention au roi, il faut parer ça.", "Un échec qui force la réponse.", "Le roi est sous pression, il n'a pas le choix.", "Voilà un échec qui fait mal.", "On touche au but, mais le roi a encore des ressources."],
  mate: (c) => `Échec et mat ! ${c} l'emportent.`,
  mateB: ["Magnifique finale, chapeau !", "Voilà une belle partie, bien menée jusqu'au bout.", "Le roi n'a plus nulle part où aller, rideau.", "Une conclusion sans appel, bravo."],
  draw: "La partie est nulle.",
  drawB: ["Personne ne peut forcer la décision, on se quitte sur un partage.", "Un partage des points, après un beau combat.", "Ni vainqueur ni vaincu, c'est ça aussi les échecs.", "Les deux camps ont défendu comme des lions."],
  engineMove: (m) => [`L'ordinateur répond ${m}.`, `La machine joue ${m}.`, `${m} : la réponse de l'ordinateur.`, `Réponse immédiate de l'ordinateur : ${m}.`, `L'ordinateur a choisi ${m}.`, `Et c'est ${m} côté machine.`],
  engineMoveB: ["Un coup précis, comme toujours.", "La réponse est rapide, la machine ne tremble pas.", "À lui de trouver une idée maintenant.", "La machine ne montre rien, mais elle a sûrement un plan.", "Même sans visage, elle a l'air sûre d'elle.", "Pas de visage, mais un jeu qui parle pour elle.","Elle n'a pas hésité une seconde, ça devrait inquiéter.", "Voyons si l'humain a une réponse à ça."],
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
  seat: ["A player sits down at the board.", "We have a player at the board.", "Someone takes a seat, let's play.", "The chair is taken, the stage is theirs."],
  leave: ["The player gets up from the table.", "The chair empties, we take a short break.", "They step away from the board, the game can wait.", "Nobody at the table for now."],
  engineMode: (elo) => `A game against the computer, set at about ${elo} Elo.`,
  engineSits: ["Against the machine, he will have to play without a single slip.", "It never tires, let's see how it goes about it.", "An opponent that never bluffs and never smiles.", "The machine looks calm. That is always a bad sign."],
  humanMode: "A two-player game, face to face.",
  humanSits: ["Nothing like a duel between humans.", "Old-school chess, I love it.", "Two brains, one board: the perfect programme.", "Here the mistakes are human, and that is just fine."],
  introSays: ["The lights dim, the pieces are in place. Here we go.", "A hushed mood over the board, we are ready.", "Silence in the room, the pieces are waiting.", "Everything is ready, may the best player win."],
  outro: (result) => (result ? `The game is over: ${result}.` : "The game is over."),
  moveLead: (who, piece, cap, san, to) => [
    `${who} plays ${piece} to ${to}.`, `${cap} goes to ${to}.`, `${san}, ${piece} to ${to}.`, `${cap} moves to ${to}.`,
    `${cap} heads to ${to}.`, `${who} picks ${piece} to ${to}.`, `Off to ${to} goes ${piece}.`, `${san}: ${piece} lands on ${to}.`,
    `${cap} settles on ${to}.`, `And there is ${piece} on ${to}.`, `${who} advance ${piece} towards ${to}.`, `${san}, without hesitation.`,
  ],
  colour: {
    queenEarly: ["An early queen sortie, that is bold.", "The queen comes out early, she will have to watch for lost tempi.", "The queen already? Someone likes risk.", "The queen sets off on an adventure, let's hope she comes back."],
    knightEdge: ["A knight on the rim, they say it is badly placed there.", "A knight on the edge is rarely at its best.", "A knight on the edge, its options melt like snow.", "On the rim the knight sees fewer squares. Worth watching."],
    centrePawn: ["A pawn in the centre, that is pure logic.", "That pawn grabs space in the centre.", "The centre, always the centre: the textbooks smile.", "A pawn planted firmly in the middle of the board."],
    wingPawn: ["A wing push, something is being prepared on this side.", "Pushing on the wing, looking for space.", "The wing pawns stir, an attack may be brewing.", "A rim pawn, quiet but not innocent."],
    develop: ["A natural development.", "Pieces into play, nothing to object to.", "One more piece joins the battle.", "Clean development, no frills."],
    rook: ["The rook is looking for an open file.", "The rooks are slowly entering the game.", "The rook wakes up, mind the files.", "A rook move usually means the game is opening up."],
    king: ["The king moves, caution is needed.", "A king move, they want to shelter it.", "The king steps out of its shell, careful.", "A wandering king never signals a quiet game."],
    endgame: ["We are entering the endgame, every tempo counts.", "The material has thinned out, technique will decide.", "In the endgame a single pawn can change everything.", "Few pieces left, but each one weighs a ton."],
    middlegame: ["We are in the middlegame, the tension rises.", "The position is getting complicated, anything can happen.", "The middlegame is in full swing, hold your breath.", "Threats are piling up on both sides."],
  },
  pawnAdvance: ["The pawn advances, one step at a time.", "A pawn push, gaining ground.", "That pawn inches towards promotion."],
  pawnDeep: ["A pawn already far advanced, it must be stopped.", "That pawn is dangerously far, promotion is looming.", "Watch the passed pawn, it is running for the last rank."],
  knightCentre: ["The knight takes the centre, it shines there.", "A knight in the centre, what a fine square.", "The knight finds a prime outpost."],
  bishopLong: ["The bishop takes the long diagonal.", "A long-range bishop, it will shoot far.", "The bishop spreads along the whole diagonal."],
  queenRetreat: ["The queen retreats, careful.", "The queen falls back, so as not to get trapped.", "A queen retreat: a wise decision."],
  opening: ["A classical opening, we know the road.", "The first moves set the tone of the game.", "We get to the heart of the matter, gently."],
  clockLowA: (c, amount) => (amount ? `${EN.byColor[c]} are low on time: ${amount}.` : `${EN.byColor[c]} seem short of time.`),
  clockLowB: ["The clock is starting to weigh.", "Time is becoming one more opponent.", "The ticking is getting loud.", "The pace will have to pick up."],
  clockCriticalA: (c, amount) => (amount ? `Careful, ${EN.byColor[c]} have ${amount} left!` : `${EN.byColor[c]} are almost out of time!`),
  clockCriticalB: ["Every second counts now.", "They must play fast, very fast.", "Fingers are trembling over the pieces.", "No time left to think, it is all instinct."],
  clockFlagA: (c, sure) => (sure ? `The flag has fallen! ${EN.byColor[c]} are out of time.` : `It seems ${EN.sideLc(c)} are out of time.`),
  clockLost: "I can no longer see the clock, I am carrying on with my estimates.",
  queenTaken: (by, to, c) => `${by} takes the queen on ${to}! ${c} wins the queen!`,
  queenTakenB: ["Oh my, what a thunderbolt!", "Hard to recover from that, the queen has fallen!", "A turning point in the game, no doubt.", "The queen! The crowd holds its breath.", "That changes the whole game."],
  captureA: (by, taken, to) => [`${by} takes ${taken} on ${to}.`, `${by} grabs ${taken} on ${to}.`, `On ${to}, ${taken} is taken by ${by.toLowerCase()}.`, `${by} captures ${taken} on ${to}.`, `Capture! ${by} carries off ${taken} on ${to}.`],
  captureB: ["An exchange that changes the balance.", "Well spotted, it had to be taken.", "We simplify the position a little.", "That opens up the game.", "That will give the other side something to think about.", "The material melts, the game clears up.", "A clean, crisp capture, no mess.", "Now to see whether a recapture is possible."],
  recaptureB: ["And it is retaken straight away, an eye for an eye.", "The answer is immediate: change is given back.", "A recapture on the same square, the exchange is complete.", "No time to savour it, the square is already retaken."],
  materialB: (leader, n) => [`${leader} now lead by ${n} points of material.`, `On the scoreboard, ${leader.toLowerCase()} are ${n} points up.`, `The material leans towards ${leader.toLowerCase()}: +${n}.`],
  castle: (c, kingside) => `${c} castles ${kingside ? "kingside" : "queenside"}.`,
  castleB: ["The king is safe and the rook joins the game: two things in one.", "Castling, the safest move of the game.", "A castle, and the king finally breathes.", "King sheltered, rook awake: well played.", "That king will sleep better tonight."],
  promotion: (to, piece) => `Promotion! The pawn reaches ${to} and becomes ${piece}!`,
  promotionB: ["A long road for that pawn, and what a result!", "That could decide everything.", "The little pawn has grown up!", "A new piece on the board, everything changes."],
  check: "Check!",
  checkB: ["The king is under attack, it must react right away.", "Watch the king, this has to be parried.", "A check that forces a reply.", "The king is under pressure, no choice here.", "That check hurts.", "Close to the goal, but the king still has resources."],
  mate: (c) => `Checkmate! ${c} wins.`,
  mateB: ["Magnificent finish, hats off!", "A beautiful game, well carried to the end.", "The king has nowhere left to go, curtain.", "A conclusion with no appeal, bravo."],
  draw: "The game is a draw.",
  drawB: ["Neither side can force the decision, we split the point.", "A share of the points after a fine fight.", "No winner, no loser, that is chess too.", "Both sides defended like lions."],
  engineMove: (m) => [`The computer replies ${m}.`, `The machine plays ${m}.`, `${m}: the computer's answer.`, `Instant reply from the computer: ${m}.`, `The computer has chosen ${m}.`, `And it is ${m} from the machine.`],
  engineMoveB: ["A precise move, as always.", "The reply is quick, the machine does not flinch.", "Now the player has to find an idea.", "The machine shows nothing, but surely has a plan.", "No face, yet it looks sure of itself.", "No face, but a game that speaks for it.","It did not hesitate for a second, which should worry you.", "Let's see if the human has an answer to that."],
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
export const defaultNarratorConfig = (): NarratorConfig => ({ voices: 2, names: ["Jean", "Margot"], seed: Math.floor(Math.random() * 0x7fffffff), minGapMs: 900, lang: "fr" });

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

  /** The last things said: a phrase is not reused until it has aged out, so long games never loop on the same lines. */
  private recent: string[] = [];
  private mat = { w: 0, b: 0 }; // material won so far, in pawns
  private lastCapture: { to: string; color: string } | null = null;
  private lastMaterialT = -1e9;

  private pick(xs: string[]): string {
    const fresh = xs.filter((x) => !this.recent.includes(x));
    // Exhausted a small phrase bank? Reuse only its least recently spoken line.
    const oldest = Math.min(...xs.map((x) => this.recent.lastIndexOf(x)));
    const pool = fresh.length ? fresh : xs.filter((x) => this.recent.lastIndexOf(x) === oldest);
    this.n = (Math.imul(this.n, 1664525) + 1013904223 + this.cfg.seed) >>> 0;
    const s = pool[Math.floor((this.n / 0x100000000) * pool.length)];
    this.recent.push(s); if (this.recent.length > 24) this.recent.shift();
    return s;
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
    const P = this.p, c = { ...P.colour, queenRetreat: P.queenRetreat, pawnDeep: P.pawnDeep, pawnAdvance: P.pawnAdvance, knightCentre: P.knightCentre, bishopLong: P.bishopLong, opening: P.opening };
    const to: string = m.to ?? "", file = to[0], rank = to[1], ply: number = m.ply ?? 0;
    const from: string = m.from ?? "", white = m.color !== "b", rel = white ? Number(rank) : 9 - Number(rank); // rank counted from the mover's side
    if (m.piece === "q" && ply <= 12) return this.pick(c.queenEarly);
    if (m.piece === "q" && from && Number(from[1]) !== Number(rank) && (white ? Number(rank) < Number(from[1]) : Number(rank) > Number(from[1])) && ply > 12) return this.pick(c.queenRetreat);
    if (m.piece === "p" && rel >= 6) return this.pick(c.pawnDeep);
    if (m.piece === "n" && (file === "a" || file === "h")) return this.pick(c.knightEdge);
    if (m.piece === "n" && "cdef".includes(file) && "3456".includes(rank) && ply > 12) return this.pick(c.knightCentre);
    if (m.piece === "b" && from && Math.abs(from.charCodeAt(0) - to.charCodeAt(0)) >= 3) return this.pick(c.bishopLong);
    if (m.piece === "p" && ply > 20 && rel >= 5) return this.pick(c.pawnAdvance);
    if (m.piece === "p" && "de".includes(file) && "45".includes(rank)) return this.pick(c.centrePawn);
    if (m.piece === "p" && "abgh".includes(file)) return this.pick(c.wingPawn);
    if ((m.piece === "n" || m.piece === "b") && ply <= 12) return this.pick(c.develop);
    if (m.piece === "r") return this.pick(c.rook);
    if (m.piece === "k") return this.pick(c.king);
    if (ply <= 4) return this.pick(c.opening);
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
        const color = (m.color === "b" ? "b" : "w") as "w" | "b", value: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };
        this.mat[color] += value[taken] ?? 0;
        const recapture = !!this.lastCapture && this.lastCapture.to === m.to && this.lastCapture.color !== color;
        this.lastCapture = { to: m.to, color };
        const lead = this.mat.w - this.mat.b, ahead: "w" | "b" = lead > 0 ? "w" : "b";
        if (taken === "q")
          return [
            this.line("A", P.queenTaken(by, m.to, P.byColor[m.color as "w" | "b"]), t, 3),
            this.line("B", this.pick(P.queenTakenB), t, 3),
          ];
        // the second voice reacts to the story so far: a recapture, a clear lead, or just the capture itself
        const material = Math.abs(lead) >= 3 && t - this.lastMaterialT > 60000;
        if (material) this.lastMaterialT = t;
        return [
          this.line("A", this.pick(P.captureA(by, P.pieceCap[taken], m.to)), t, 2),
          this.line("B", this.pick(recapture ? P.recaptureB : material ? P.materialB(P.byColor[ahead], Math.abs(lead)) : P.captureB), t, 1),
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
        return [this.line("A", this.pick(P.engineMove(d.san ?? d.uci)), t, 2), this.line("B", this.pick(P.engineMoveB), t, 1)];
      default:
        return [];
    }
  }
}
