import { cloneState, rebuildGrid, sqKey } from './board';
import { checkMove, type Snapshot } from './moves';
import { buildQueue } from './plan';
import {
  DEFAULT_RULES,
  type ActionQueue,
  type CancelReason,
  type Color,
  type GameEvent,
  type GameState,
  type PieceState,
  type Plan,
  type QueuedAction,
  type RulesConfig,
  type Square,
} from './types';

/**
 * ============================ PHASE DE RÉSOLUTION ============================
 *
 * Règles (Option 1 — "coup caduc") :
 *  1. Un sous-tour est résolu SIMULTANÉMENT : toutes les actions sont validées
 *     contre le même instantané (état au début du sous-tour), puis appliquées d'un coup.
 *  2. Une action invalide à cet instant (pièce disparue, trajectoire bloquée, case
 *     alliée, cible partie…) est ANNULÉE : la pièce reste où elle est. Jamais de
 *     correctif automatique, jamais de report sur un autre sous-tour.
 *  3. Les actions suivantes sont évaluées depuis la position RÉELLE de la pièce, pas
 *     depuis celle que le joueur imaginait.
 *  4. Collisions (voir resolveDestination) :
 *     - un mouvant sur une pièce ennemie immobile la capture ;
 *     - deux ennemis arrivant sur la même case : la plus forte valeur gagne,
 *       égalité = destruction mutuelle ;
 *     - une pièce qui quitte sa case n'est pas capturable à cet endroit (les croisements
 *       / échanges de cases sont donc permis) ;
 *     - une case alliée occupée au début du sous-tour bloque, même si l'allié part ;
 *     - deux alliés visant la même case : le premier de la file passe, l'autre est caduc.
 *  5. Capture en diagonale d'un pion : annulée si la cible a une action valide (elle part).
 *  6. Les cases traversées par une pièce glissante ne sont testées qu'au début du
 *     sous-tour : un ennemi qui s'y pose en même temps n'interrompt pas le trajet.
 *  7. Promotion automatique en dame. Roque et prise en passant : hors MVP.
 *  8. La partie s'arrête dès qu'un roi disparaît (les sous-tours restants sont ignorés).
 */

interface Validated {
  action: QueuedAction;
  piece: PieceState;
  from: Square;
  to: Square;
  capture: boolean;
}

export interface SubTurnResult {
  state: GameState;
  events: GameEvent[];
}

/** Résout un sous-tour. Ne modifie pas `state` : renvoie un nouvel état. */
export function resolveSubTurn(
  state: GameState,
  subTurn: number,
  actions: QueuedAction[],
  rules: RulesConfig = DEFAULT_RULES,
): SubTurnResult {
  const events: GameEvent[] = [{ kind: 'sub-turn-start', subTurn }];
  const next = cloneState(state);
  const size = state.size;

  // Instantané figé au début du sous-tour.
  const byId = new Map(state.pieces.map((p) => [p.id, p]));
  const snap: Snapshot = {
    size,
    at: (s) => {
      const id = state.grid[sqKey(s, size)];
      return id ? byId.get(id) : undefined;
    },
  };

  // --- Étape 1 : validation de chaque action contre l'instantané -------------
  const cancel = (a: QueuedAction, reason: CancelReason) =>
    events.push({ kind: 'cancelled', subTurn, pieceId: a.pieceId, owner: a.owner, to: a.to, reason });

  const validated: Validated[] = [];
  const acted = new Set<string>();
  const claimed = new Set<string>(); // `${color}:${destKey}` — conflits entre alliés

  for (const a of actions) {
    const piece = byId.get(a.pieceId);
    if (!piece) { cancel(a, 'piece-not-found'); continue; }
    if (piece.color !== a.owner) { cancel(a, 'not-owner'); continue; }
    if (acted.has(piece.id)) { cancel(a, 'already-acted'); continue; }

    const dir = piece.color === 'white' ? 1 : -1;
    const startRank = piece.color === 'white' ? 1 : size - 2;
    const check = checkMove(snap, piece, a.to, startRank, dir);
    if (!check.ok) { cancel(a, check.reason); continue; }

    const claim = `${piece.color}:${sqKey(a.to, size)}`;
    if (claimed.has(claim)) { cancel(a, 'ally-conflict'); continue; }

    claimed.add(claim);
    acted.add(piece.id);
    validated.push({ action: a, piece, from: piece.pos, to: a.to, capture: check.capture });
  }

  // --- Étape 2 : capture de pion dont la cible est partie ---------------------
  const departing = new Set(validated.map((v) => v.piece.id)); // calculé AVANT annulation
  const moves = validated.filter((v) => {
    if (v.piece.type === 'P' && v.capture) {
      const target = snap.at(v.to);
      if (target && departing.has(target.id)) { cancel(v.action, 'target-moved'); return false; }
    }
    return true;
  });
  const moverIds = new Set(moves.map((m) => m.piece.id));

  // --- Étape 3 : résolution par case d'arrivée --------------------------------
  const byDest = new Map<number, Validated[]>();
  for (const m of moves) {
    const k = sqKey(m.to, size);
    byDest.set(k, [...(byDest.get(k) ?? []), m]);
  }

  const removed = new Set<string>();
  const landing = new Map<string, Square>(); // pièces qui finissent leur déplacement
  const moveOrder: Validated[] = [];

  for (const k of [...byDest.keys()].sort((a, b) => a - b)) {
    const arrivals = byDest.get(k)!;
    const at = arrivals[0]!.to;
    const stayerId = state.grid[k];
    const stayer = stayerId && !moverIds.has(stayerId) ? byId.get(stayerId) : undefined;

    if (arrivals.length === 1) {
      const m = arrivals[0]!;
      if (stayer) {
        removed.add(stayer.id);
        events.push({ kind: 'capture', subTurn, attackerId: m.piece.id, victimId: stayer.id, at });
      }
      landing.set(m.piece.id, at);
      moveOrder.push(m);
      continue;
    }

    // Collision : au plus un arrivant par camp (garanti par 'ally-conflict').
    const val = (m: Validated) => rules.collisionValue[m.piece.type];
    const best = Math.max(...arrivals.map(val));
    const winners = arrivals.filter((m) => val(m) === best);
    const pieceIds = arrivals.map((m) => m.piece.id);
    if (winners.length === 1) {
      const w = winners[0]!;
      for (const m of arrivals) if (m !== w) removed.add(m.piece.id);
      landing.set(w.piece.id, at);
      moveOrder.push(w);
      events.push({ kind: 'collision', subTurn, at, pieceIds, winnerId: w.piece.id });
    } else {
      for (const m of arrivals) removed.add(m.piece.id);
      events.push({ kind: 'collision', subTurn, at, pieceIds, winnerId: null });
    }
  }

  // --- Étape 4 : application simultanée ---------------------------------------
  for (const m of moveOrder) {
    events.push({ kind: 'move', subTurn, pieceId: m.piece.id, from: m.from, to: m.to });
  }
  next.pieces = next.pieces.filter((p) => !removed.has(p.id));
  for (const p of next.pieces) {
    const dest = landing.get(p.id);
    if (!dest) continue;
    p.pos = { ...dest };
    p.hasMoved = true;
    const lastRank = p.color === 'white' ? size - 1 : 0;
    if (p.type === 'P' && p.pos.rank === lastRank) {
      p.type = 'Q';
      events.push({ kind: 'promotion', subTurn, pieceId: p.id, at: p.pos });
    }
  }
  rebuildGrid(next);

  // --- Étape 5 : fin de partie -------------------------------------------------
  const kings = (c: Color) => next.pieces.some((p) => p.type === 'K' && p.color === c);
  const w = kings('white');
  const b = kings('black');
  if (!w || !b) {
    next.winner = w ? 'white' : b ? 'black' : 'draw';
    events.push({ kind: 'game-over', subTurn, winner: next.winner });
  }
  return { state: next, events };
}

/** Résout toute la Séquence (tous les sous-tours) à partir de la file d'actions. */
export function resolveSequence(
  state: GameState,
  queue: ActionQueue,
  rules: RulesConfig = DEFAULT_RULES,
): SubTurnResult {
  let current = state;
  const events: GameEvent[] = [];
  for (let t = 0; t < rules.subTurns && current.winner === null; t++) {
    const res = resolveSubTurn(current, t, queue.filter((a) => a.subTurn === t), rules);
    current = res.state;
    events.push(...res.events);
  }
  current = { ...current, sequence: current.sequence + 1 };
  return { state: current, events };
}

/** Raccourci : deux plans -> file triée -> résolution. */
export function resolvePlans(
  state: GameState,
  plans: Record<Color, Plan>,
  rules: RulesConfig = DEFAULT_RULES,
): SubTurnResult {
  return resolveSequence(state, buildQueue(plans), rules);
}
