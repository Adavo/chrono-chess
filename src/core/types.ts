/**
 * Structures de données de Chrono Chess (plateau 5x5, 5 coups programmés par manche).
 * Tout est sérialisable en JSON (utile pour le réseau et les replays).
 */

export type Color = 'white' | 'black';
export type PieceType = 'P' | 'N' | 'B' | 'R' | 'Q' | 'K';
export type PieceId = string; // ex: "wP0", "bK0" — stable pendant toute la partie

/** Case de la grille. file = colonne (0..size-1), rank = ligne (0 = côté blanc). */
export interface Square {
  readonly file: number;
  readonly rank: number;
}

export interface PieceState {
  id: PieceId;
  type: PieceType;
  color: Color;
  pos: Square;
}

/**
 * Force d'une pièce : quand deux pièces ennemies ARRIVENT ensemble sur la même case, la plus forte reste.
 * Roi > (Dame, promotion) > Tour > Cavalier > Fou > Pion.
 */
/** Pièces possibles à la promotion : tirée au hasard. */
export const PROMOTIONS: PieceType[] = ['N', 'B', 'R'];

export const STRENGTH: Record<PieceType, number> = { P: 1, B: 2, N: 3, R: 5, Q: 9, K: 100 };

/**
 * État complet de la partie entre deux Séquences.
 * `pieces` ne contient que les pièces vivantes et fait foi ;
 * `grid` est un cache dérivé (grid[rank * size + file] = id | null), reconstruit par rebuildGrid().
 */
export interface GameState {
  size: number;
  pieces: PieceState[];
  grid: (PieceId | null)[];
  /** Numéro de la Séquence en cours (0-indexé). */
  sequence: number;
  winner: Color | 'draw' | null;
}

// ---------------------------------------------------------------------------
// Programmation (phase de planification)
// ---------------------------------------------------------------------------

/** Intention d'un joueur : "cette pièce va vers cette case". Rien n'est vérifié à ce stade. */
export interface PlannedAction {
  pieceId: PieceId;
  to: Square;
}

/** Plan d'un joueur : plan[i] = actions prévues au sous-tour i. */
export type Plan = PlannedAction[][];

/** Action placée dans la file de résolution, avec son propriétaire et sa priorité. */
export interface QueuedAction extends PlannedAction {
  subTurn: number;
  owner: Color;
  /** Ordre de soumission au sein d'un joueur/sous-tour (départage les conflits alliés). */
  order: number;
}

/** File d'attente des actions de toute la Séquence, triée (subTurn, owner, order). */
export type ActionQueue = QueuedAction[];

// ---------------------------------------------------------------------------
// Résolution
// ---------------------------------------------------------------------------

export type CancelReason =
  | 'piece-not-found' // la pièce a été détruite avant ce sous-tour
  | 'not-owner'
  | 'already-acted' // la pièce a déjà une action ce sous-tour
  | 'no-move' // destination = case actuelle
  | 'out-of-bounds'
  | 'illegal-geometry' // mouvement impossible depuis la position ACTUELLE
  | 'path-blocked' // une pièce immobile bloque la trajectoire
  | 'friendly-occupied' // case occupée par un allié au début du sous-tour
  | 'blocked-forward' // pion bloqué devant lui
  | 'no-capture-target' // capture en diagonale d'un pion sans cible
  | 'target-moved' // la cible d'une capture de pion est partie
  | 'ally-conflict' // un allié prioritaire vise la même case
  | 'king-in-check' // ce coup met ou laisse son propre roi en échec
  | 'king-capture'; // un roi ne se capture jamais : on le met échec et mat

/** Journal d'événements : sert à animer la phase cinématique. */
export type GameEvent =
  | { kind: 'sub-turn-start'; subTurn: number }
  | { kind: 'move'; subTurn: number; pieceId: PieceId; from: Square; to: Square }
  | { kind: 'cancelled'; subTurn: number; pieceId: PieceId; owner: Color; to: Square; reason: CancelReason }
  /** Un mouvant capture la pièce immobile qui occupait la case. */
  | { kind: 'capture'; subTurn: number; attackerId: PieceId; victimId: PieceId; at: Square }
  /** Deux pièces arrivent ensemble sur la même case : `winnerId` (la plus forte) reste ; null = destruction mutuelle. */
  | { kind: 'collision'; subTurn: number; at: Square; pieceIds: PieceId[]; winnerId: PieceId | null }
  | { kind: 'promotion'; subTurn: number; pieceId: PieceId; at: Square; to: PieceType }
  | { kind: 'check'; subTurn: number; color: Color } // le roi de `color` est en échec à la fin de ce sous-tour
  | { kind: 'game-over'; subTurn: number; winner: Color | 'draw'; reason?: 'checkmate' | 'stalemate' | 'king-lost' | 'insufficient' };

export interface RulesConfig {
  size: number;
  /** Nombre de coups programmés par manche (la Séquence). */
  subTurns: number;
  /** Nombre max d'actions par joueur et par sous-tour (1 = un coup par sous-tour). */
  maxActionsPerSubTurn: number;
}

export const DEFAULT_RULES: RulesConfig = {
  size: 5,
  subTurns: 5,
  maxActionsPerSubTurn: 1,
};
