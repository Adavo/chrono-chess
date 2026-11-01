import type { ClassicMove } from '../core/classic';
import type { Color, GameEvent, GameState } from '../core/types';

/** Mode de jeu : classique (coup par coup) ou un seul coup simultané. */
export type Variant = 'classic' | 'single';

/**
 * Protocole (JSON, champ `t` comme dans Nidus Breach). L'hôte (blancs) est autoritaire :
 * il garde le plan de l'invité secret jusqu'à la résolution, puis diffuse état + événements.
 */
/** `seq` = numéro de Séquence visé : l'hôte ignore un plan arrivé trop tard. */
export type GuestToHost = { t: 'plan'; plan: unknown; seq: number } | { t: 'move'; move: ClassicMove; seq: number };
export type HostToGuest =
  | { t: 'start'; color: Color; state: GameState; variant?: Variant }
  | { t: 'resolved'; events: GameEvent[]; state: GameState };
