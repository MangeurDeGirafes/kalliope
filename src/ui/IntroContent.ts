/**
 * Contenu narratif affiché au début du tutoriel, avant l'explication du jeu.
 *
 * Ajoute ici les pages de lore : chacune s'affiche avec un effet machine à
 * écrire sur une vue animée de la ville. Tant que la liste est vide, le
 * tutoriel commence directement par les explications du jeu.
 *
 * Exemple :
 *   { title: 'NIGHT CITY, 2091', text: 'Il pleut depuis trois ans…' },
 */
export interface LorePage {
  title: string;
  text: string;
}

export const LORE_PAGES: LorePage[] = [];
