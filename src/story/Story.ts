import type { Sibling } from '../progress/Progress';

/**
 * Histoire de NEON VERTIGO : à Néo-Véridian, Sacha — frère ou sœur du joueur,
 * au choix — a caché un message dans des balises en hauteur avant que la
 * milice Aegis n'efface le secteur. Chaque niveau terminé délivre un fragment.
 * Les textes de Sacha évitent les accords genrés pour rester valables dans les
 * deux cas ; seules les tournures « ton frère » / « ta sœur » changent.
 */

export const SIBLING_NAME = 'Sacha';

export interface SiblingWords {
  /** « ton frère » / « ta sœur » */
  ton: string;
  /** « Ton frère » / « Ta sœur » */
  Ton: string;
}

export function siblingWords(s: Sibling): SiblingWords {
  return s === 'frere' ? { ton: 'ton frère', Ton: 'Ton frère' } : { ton: 'ta sœur', Ton: 'Ta sœur' };
}

export interface LorePage {
  title: string;
  text: string;
}

/** Pages d'introduction du tutoriel (« TRANSMISSION »). */
export function lorePages(s: Sibling): LorePage[] {
  const w = siblingWords(s);
  return [
    {
      title: 'NÉO-VÉRIDIAN',
      text: 'À Néo-Véridian, il pleut depuis si longtemps que plus personne ne lève les yeux. En bas, les rues appartiennent à la milice Aegis. En haut, sur les toits, il reste les runners.',
    },
    {
      title: SIBLING_NAME.toUpperCase(),
      text: `${w.Ton} ${SIBLING_NAME} t'a appris à courir là-haut. La nuit où Aegis a bouclé le secteur, ${SIBLING_NAME} a disparu. Il ne reste qu'un signal, découpé en fragments et caché dans des balises, tout en haut.`,
    },
    {
      title: 'AVANT LA PURGE',
      text: `Aegis s'apprête à effacer les données du secteur. Traverse les toits avec tes lames Mantis, ton pistolet et ton Sandevistan, atteins chaque balise avant la purge… et découvre enfin ce que ${SIBLING_NAME} voulait te dire.`,
    },
  ];
}

export interface StoryLog {
  /** Index du niveau qui délivre ce log. */
  level: number;
  code: string;
  title: string;
  /** Texte du log (selon le lien choisi et le nombre de fragments réunis). */
  text: (s: Sibling, fragments: number) => string;
  /** Vrai pour les trois fragments du message (l'épilogue n'en est pas un). */
  fragment: boolean;
}

export const STORY_LOGS: readonly StoryLog[] = [
  {
    level: 0,
    code: 'FRAGMENT 1/3',
    title: 'SIGNAL HACHÉ',
    fragment: true,
    text: () =>
      '…kssh… si ce signal te parvient… ne descends pas. Surtout pas dans la rue. Aegis a bouclé les niveaux bas, leurs scanners lisent tout ce qui marche sous la pluie… kssh… Reste en hauteur, comme je te l\'ai appris. J\'ai caché la suite là où ils ne lèvent jamais les yeux. Trouve la prochaine balise. Et ne… kssh… [SIGNAL PERDU]',
  },
  {
    level: 1,
    code: 'FRAGMENT 2/3',
    title: 'CE QU\'AEGIS EFFACE',
    fragment: true,
    text: () =>
      'J\'ai trouvé ce qu\'Aegis cherche à cacher. Ce ne sont pas des criminels qu\'ils traquent : ce sont des souvenirs. Les archives du quartier, les registres, les visages, nos noms. Ils purgent le secteur pour le revendre propre, sans histoire, sans nous. J\'ai copié tout ce que j\'ai pu dans les balises. S\'ils me trouvent, au moins ça, ils ne l\'auront pas.',
  },
  {
    level: 2,
    code: 'FRAGMENT 3/3',
    title: 'MESSAGE COMPLET',
    fragment: true,
    text: () =>
      'Si tu entends celui-ci, c\'est que tu as atteint le sommet. Alors écoute, sans te presser. Je ne serai sans doute plus là quand la pluie s\'arrêtera, et ce n\'est pas grave. Tout ce qu\'Aegis voulait faire disparaître, c\'est toi qui le portes maintenant : les toits, les néons du marché, le ramen d\'Okonomi à trois heures du matin, et nous deux, à compter les drones depuis le vieux château d\'eau. Ne cours plus pour fuir. Cours parce que tu aimes ça. Je serai dans chaque balise que tu allumeras. — Sacha',
  },
  {
    level: 3,
    code: 'ÉPILOGUE',
    title: 'TRANSMISSION SORTANTE',
    fragment: false,
    text: (s, fragments) => {
      const w = siblingWords(s);
      if (fragments < 3) {
        const missing = 3 - fragments;
        return `Tu tentes de diffuser le message depuis le plus haut toit de Néo-Véridian, mais le signal est incomplet : il manque ${missing} fragment${missing > 1 ? 's' : ''}. Retourne les chercher avant que la purge n'emporte la voix de ${w.ton}.`;
      }
      return `Tu as réuni les trois fragments et tu les diffuses depuis le plus haut toit de Néo-Véridian. Sur chaque écran du secteur, la voix de ${w.ton} remplace les messages d'Aegis. La purge s'arrête à 97 %. Le reste, la ville s'en souviendra.`;
    },
  },
  {
    level: 4,
    code: 'FIN',
    title: 'PURGE ANNULÉE',
    fragment: false,
    text: (s) => {
      const w = siblingWords(s);
      return `La Sentinelle d'Aegis s'écrase sur le toit de sa propre tour, et avec elle les 3 % de purge qui restaient. En bas, les écrans du secteur passent en boucle la voix de ${w.ton}. Quelqu'un, quelque part, rallume ses néons. Tu restes un moment sous la pluie, à écouter. Puis tu repars en courant. Pas pour fuir : parce que tu aimes ça.`;
    },
  },
  {
    level: 5,
    code: 'SIGNAL EN DIRECT',
    title: 'DE L\'AUTRE CÔTÉ DU FLEUVE',
    fragment: false,
    text: () =>
      'Au sommet de l\'antenne, ton terminal accroche une fréquence que plus personne n\'utilise. Pas un enregistrement : une voix, en direct, un peu essoufflée. « … tu as toujours grimpé plus vite que moi. Ne dis rien, ils écoutent encore. Regarde vers le fleuve : une lumière va clignoter trois fois. C\'est moi. » Au loin, de l\'autre côté de l\'eau noire, une lumière clignote. Une fois. Deux fois. Trois.',
  },
];

export function logForLevel(level: number): StoryLog | null {
  return STORY_LOGS.find((l) => l.level === level) ?? null;
}

/** Identifiant de drapeau d'un log reçu (sauvegarde). */
export function logFlag(level: number): string {
  return `log-${level}`;
}
