/**
 * Structures de données de Chrono Chess.
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
  /** Sert au pion (double pas initial) ; mis à jour par la résolution. */
  hasMoved: boolean;
}

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
  | 'piece-not-found' // la pièce a été capturée avant ce sous-tour
  | 'not-owner'
  | 'already-acted' // la pièce a déjà une action ce sous-tour
  | 'no-move' // destination = case actuelle
  | 'out-of-bounds'
  | 'illegal-geometry' // mouvement impossible depuis la position ACTUELLE
  | 'path-blocked' // une pièce bloque la trajectoire
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
  | { kind: 'capture'; subTurn: number; attackerId: PieceId; victimId: PieceId; at: Square }
  | { kind: 'collision'; subTurn: number; at: Square; pieceIds: PieceId[]; winnerId: PieceId | null }
  | { kind: 'promotion'; subTurn: number; pieceId: PieceId; at: Square }
  | { kind: 'check'; subTurn: number; color: Color } // le roi de `color` est en échec (sans être mat)
  | { kind: 'game-over'; subTurn: number; winner: Color | 'draw'; reason?: 'checkmate' | 'stalemate' | 'king-lost' };

export interface RulesConfig {
  size: number;
  subTurns: number;
  /** Nombre max d'actions par joueur et par sous-tour (1 = un coup par sous-tour). */
  maxActionsPerSubTurn: number;
  /**
   * true (défaut) : règle des échecs classiques, aucun coup ne peut laisser ou mettre son roi en échec.
   * false : seul un roi DÉJÀ en échec au début du sous-tour impose de parer l'échec.
   */
  strictKingSafety?: boolean;
  /** Valeur d'une pièce lors d'une collision (arrivée simultanée sur la même case). */
  collisionValue: Record<PieceType, number>;
}

export const DEFAULT_RULES: RulesConfig = {
  size: 8,
  subTurns: 3,
  maxActionsPerSubTurn: 1,
  collisionValue: { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 100 },
  strictKingSafety: true,
};
