import { cloneState, rebuildGrid, sqKey } from './board';
import { gameOutcome, isInCheck, keepsKingSafe } from './check';
import { checkMove, type Snapshot } from './moves';
import { buildQueue } from './plan';
import {
  DEFAULT_RULES,
  PROMOTIONS,
  STRENGTH,
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
 *  1. Un sous-tour est résolu SIMULTANÉMENT : toutes les actions sont validées
 *     contre le même instantané (état au début du sous-tour), puis appliquées d'un coup.
 *  2. Une action invalide à cet instant (pièce disparue, trajectoire bloquée, case alliée,
 *     cible partie, roi en échec…) est ANNULÉE : la pièce reste où elle est. Jamais de correctif.
 *  3. Les actions suivantes sont évaluées depuis la position RÉELLE de la pièce.
 *  4. Collisions classiques des échecs : une pièce IMMOBILE (alliée ou ennemie) bloque la
 *     trajectoire d'une tour, d'un fou ou d'une dame ; une pièce qui arrive sur une pièce ennemie
 *     immobile la capture, quelle que soit sa force.
 *  5. Deux pièces qui BOUGENT en même temps se croisent sans rien se faire (échange de cases
 *     compris) : seule compte la case d'arrivée. Si deux pièces ennemies ARRIVENT ensemble sur la
 *     même case, la plus forte reste — Roi > Dame > Tour > Cavalier > Fou > Pion — et deux pièces
 *     de même force s'annulent.
 *  6. Une case alliée occupée au début du sous-tour bloque, même si l'allié part ; deux alliés
 *     visant la même case : le premier de la file passe, l'autre est caduc.
 *  7. Capture en diagonale d'un pion : annulée si la cible a une action valide (elle part).
 *  8. Échec : pendant les coups d'une manche, on bouge LIBREMENT (on peut exposer son roi en déplaçant
 *     une autre pièce), sauf que le ROI ne peut jamais aller sur une case attaquée ('king-attacked').
 *     Autre exception : un roi déjà en échec au DÉBUT de la
 *     manche doit d'abord en sortir — tant qu'il l'est au début d'un sous-tour, tout coup qui ne le
 *     sauve pas est annulé ('king-in-check'). Une fois sorti d'échec, plus d'obligation jusqu'à la
 *     manche suivante. Un roi ne se capture jamais ('king-capture').
 *  9. Échec et mat / pat : évalués UNIQUEMENT à la fin des `subTurns` coups, sur la position finale.
 *     Un roi maté au 3e coup continue de jouer ses 4e et 5e coups avant le verdict.
 * 10. Promotion automatique en cavalier, fou ou tour (tirage au sort). Pas de double pas, de roque
 *     ni de prise en passant.
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

/** Résout un sous-tour. Ne modifie pas `state` : renvoie un nouvel état. Ne juge pas la fin de partie. */
export function resolveSubTurn(
  state: GameState,
  subTurn: number,
  actions: QueuedAction[],
  rnd: () => number = Math.random,
  /** Couleurs qui doivent d'abord sortir d'échec à ce sous-tour. */
  escape: ReadonlySet<Color> = new Set(),
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

    const check = checkMove(snap, piece, a.to, piece.color === 'white' ? 1 : -1);
    if (!check.ok) { cancel(a, check.reason); continue; }
    // Un roi ne se capture jamais : on le met échec et mat.
    if (check.capture && snap.at(a.to)?.type === 'K') { cancel(a, 'king-capture'); continue; }
    // Un roi ne va jamais sur une case attaquée (déplacement rejeté) ; les autres pièces sont libres,
    // sauf si le roi doit d'abord sortir d'échec.
    if ((escape.has(piece.color) || piece.type === 'K') && !keepsKingSafe(state.pieces, size, piece, a.to)) {
      cancel(a, piece.type === 'K' && !escape.has(piece.color) ? 'king-attacked' : 'king-in-check'); continue;
    }

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

  for (const k of [...byDest.keys()].sort((a, b) => a - b)) {
    const arrivals = byDest.get(k)!;
    const at = arrivals[0]!.to;
    const stayerId = state.grid[k];
    const stayer = stayerId && !moverIds.has(stayerId) ? byId.get(stayerId) : undefined;
    const power = (m: Validated) => STRENGTH[m.piece.type];

    if (arrivals.length === 1) {
      const m = arrivals[0]!;
      if (stayer) {
        removed.add(stayer.id);
        events.push({ kind: 'capture', subTurn, attackerId: m.piece.id, victimId: stayer.id, at });
      }
      landing.set(m.piece.id, at);
      continue;
    }

    // Deux mouvants adverses (au plus un par camp : 'ally-conflict' / 'friendly-occupied').
    const best = Math.max(...arrivals.map(power));
    const winners = arrivals.filter((m) => power(m) === best);
    const pieceIds = arrivals.map((m) => m.piece.id);
    if (winners.length === 1) {
      const w = winners[0]!;
      for (const m of arrivals) if (m !== w) removed.add(m.piece.id);
      landing.set(w.piece.id, at);
      events.push({ kind: 'collision', subTurn, at, pieceIds, winnerId: w.piece.id });
    } else {
      for (const m of arrivals) removed.add(m.piece.id);
      events.push({ kind: 'collision', subTurn, at, pieceIds, winnerId: null });
    }
  }

  // --- Étape 4 : application simultanée ---------------------------------------
  // Tous les mouvants glissent jusqu'à leur case (même ceux qui y périssent) avant l'impact.
  for (const m of moves) events.push({ kind: 'move', subTurn, pieceId: m.piece.id, from: m.from, to: m.to });
  next.pieces = next.pieces.filter((p) => !removed.has(p.id));
  const asked = new Map(moves.map((m) => [m.piece.id, m.action.promo]));
  for (const p of next.pieces) {
    const dest = landing.get(p.id);
    if (!dest) continue;
    p.pos = { ...dest };
    const lastRank = p.color === 'white' ? size - 1 : 0;
    if (p.type === 'P' && p.pos.rank === lastRank) {
      // La pièce a été tirée au sort à la programmation ; sans tirage valide (coup inattendu), on tire ici.
      const chosen = asked.get(p.id);
      p.type = chosen && PROMOTIONS.includes(chosen) ? chosen : PROMOTIONS[Math.floor(rnd() * PROMOTIONS.length)]!;
      events.push({ kind: 'promotion', subTurn, pieceId: p.id, at: p.pos, to: p.type });
    }
  }
  rebuildGrid(next);

  for (const c of ['white', 'black'] as const) {
    if (isInCheck(next.pieces, size, c)) events.push({ kind: 'check', subTurn, color: c });
  }
  return { state: next, events };
}

/** Résout toute la Séquence : tous les sous-tours, puis le verdict (mat / pat) sur la position finale. */
export function resolveSequence(
  state: GameState,
  queue: ActionQueue,
  rules: RulesConfig = DEFAULT_RULES,
  rnd: () => number = Math.random,
): SubTurnResult {
  let current = state;
  let events: GameEvent[] = [];
  // Obligation de sortir d'échec : posée par la position de DÉBUT de manche, levée dès que le roi en sort.
  let obliged = (['white', 'black'] as const).filter((c) => isInCheck(state.pieces, state.size, c));
  for (let t = 0; t < rules.subTurns; t++) {
    obliged = obliged.filter((c) => isInCheck(current.pieces, current.size, c));
    const res = resolveSubTurn(current, t, queue.filter((a) => a.subTurn === t), rnd, new Set(obliged));
    current = res.state;
    events.push(...res.events);
  }
  const last = rules.subTurns - 1;
  const outcome = gameOutcome(current.pieces, current.size);
  if (outcome) {
    // Le mat est annoncé par la fin de partie, pas par un simple "échec".
    if (outcome.reason === 'checkmate') events = events.filter((e) => !(e.kind === 'check' && e.subTurn === last));
    events.push({ kind: 'game-over', subTurn: last, winner: outcome.winner, reason: outcome.reason });
  }
  current = { ...current, sequence: current.sequence + 1, winner: outcome?.winner ?? null };
  return { state: current, events };
}

/** Raccourci : deux plans -> file triée -> résolution. */
export function resolvePlans(
  state: GameState,
  plans: Record<Color, Plan>,
  rules: RulesConfig = DEFAULT_RULES,
  rnd: () => number = Math.random,
): SubTurnResult {
  return resolveSequence(state, buildQueue(plans), rules, rnd);
}
