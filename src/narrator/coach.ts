import { Chess, type Color, type Square } from "chess.js";
import type { ExperienceEvent } from "../core/events";
import { coachTier, type CoachLevel } from "./coachSettings";

type Lang = "fr" | "en";
type Bi = { en: string; fr: string };
export type Speaker = "A" | "B" | "C";

/** A line the coach adds to the commentary. `squares` are lit on the board while it is said. */
export interface CoachLine { speaker: Speaker; text: string; priority: number; squares?: string[]; label?: string; tag: "coach" | "opponent" }

/** Something with a name a player can learn: an opening, a tactic or a pawn structure. */
interface Concept {
  id: string;
  kind: "opening" | "tactic" | "structure";
  /** Bare name ("Sicilian Defence") and with its article ("the Sicilian Defence"). */
  name: Bi; art: Bi;
  /** Plain-words reason for beginners, and a short technical one for strong players. */
  simple: Bi; short: Bi;
  /** Worth mentioning to an expert. */
  subtle?: boolean;
  /** A trivia question this naturally leads to. */
  trivia?: string;
}

const C = (id: string, kind: Concept["kind"], name: [string, string], art: [string, string], simple: [string, string], short: [string, string], extra: Partial<Concept> = {}): Concept =>
  ({ id, kind, name: { en: name[0], fr: name[1] }, art: { en: art[0], fr: art[1] }, simple: { en: simple[0], fr: simple[1] }, short: { en: short[0], fr: short[1] }, ...extra });

export const CONCEPTS: Record<string, Concept> = Object.fromEntries([
  // openings
  C("queens-gambit", "opening", ["Queen's Gambit", "gambit dame"], ["the Queen's Gambit", "le gambit dame"],
    ["White offers the c-pawn to pull Black's d-pawn away from the centre", "les blancs offrent le pion c pour détourner le pion d noir du centre"],
    ["c4 challenges d5 and trades a wing pawn for central influence", "c4 attaque d5 et échange un pion de l'aile contre le centre"], { trivia: "gambit" }),
  C("qga", "opening", ["Queen's Gambit Accepted", "gambit dame accepté"], ["the Queen's Gambit Accepted", "le gambit dame accepté"],
    ["Black takes the offered pawn, giving up the centre for now to win material", "les noirs prennent le pion offert et cèdent le centre pour l'instant"],
    ["Black concedes the centre; White regains c4 with quick development", "les noirs cèdent le centre, les blancs récupèrent c4 en se développant"], { subtle: true }),
  C("qgd", "opening", ["Queen's Gambit Declined", "gambit dame refusé"], ["the Queen's Gambit Declined", "le gambit dame refusé"],
    ["Black refuses the pawn and backs up the d5 pawn with e6", "les noirs refusent le pion et soutiennent d5 avec e6"],
    ["solid d5 chain, at the cost of locking in the light-squared bishop", "chaîne solide sur d5, mais le fou de cases blanches est enfermé"], { subtle: true }),
  C("slav", "opening", ["Slav Defence", "défense slave"], ["the Slav Defence", "la défense slave"],
    ["Black defends d5 with the c-pawn, keeping the light bishop free", "les noirs soutiennent d5 avec le pion c et gardent leur fou libre"],
    ["holds d5 without blocking the c8 bishop", "tient d5 sans enfermer le fou c8"], { subtle: true }),
  C("kings-gambit", "opening", ["King's Gambit", "gambit roi"], ["the King's Gambit", "le gambit roi"],
    ["White offers the f-pawn to open lines and grab the centre fast", "les blancs offrent le pion f pour ouvrir les lignes et prendre le centre"],
    ["f4 sacrifices a pawn for the f-file and central control, weakening e1-h4", "f4 sacrifie un pion pour la colonne f et le centre, mais affaiblit e1-h4"], { trivia: "gambit" }),
  C("sicilian", "opening", ["Sicilian Defence", "défense sicilienne"], ["the Sicilian Defence", "la défense sicilienne"],
    ["Black fights for the centre from the side with the c-pawn, making the game unbalanced", "les noirs luttent pour le centre depuis le côté avec le pion c, la partie devient déséquilibrée"],
    ["asymmetrical: Black trades a wing pawn for a central one later", "asymétrique : les noirs échangeront un pion d'aile contre un pion central"]),
  C("french", "opening", ["French Defence", "défense française"], ["the French Defence", "la défense française"],
    ["Black prepares d5 with a small, safe pawn step", "les noirs préparent d5 avec un petit pas de pion très sûr"],
    ["solid but cramped; the c8 bishop is the problem piece", "solide mais à l'étroit ; le fou c8 est la pièce à problème"]),
  C("caro-kann", "opening", ["Caro-Kann Defence", "défense Caro-Kann"], ["the Caro-Kann Defence", "la défense Caro-Kann"],
    ["Black prepares d5 while keeping the light bishop free to come out", "les noirs préparent d5 en gardant leur fou de cases blanches libre"],
    ["like the French but the c8 bishop gets out before e6", "comme la française, mais le fou c8 sort avant e6"]),
  C("scandinavian", "opening", ["Scandinavian Defence", "défense scandinave"], ["the Scandinavian Defence", "la défense scandinave"],
    ["Black hits the e4 pawn straight away", "les noirs attaquent le pion e4 tout de suite"],
    ["immediate central trade; the queen often recaptures early and loses time", "échange central immédiat ; la dame reprend souvent tôt et perd du temps"]),
  C("ruy-lopez", "opening", ["Ruy Lopez", "partie espagnole"], ["the Ruy Lopez", "la partie espagnole"],
    ["the bishop puts pressure on the knight that defends Black's e5 pawn", "le fou fait pression sur le cavalier qui défend le pion e5"],
    ["indirect pressure on e5 via the c6 knight", "pression indirecte sur e5 via le cavalier c6"]),
  C("italian", "opening", ["Italian Game", "partie italienne"], ["the Italian Game", "la partie italienne"],
    ["the bishop aims at f7, the weakest square near Black's king", "le fou vise f7, la case la plus faible près du roi noir"],
    ["quick development with the bishop eyeing f7", "développement rapide, le fou vise f7"]),
  C("scotch", "opening", ["Scotch Game", "partie écossaise"], ["the Scotch Game", "la partie écossaise"],
    ["White opens the centre right away with d4", "les blancs ouvrent le centre tout de suite avec d4"],
    ["early d4 releases the central tension at once", "d4 précoce, la tension centrale se règle tout de suite"]),
  C("petrov", "opening", ["Petrov Defence", "défense Petrov"], ["the Petrov Defence", "la défense Petrov"],
    ["Black copies White and counter-attacks the e4 pawn", "les noirs copient les blancs et contre-attaquent le pion e4"],
    ["symmetrical counter-attack on e4, famously drawish", "contre-attaque symétrique sur e4, réputée nulle"], { subtle: true }),
  C("kings-indian", "opening", ["King's Indian Defence", "défense est-indienne"], ["the King's Indian Defence", "la défense est-indienne"],
    ["Black lets White take the centre and plans to attack it later", "les noirs laissent le centre aux blancs pour l'attaquer plus tard"],
    ["hypermodern: g6 and Bg7 strike at the centre from afar", "hypermoderne : g6 et Fg7 frappent le centre de loin"]),
  C("nimzo", "opening", ["Nimzo-Indian Defence", "défense nimzo-indienne"], ["the Nimzo-Indian Defence", "la défense nimzo-indienne"],
    ["the bishop pins the knight so White can't easily play e4", "le fou cloue le cavalier pour empêcher e4"],
    ["Bb4 pins c3 and fights for e4, often giving doubled c-pawns", "Fb4 cloue c3 et lutte pour e4, souvent au prix de pions c doublés"], { subtle: true }),
  C("dutch", "opening", ["Dutch Defence", "défense hollandaise"], ["the Dutch Defence", "la défense hollandaise"],
    ["Black grabs the e4 square with the f-pawn", "les noirs contrôlent e4 avec le pion f"],
    ["f5 fights for e4 at some cost to king safety", "f5 lutte pour e4 au détriment de la sécurité du roi"], { subtle: true }),
  C("english", "opening", ["English Opening", "ouverture anglaise"], ["the English Opening", "l'ouverture anglaise"],
    ["White controls the centre from the side, with the c-pawn", "les blancs contrôlent le centre depuis le côté avec le pion c"],
    ["flank opening aiming at d5", "ouverture de flanc qui vise d5"]),
  C("london", "opening", ["London System", "système de Londres"], ["the London System", "le système de Londres"],
    ["White builds the same solid set-up almost whatever Black does", "les blancs montent la même structure solide presque quoi que fassent les noirs"],
    ["Bf4 before e3 keeps the dark bishop outside the pawn chain", "Ff4 avant e3 garde le fou hors de la chaîne de pions"]),
  C("pirc", "opening", ["Pirc Defence", "défense Pirc"], ["the Pirc Defence", "la défense Pirc"],
    ["Black lets White build a big centre and plans to undermine it", "les noirs laissent les blancs bâtir un grand centre pour le saper ensuite"],
    ["hypermodern answer to e4 with a kingside fianchetto", "réponse hypermoderne à e4 avec un fianchetto"], { subtle: true }),
  // tactics
  C("fork", "tactic", ["fork", "fourchette"], ["a fork", "une fourchette"],
    ["one piece attacks two enemy pieces at once, and only one can escape", "une seule pièce attaque deux pièces adverses à la fois, et une seule peut s'échapper"],
    ["double attack on two targets", "double attaque sur deux cibles"]),
  C("pin", "tactic", ["pin", "clouage"], ["a pin", "un clouage"],
    ["the piece in front can't move without exposing a more valuable piece behind it", "la pièce de devant ne peut pas bouger sans exposer une pièce plus précieuse derrière"],
    ["the front piece is tied to the line", "la pièce de devant est liée à la ligne"], { subtle: true }),
  C("skewer", "tactic", ["skewer", "enfilade"], ["a skewer", "une enfilade"],
    ["the valuable piece in front must move, and the piece behind it falls", "la pièce précieuse de devant doit bouger, et celle de derrière tombe"],
    ["a reverse pin: the bigger piece is in front", "un clouage inversé : la grosse pièce est devant"], { subtle: true }),
  // structures
  C("isolated-pawn", "structure", ["isolated pawn", "pion isolé"], ["an isolated pawn", "un pion isolé"],
    ["no friendly pawn on the files next to it can ever protect it", "aucun pion ami sur les colonnes voisines ne pourra jamais le protéger"],
    ["no neighbours: a target, and the square in front is an outpost", "sans voisins : une cible, et la case devant devient un avant-poste"], { subtle: true }),
  C("iqp", "structure", ["isolated queen's pawn", "pion dame isolé"], ["an isolated queen's pawn", "un pion dame isolé"],
    ["the d-pawn has no pawns beside it: it gives space now but can be weak later", "le pion d n'a plus de voisins : il donne de l'espace mais peut devenir faible"],
    ["IQP: dynamic piece play now, endgame weakness later", "pion dame isolé : jeu de pièces actif maintenant, faiblesse en finale"], { subtle: true }),
  C("doubled-pawns", "structure", ["doubled pawns", "pions doublés"], ["doubled pawns", "des pions doublés"],
    ["two pawns of the same colour stand on one file and can't protect each other", "deux pions de la même couleur sont sur la même colonne et ne se protègent pas"],
    ["two pawns on one file, but the half-open file can compensate", "deux pions sur une colonne, compensés parfois par une colonne semi-ouverte"]),
  C("passed-pawn", "structure", ["passed pawn", "pion passé"], ["a passed pawn", "un pion passé"],
    ["no enemy pawn can stop it on its way to promotion", "aucun pion adverse ne peut l'arrêter sur le chemin de la promotion"],
    ["no enemy pawns ahead or beside: it must be blockaded", "aucun pion adverse devant ni à côté : il faut le bloquer"], { subtle: true }),
  C("fianchetto", "structure", ["fianchetto", "fianchetto"], ["a fianchetto", "un fianchetto"],
    ["the bishop sits behind a pawn on the long diagonal and watches the whole board", "le fou se place derrière un pion sur la grande diagonale et surveille tout l'échiquier"],
    ["bishop on the long diagonal; the pawn in front is a hook to watch", "fou sur la grande diagonale ; le pion devant peut servir de point d'attaque"], { trivia: "fianchetto" }),
].map((c) => [c.id, c]));

/** Openings by their defining moves. Longer lines fire later as the game follows them. */
const BOOK: [string, string[]][] = [
  ["queens-gambit", ["d4", "d5", "c4"]], ["qga", ["d4", "d5", "c4", "dxc4"]], ["qgd", ["d4", "d5", "c4", "e6"]], ["slav", ["d4", "d5", "c4", "c6"]],
  ["kings-gambit", ["e4", "e5", "f4"]], ["sicilian", ["e4", "c5"]], ["french", ["e4", "e6"]], ["caro-kann", ["e4", "c6"]], ["scandinavian", ["e4", "d5"]],
  ["ruy-lopez", ["e4", "e5", "Nf3", "Nc6", "Bb5"]], ["italian", ["e4", "e5", "Nf3", "Nc6", "Bc4"]], ["scotch", ["e4", "e5", "Nf3", "Nc6", "d4"]], ["petrov", ["e4", "e5", "Nf3", "Nf6"]],
  ["pirc", ["e4", "d6", "d4", "Nf6"]], ["kings-indian", ["d4", "Nf6", "c4", "g6"]], ["nimzo", ["d4", "Nf6", "c4", "e6", "Nc3", "Bb4"]], ["dutch", ["d4", "f5"]],
  ["english", ["c4"]], ["london", ["d4", "d5", "Bf4"]], ["london", ["d4", "Nf6", "Bf4"]],
];

/** Trivia the table can bring up between moves. `adv` questions wait for intermediate players and up. */
interface Trivia { id: string; q: Bi; a: Bi; adv?: boolean }
const T = (id: string, q: [string, string], a: [string, string], adv = false): Trivia => ({ id, q: { en: q[0], fr: q[1] }, a: { en: a[0], fr: a[1] }, adv });
export const TRIVIA: Trivia[] = [
  T("gambit", ["Do you know what a gambit is?", "Tu sais ce qu'est un gambit ?"],
    ["A gambit is an opening where a player sacrifices material, usually a pawn, to get quick development or the initiative.", "Un gambit, c'est une ouverture où l'on sacrifie du matériel, souvent un pion, pour gagner du développement ou l'initiative."]),
  T("values", ["Do you know what each piece is worth?", "Tu connais la valeur de chaque pièce ?"],
    ["Roughly: a pawn is one, a knight or bishop three, a rook five and the queen nine. The king is priceless.", "En gros : un pion vaut un, un cavalier ou un fou trois, une tour cinq et la dame neuf. Le roi n'a pas de prix."]),
  T("en-passant", ["Do you know the en passant rule?", "Tu connais la prise en passant ?"],
    ["When a pawn jumps two squares and lands beside an enemy pawn, that pawn may capture it as if it had moved one square, but only on the very next move.", "Quand un pion avance de deux cases et arrive à côté d'un pion adverse, celui-ci peut le prendre comme s'il n'avait avancé que d'une case, mais seulement au coup suivant."]),
  T("castling", ["Did you know there are three ways you can't castle?", "Tu sais quand on n'a pas le droit de roquer ?"],
    ["You can't castle out of check, through an attacked square, or once the king or that rook has moved.", "On ne roque pas en échec, ni en traversant une case attaquée, ni si le roi ou la tour ont déjà bougé."]),
  T("stalemate", ["Do you know the difference between checkmate and stalemate?", "Tu connais la différence entre mat et pat ?"],
    ["In stalemate the side to move is not in check but has no legal move, and the game is a draw.", "Au pat, le camp au trait n'est pas en échec mais n'a aucun coup légal : la partie est nulle."]),
  T("fianchetto", ["Do you know what fianchetto means?", "Tu sais ce que veut dire fianchetto ?"],
    ["It's Italian for 'little flank': the bishop goes to b2 or g2, behind a pawn on b3 or g3, and sweeps the long diagonal.", "C'est de l'italien, « petit flanc » : le fou va en b2 ou g2, derrière un pion en b3 ou g3, et balaie la grande diagonale."]),
  T("tempo", ["What's a tempo in chess?", "C'est quoi, un temps, aux échecs ?"],
    ["One move's worth of time. Losing a tempo means spending a move without improving your position.", "Un coup de temps. Perdre un temps, c'est jouer un coup qui n'améliore rien."]),
  T("shannon", ["Guess how many different chess games are possible?", "Devine combien de parties d'échecs différentes sont possibles ?"],
    ["More than the atoms in the observable universe: the Shannon number puts it around ten to the power one hundred and twenty.", "Plus que d'atomes dans l'univers observable : le nombre de Shannon l'estime à environ dix puissance cent vingt."]),
  T("fifty", ["Do you know the fifty-move rule?", "Tu connais la règle des cinquante coups ?"],
    ["If fifty moves go by on each side with no capture and no pawn move, either player can claim a draw.", "Si cinquante coups passent de chaque côté sans prise ni coup de pion, un joueur peut réclamer la nulle."], true),
  T("zugzwang", ["Ever heard of zugzwang?", "Tu as déjà entendu parler du zugzwang ?"],
    ["It's German for 'compulsion to move': every move you could make makes your position worse.", "C'est de l'allemand, « obligation de jouer » : chaque coup possible empire ta position."], true),
  T("opposition", ["What does it mean to have the opposition?", "Que veut dire « avoir l'opposition » ?"],
    ["The kings face each other with one square between them, and the side not to move has it: the other king must give way.", "Les rois se font face avec une case entre eux, et le camp qui n'a pas le trait l'a : l'autre roi doit céder."], true),
  T("luft", ["Do you know what luft is?", "Tu sais ce qu'est le « luft » ?"],
    ["German for 'air': a pawn move in front of the castled king so it has an escape square from back-rank mates.", "De l'allemand, « air » : un coup de pion devant le roi roqué pour lui donner une case de fuite contre le mat du couloir."], true),
  T("desperado", ["Do you know what a desperado is?", "Tu sais ce qu'est un desperado ?"],
    ["A piece that is lost anyway, so it sells itself as dearly as possible by capturing something on its way out.", "Une pièce perdue de toute façon, qui se vend le plus cher possible en prenant quelque chose avant de tomber."], true),
];

const pick = <T,>(xs: T[], n: number): T => xs[((n % xs.length) + xs.length) % xs.length];

/** The opponent's own lines, in character. */
const OPP = {
  hello: { en: ["Hello, I'm {me}. Let's have a good game!", "{me} here. Good luck, you'll need it. Just kidding!"], fr: ["Bonjour, moi c'est {me}. Bonne partie !", "{me} au rapport. Bonne chance, tu vas en avoir besoin. Je plaisante !"] },
  myMove: { en: ["Your move.", "Let's see how you handle that.", "Hmm, I like this square.", "I thought about that one for a while.", "Your turn. No pressure."], fr: ["À toi.", "Voyons comment tu réponds à ça.", "Hmm, j'aime bien cette case.", "Celui-là, j'y ai réfléchi.", "À toi de jouer. Sans pression."] },
  iTake: { en: ["Thank you for the {piece}!", "I'll take that {piece}, thanks.", "Mine now."], fr: ["Merci pour {piece} !", "Je prends {piece}, merci.", "À moi maintenant."] },
  youTake: { en: ["Ouch, I'll miss that {piece}.", "Hey, I needed that {piece}!", "Fine, take it. I have a plan."], fr: ["Aïe, {piece} va me manquer.", "Hé, j'avais besoin de {piece} !", "Bon, prends-le. J'ai un plan."] },
  iCheck: { en: ["Check! Mind your king.", "Check. Where will your king hide?"], fr: ["Échec ! Attention à ton roi.", "Échec. Où va se cacher ton roi ?"] },
  youCheck: { en: ["Check? I saw that coming. I think.", "Okay, okay, my king is moving."], fr: ["Échec ? Je l'avais vu venir. Je crois.", "D'accord, d'accord, mon roi bouge."] },
  iWin: { en: ["Checkmate! Good game, thanks for playing."], fr: ["Échec et mat ! Bonne partie, merci d'avoir joué."] },
  youWin: { en: ["Well played! You got me. Rematch?"], fr: ["Bien joué ! Tu m'as eu. Revanche ?"] },
  draw: { en: ["A draw. A fair result, I'd say."], fr: ["Nulle. Un résultat juste, je trouve."] },
  myTactic: { en: ["Did you spot my {name}?", "That's my {name}. I'm rather proud of it.", "Careful, {name} incoming."], fr: ["Tu as vu ma {name} ?", "C'est ma {name}. J'en suis assez fier.", "Attention, {name} en vue."] },
  yourTactic: { en: ["Nice {name}. I didn't see that.", "Hmm, a {name}. You've been studying.", "Ouch, that {name} hurts."], fr: ["Joli coup, ce {name}. Je ne l'avais pas vu.", "Hmm, {name}. Tu as révisé.", "Aïe, ce {name} fait mal."] },
  askPrefix: { en: ["Quick question while you think: ", "Trivia time! ", "Here's one for you: "], fr: ["Petite question pendant que tu réfléchis : ", "C'est l'heure du quiz ! ", "Une question pour toi : "] },
};

const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
const PIECE: Record<Lang, Record<string, string>> = {
  en: { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" },
  fr: { p: "le pion", n: "le cavalier", b: "le fou", r: "la tour", q: "la dame", k: "le roi" },
};

export interface CoachConfig {
  level: CoachLevel;
  lang: Lang;
  /** The AI opponent's colour while a game against it runs; null = no opponent at the table. */
  opponent: Color | null;
  opponentTalks: boolean;
  /** Names used when one voice answers another. */
  names: { A: string; C: string };
}

interface Found { concept: Concept; squares: string[]; side: Color }

const files = "abcdefgh";
const sqName = (f: number, r: number) => `${files[f]}${r + 1}` as Square;

/**
 * Explains the game as it is played: names openings, tactics and pawn structures ("this is known as a … because …"),
 * asks and answers trivia, and lets the AI opponent talk in character. Deterministic per seed.
 */
export class Coach {
  private game = new Chess();
  private synced = true;
  private said = new Set<string>();
  private asked = new Set<string>();
  private pending: { trivia: Trivia; asker: Speaker; ply: number } | null = null;
  private lastTriviaPly = 0;
  private lastInsightPly = -99;
  private ownMoves = 0;
  private greeted = false;
  private n: number;
  constructor(public cfg: CoachConfig, seed = 1) { this.n = seed >>> 0; }

  private rnd() { this.n = (Math.imul(this.n, 1664525) + 1013904223) >>> 0; return this.n; }
  private get tier() { return coachTier(this.cfg.level); }
  private get L(): Lang { return this.cfg.lang === "en" ? "en" : "fr"; }
  private get oppOn() { return this.cfg.opponentTalks && !!this.cfg.opponent; }
  private opp(key: keyof typeof OPP, vars: Record<string, string> = {}) {
    let s = pick(OPP[key][this.L], this.rnd());
    for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
    return s;
  }
  /** How chatty the opponent is: every move at beginner, every few moves at expert. */
  private get banterEvery() { return [3, 2, 3, 4, 6][this.tier]; }

  reset() { this.game = new Chess(); this.synced = true; this.said.clear(); this.asked.clear(); this.pending = null; this.lastTriviaPly = 0; this.lastInsightPly = -99; this.ownMoves = 0; this.greeted = false; }

  /** Lines for one event, in the order they should be said. */
  react(e: ExperienceEvent): CoachLine[] {
    const d = e.data ?? {}, out: CoachLine[] = [];
    switch (e.type) {
      case "move": {
        const ply = Number(d.ply ?? 0);
        if (ply === 1) this.reset();
        this.track(String(d.san ?? ""), ply);
        if (this.pending && ply > this.pending.ply) out.push(...this.answer());
        if (this.tier > 0 && this.synced) out.push(...this.insights(d.color === "b" ? "b" : "w", ply));
        if (this.tier > 0 && this.tier < 4 && !this.pending && out.length === 0 && ply - this.lastTriviaPly >= [0, 6, 10, 16, 0][this.tier]) {
          const q = TRIVIA.find((t) => !this.asked.has(t.id) && (!t.adv || this.tier >= 2));
          if (q) out.push(...this.ask(q, ply));
        }
        return out;
      }
      case "engine-move": {
        if (!this.oppOn) return [];
        if (!this.greeted) { this.greeted = true; return [this.say(this.opp("hello", { me: this.cfg.names.C }), 1)]; }
        this.ownMoves++;
        return this.ownMoves % this.banterEvery === 0 ? [this.say(this.opp("myMove"), 0)] : [];
      }
      case "capture": {
        if (!this.oppOn || d.captured === "q") return []; // a queen capture already gets the commentators' full attention
        const mine = d.color === this.cfg.opponent;
        if (this.rnd() % [3, 1, 3, 4, 5][this.tier] !== 0) return [];
        const piece = PIECE[this.L][String(d.captured)] ?? "";
        return [this.say(this.opp(mine ? "iTake" : "youTake", { piece }), 1)];
      }
      case "check": return this.oppOn ? [this.say(this.opp(d.color === this.cfg.opponent ? "iCheck" : "youCheck"), 2)] : [];
      case "mate": return this.oppOn ? [this.say(this.opp(d.color === this.cfg.opponent ? "iWin" : "youWin"), 3)] : [];
      case "draw": return this.oppOn ? [this.say(this.opp("draw"), 2)] : [];
      default: return [];
    }
  }

  private say(text: string, priority: number): CoachLine { return { speaker: "C", text, priority, tag: "opponent" }; }

  /** Keeps a board of our own from the move events, so recognition never depends on any other node. */
  private track(san: string, ply: number) {
    if (!this.synced && ply !== 1) return;
    if (this.game.history().length !== ply - 1) { this.synced = false; return; }
    try { this.game.move(san); } catch { this.synced = false; }
  }

  private ask(q: Trivia, ply: number): CoachLine[] {
    this.asked.add(q.id); this.lastTriviaPly = ply;
    const asker: Speaker = this.oppOn ? "C" : "B";
    this.pending = { trivia: q, asker, ply };
    const pre = this.oppOn ? pick(OPP.askPrefix[this.L], this.rnd()) : "";
    return [{ speaker: asker, text: pre + q.q[this.L], priority: 2, tag: asker === "C" ? "opponent" : "coach" }];
  }

  private answer(): CoachLine[] {
    const p = this.pending!; this.pending = null;
    const lead = p.asker === "C" ? (this.L === "en" ? `To answer ${this.cfg.names.C}: ` : `Pour répondre à ${this.cfg.names.C} : `) : "";
    const out: CoachLine[] = [{ speaker: "A", text: lead + p.trivia.a[this.L], priority: 2, tag: "coach" }];
    if (p.asker === "C") out.push(this.say(this.L === "en" ? pick(["Exactly right.", "Correct! You've done your homework.", "Spot on."], this.rnd()) : pick(["Exactement.", "Bonne réponse !", "Parfait."], this.rnd()), 1));
    return out;
  }

  private insights(mover: Color, ply: number): CoachLine[] {
    const gap = [0, 0, 1, 3, 5][this.tier];
    if (ply - this.lastInsightPly <= gap) return [];
    const found = [...this.openings(), ...this.tactics(mover), ...this.structures(mover)]
      .filter((f) => this.tier < 3 || f.concept.subtle || f.concept.kind === "tactic" || (this.tier === 3 && f.concept.kind === "opening"))
      .filter((f) => this.tier < 4 || f.concept.subtle);
    const f = found.find((x) => !this.said.has(this.key(x)));
    if (!f) return [];
    for (const x of found) if (x.concept.id === f.concept.id) this.said.add(this.key(x));
    this.said.add(this.key(f)); this.lastInsightPly = ply;
    const out: CoachLine[] = [{ speaker: "B", text: this.explain(f.concept), priority: 2, squares: f.squares, label: f.concept.name[this.L], tag: "coach" }];
    if (this.oppOn && f.concept.kind === "tactic") {
      const name = f.concept.name[this.L];
      out.push(this.say(this.opp(f.side === this.cfg.opponent ? "myTactic" : "yourTactic", { name }), 1));
    }
    if (f.concept.trivia && this.tier < 4 && !this.pending && !this.asked.has(f.concept.trivia)) {
      const t = TRIVIA.find((x) => x.id === f.concept.trivia);
      if (t) out.push(...this.ask(t, ply));
    }
    return out;
  }

  private key(f: Found) { return f.concept.kind === "opening" ? `${f.concept.id}` : `${f.concept.id}:${f.side}:${f.concept.kind === "tactic" ? this.game.history().length : f.squares[0][0]}`; }

  /** "This is known as a … because …", as long as the level wants it. */
  explain(c: Concept): string {
    const L = this.L, t = this.tier, cap = (s: string) => s[0].toUpperCase() + s.slice(1);
    if (L === "en") {
      if (t <= 1) return `This is known as ${c.art.en}, because ${c.simple.en}. Look at the highlighted squares.`;
      if (t === 2) return `This is known as ${c.art.en}, because ${c.simple.en}.`;
      if (t === 3) return `That's ${c.art.en}: ${c.short.en}.`;
      return `${cap(c.name.en)}: ${c.short.en}.`;
    }
    const because = /^[aeiouyéèêàâ]/i.test(c.simple.fr) ? "parce qu'" : "parce que ";
    if (t <= 1) return `On appelle ça ${c.art.fr}, ${because}${c.simple.fr}. Regarde les cases en surbrillance.`;
    if (t === 2) return `On appelle ça ${c.art.fr}, ${because}${c.simple.fr}.`;
    if (t === 3) return `C'est ${c.art.fr} : ${c.short.fr}.`;
    return `${cap(c.name.fr)} : ${c.short.fr}.`;
  }

  private openings(): Found[] {
    const h = this.game.history(), out: Found[] = [];
    for (const [id, line] of BOOK) {
      if (h.length !== line.length || line.some((m, i) => h[i] !== m)) continue;
      const v = this.game.history({ verbose: true });
      out.push({ concept: CONCEPTS[id], squares: v.map((m) => m.to), side: h.length % 2 ? "w" : "b" });
    }
    return out;
  }

  /** Forks, pins and skewers made by the piece that just moved. */
  private tactics(mover: Color): Found[] {
    const v = this.game.history({ verbose: true }), last = v[v.length - 1];
    if (!last) return [];
    const g = this.game, to = last.to as Square, piece = g.get(to);
    if (!piece || piece.color !== mover || g.isGameOver()) return [];
    const enemy: Color = mover === "w" ? "b" : "w", out: Found[] = [];
    // fork: two or more targets worth more than the attacker, or undefended, or the king
    const targets: Square[] = [];
    for (const row of g.board()) for (const s of row) {
      if (!s || s.color !== enemy || s.type === "p") continue;
      if (!g.attackers(s.square, mover).includes(to)) continue;
      if (s.type === "k" || VALUE[s.type] > VALUE[piece.type] || g.attackers(s.square, enemy).length === 0) targets.push(s.square);
    }
    const safe = !g.attackers(to, enemy).some((a) => VALUE[g.get(a)!.type] < VALUE[piece.type]) && (g.attackers(to, enemy).length === 0 || g.attackers(to, mover).length > 0);
    if (targets.length >= 2 && safe && piece.type !== "k") out.push({ concept: CONCEPTS.fork, squares: [to, ...targets], side: mover });
    // pins and skewers along the moved piece's lines
    const dirs = piece.type === "b" ? [[1, 1], [1, -1], [-1, 1], [-1, -1]] : piece.type === "r" ? [[1, 0], [-1, 0], [0, 1], [0, -1]] : piece.type === "q" ? [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]] : [];
    const f0 = files.indexOf(to[0]), r0 = Number(to[1]) - 1;
    for (const [df, dr] of dirs) {
      const hits: { sq: Square; type: string; color: Color }[] = [];
      for (let f = f0 + df, r = r0 + dr; f >= 0 && f < 8 && r >= 0 && r < 8 && hits.length < 2; f += df, r += dr) {
        const s = sqName(f, r), p = g.get(s);
        if (p) hits.push({ sq: s, type: p.type, color: p.color });
      }
      if (hits.length < 2 || hits[0].color !== enemy || hits[1].color !== enemy) continue;
      const [front, back] = hits;
      if (back.type === "k" || (front.type !== "p" && VALUE[back.type] > VALUE[front.type] && VALUE[back.type] > VALUE[piece.type])) out.push({ concept: CONCEPTS.pin, squares: [to, front.sq, back.sq], side: mover });
      else if ((front.type === "k" || front.type === "q") && VALUE[front.type] > VALUE[back.type] && back.type !== "p" && VALUE[back.type] >= 3) out.push({ concept: CONCEPTS.skewer, squares: [to, front.sq, back.sq], side: mover });
    }
    return out;
  }

  /** Pawn structures and fianchettos, each named the first time it appears. */
  private structures(mover: Color): Found[] {
    const g = this.game, out: Found[] = [], ply = g.history().length;
    const pawns: Record<Color, number[][]> = { w: [[], [], [], [], [], [], [], []], b: [[], [], [], [], [], [], [], []] };
    for (const row of g.board()) for (const s of row) if (s?.type === "p") pawns[s.color][files.indexOf(s.square[0])].push(Number(s.square[1]));
    for (const c of [mover, mover === "w" ? "b" : "w"] as Color[]) {
      const own = pawns[c], their = pawns[c === "w" ? "b" : "w"];
      for (let f = 0; f < 8; f++) {
        if (!own[f].length) continue;
        const iso = (f === 0 || !own[f - 1].length) && (f === 7 || !own[f + 1].length);
        if (iso && ply > 6) out.push({ concept: f === 3 && own[f].length === 1 ? CONCEPTS.iqp : CONCEPTS["isolated-pawn"], squares: own[f].map((r) => sqName(f, r - 1)), side: c });
        if (own[f].length >= 2) out.push({ concept: CONCEPTS["doubled-pawns"], squares: own[f].map((r) => sqName(f, r - 1)), side: c });
        for (const r of own[f]) {
          const ahead = (x: number) => (c === "w" ? x > r : x < r);
          const blocked = [f - 1, f, f + 1].some((ff) => ff >= 0 && ff < 8 && their[ff].some(ahead));
          const rel = c === "w" ? r : 9 - r;
          if (!blocked && rel >= 4 && ply > 10) out.push({ concept: CONCEPTS["passed-pawn"], squares: [sqName(f, r - 1)], side: c });
        }
      }
      // fianchetto: bishop on b2/g2 (b7/g7) behind its pawn on b3/g3 (b6/g6)
      for (const [bf, home] of [[1, "b"], [6, "g"]] as [number, string][]) {
        const br = c === "w" ? 2 : 7, pr = c === "w" ? 3 : 6, b = g.get(`${home}${br}` as Square), p = g.get(`${home}${pr}` as Square);
        if (b?.type === "b" && b.color === c && p?.type === "p" && p.color === c) out.push({ concept: CONCEPTS.fianchetto, squares: [sqName(bf, br - 1), sqName(bf, pr - 1)], side: c });
      }
    }
    return out;
  }
}
