import { cloneState, rebuildGrid } from './board';
import type { GameEvent, GameState } from './types';

export interface ReplayStep {
  subTurn: number;
  events: GameEvent[];
  /** État du plateau APRÈS ce sous-tour. */
  state: GameState;
}

/**
 * Rejoue le journal d'événements d'une Séquence, sous-tour par sous-tour.
 * Permet à un client (l'invité) d'animer la résolution sans connaître les plans adverses.
 */
export function replaySteps(start: GameState, events: GameEvent[]): ReplayStep[] {
  const groups = new Map<number, GameEvent[]>();
  for (const e of events) groups.set(e.subTurn, [...(groups.get(e.subTurn) ?? []), e]);

  const steps: ReplayStep[] = [];
  let current = start;
  for (const [subTurn, evs] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    const next = cloneState(current);
    const removed = new Set<string>();
    for (const e of evs) {
      if (e.kind === 'capture') removed.add(e.victimId);
      if (e.kind === 'collision') e.pieceIds.filter((id) => id !== e.winnerId).forEach((id) => removed.add(id));
    }
    next.pieces = next.pieces.filter((p) => !removed.has(p.id));
    for (const e of evs) {
      const p = next.pieces.find((q) => q.id === (e.kind === 'move' || e.kind === 'promotion' ? e.pieceId : ''));
      if (!p) continue;
      if (e.kind === 'move') { p.pos = { ...e.to }; p.hasMoved = true; }
      if (e.kind === 'promotion') p.type = 'Q';
    }
    rebuildGrid(next);
    const over = evs.find((e) => e.kind === 'game-over');
    if (over && over.kind === 'game-over') next.winner = over.winner;
    steps.push({ subTurn, events: evs, state: next });
    current = next;
  }
  return steps;
}
