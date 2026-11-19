/** 250 concise, context-specific variants; one sentence per line. */
const combine = (starts: string[], ends: string[]) => starts.flatMap((a) => ends.map((b) => `${a} ${b}.`));
export const extraPhrases = {
  fr: {
    engineSits: combine(["Une nouvelle partie", "Un nouveau duel", "Un nouveau défi", "Une nouvelle rencontre", "Un nouveau départ"], ["à jouer coup par coup", "sans se précipiter", "avec tout à construire", "sur soixante-quatre cases", "avec les mêmes chances au départ"]),
    opening: combine(["Le début se construit", "L’ouverture prend forme", "La partie se dessine", "Le jeu se met en place", "Les premiers choix se font"], ["un tempo à la fois", "avec le centre en tête", "sans oublier le roi", "avant les grandes attaques", "en gardant des options"]),
    develop: combine(["Cette pièce se développe", "Une pièce entre en jeu", "Le développement continue", "Les forces se mobilisent", "La mise en place avance"], ["pour préparer la suite", "avant de chercher une attaque", "avec la coordination en tête", "sans tout dévoiler", "un coup à la fois"]),
    middlegame: combine(["Il faut choisir un plan", "Il faut comparer les options", "Il faut chercher les bonnes cases", "Il faut coordonner les pièces", "Il faut regarder les menaces"], ["avant de se lancer", "sans perdre de temps", "en vérifiant les prises", "en surveillant les échecs", "sans oublier la défense"]),
    endgame: combine(["Chaque tempo compte", "La précision compte", "La patience compte", "La vigilance compte", "Le calcul compte"], ["jusqu’au dernier coup", "même après une longue partie", "dans les courses de pions", "avant chaque échange", "pour convertir une bonne position"]),
  },
  en: {
    engineSits: combine(["A new game", "A fresh challenge", "A new contest", "A fresh start", "Another match"], ["to take one move at a time", "with everything to play for", "with no need to rush", "on sixty-four squares", "with equal pieces to start"]),
    opening: combine(["The opening takes shape", "The game takes shape", "The early plan develops", "The setup takes shape", "The first choices unfold"], ["one tempo at a time", "with the centre in mind", "with king safety in mind", "before the big attacks", "with options still open"]),
    develop: combine(["Another piece develops", "Another piece joins the game", "Development continues", "The pieces mobilise", "The setup progresses"], ["to prepare the next phase", "before looking for an attack", "with coordination in mind", "without revealing everything", "one move at a time"]),
    middlegame: combine(["Time to choose a plan", "Time to compare the options", "Time to find useful squares", "Time to coordinate the pieces", "Time to check the threats"], ["before committing", "without wasting a tempo", "while checking captures", "while checking forcing moves", "without neglecting defence"]),
    endgame: combine(["Every tempo matters", "Precision matters", "Patience matters", "Alertness matters", "Calculation matters"], ["right to the final move", "even after a long game", "in a pawn race", "before every exchange", "when converting an advantage"]),
  },
};
